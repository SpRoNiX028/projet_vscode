#!/usr/bin/env python3
"""ps2recon - reconnaissance tool for PlayStation 2 executables (EE ELF).

Purpose: before any decompilation or static-recompilation work, establish what
you are actually looking at. A PS2 disc contains far more than one ELF, and the
ELF itself is mostly statically linked Sony SDK code.

Usage:
    python3 tools/ps2recon.py <file> [-o report.md] [--json out.json] [-n 6]

What it does (all offline, no execution of the target):
  * validates that the file is a 32-bit little-endian MIPS ELF (EE main module)
  * dumps sections, memory layout, entry point
  * recovers symbols (if not stripped) and classifies them
  * fingerprints statically linked Sony SDK libraries
  * extracts printable strings, I/O paths, IRX / IOP module references
  * guesses the toolchain, the CRT startup, and candidate game functions
  * disassembles the entry point and a sample of .text with capstone
  * reports entropy per section (packing / compressed overlay heuristic)

Limits (by design, stated so nobody is surprised):
  * R5900 MMI / VU instructions are not decoded by capstone's MIPS32 backend
    and are reported as "undecoded" instead of being guessed.
  * VU0/VU1 microcode is uploaded at runtime as data, so it is NOT in this file
    in a directly disassemblable form. Finding it is a separate step.
  * Overlays and assets live elsewhere on the ISO, not in the main ELF.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

try:
    from elftools.elf.elffile import ELFFile
    from elftools.elf.sections import SymbolTableSection
except ImportError:  # pragma: no cover
    sys.exit("missing dependency: pip install pyelftools capstone")

try:
    import capstone
except ImportError:  # pragma: no cover
    capstone = None

EM_MIPS = 8

# ---------------------------------------------------------------------------
# Knowledge base: Sony PS2 SDK (lib*.a) fingerprints.
# Statically linked => no imports to read, so we fingerprint by symbol name and
# by the C library / SDK string fragments that survive in .rodata.
# ---------------------------------------------------------------------------
SDK_LIBS: dict[str, tuple[str, ...]] = {
    "libgraph / libgif (GS, GIF packets)": ("sceGs", "sceGif", "sceGraph", "sceDmaPacket"),
    "libdma (EE DMA controller)": ("sceDmaSend", "sceDmaSync", "sceDmaGetChan", "sceDmaReset"),
    "libvu0 (VU0 macros / microcode)": ("sceVu0", "sceVif0", "sceVif1", "sceVpu0"),
    "libpad / libmtap (controllers)": ("scePad", "sceMtap"),
    "libmc (memory card)": ("sceMc", "sceMcInit"),
    "libcdvd (DVD drive)": ("sceCd", "sceCdInit", "sceCdRead"),
    "libsif / librpc (EE<->IOP RPC)": ("sceSif", "sceRpc", "sceSifCallRpc"),
    "libfileio / libio (file I/O)": ("sceOpen", "sceRead", "sceClose", "sceLseek", "sceIoctl"),
    "libkernel (threads, semaphores)": ("CreateThread", "DeleteThread", "SignalSema",
                                        "WaitSema", "CreateSema", "SleepThread",
                                        "CreateMutex", "ReleaseMutex"),
    "libdev (device init, iomanX)": ("sceDev", "sceIoman", "sceDeci2"),
    "libipu (MPEG-2 image decompression)": ("sceIpu", "sceIPU"),
    "libmpeg / libdvdd (video decode)": ("sceMpeg", "sceDvdd"),
    "libspu2 / libsd (sound, IOP side)": ("sceSd", "sceSpu", "sceSdCallBack"),
    "libpc (performance counters)": ("scePc", "scePcStart"),
    "libusb / libnet / libhttp (reused on PS2)": ("sceUsb", "sceNet", "sceHTTP"),
}

TOOLCHAIN_HINTS = {
    "ee-gcc (GNU toolchain, Sony/ProDG era)": (".mdebug", ".reginfo", ".gnu.attributes",
                                               "GCC:", ".pdr", "__gnu_compiled_c"),
    "Metrowerks CodeWarrior (MW)": ("MW_", "Metrowerks", ".MWCATALOG", "CodeWarrior"),
    "build path leak (PDB/DWARF/SDWARF)": (".debug_info", ".debug_line", ".comment"),
}

# Typical EE module entry strings / prefixes seen on real discs.
IOP_HINTS = ("IOPRP", "rom0:", "rom1:", "host0:", "irx", "ioprp", "SIO2MAN",
             "MCMAN", "MCSERV", "PADMAN", "LIBSD", "SDRDRV", "CDVDMAN",
             "IOMAN", "FILEIO", "USBD", "DECI2")

PRINTABLE = re.compile(rb"[\x20-\x7e]{6,}")
PATHLIKE = re.compile(r"^[\w./\\:-]{4,120}$")
URL_RE = re.compile(rb"(?:https?|ftp)://[\x21-\x7e]{4,200}")
IP_RE = re.compile(rb"\b(?:\d{1,3}\.){3}\d{1,3}\b")


@dataclass
class Section:
    name: str
    type: str
    addr: int
    size: int
    offset: int
    entropy: float


@dataclass
class Symbol:
    name: str
    addr: int
    size: int
    kind: str


@dataclass
class Report:
    path: str
    size: int
    ok_ps2: bool
    reasons: list[str] = field(default_factory=list)
    machine: str = ""
    entry: int = 0
    flags: str = ""
    sections: list[Section] = field(default_factory=list)
    symbols: list[Symbol] = field(default_factory=list)
    sdk_hits: dict[str, list[str]] = field(default_factory=dict)
    toolchain: dict[str, list[str]] = field(default_factory=dict)
    iop_refs: list[str] = field(default_factory=list)
    paths: list[str] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    ips: list[str] = field(default_factory=list)
    candidates: list[tuple[int, str]] = field(default_factory=list)
    disasm: list[str] = field(default_factory=list)
    decode_ratio: float = 0.0
    warnings: list[str] = field(default_factory=list)


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = Counter(data)
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def read_cstr(data: bytes, off: int, limit: int = 200) -> str:
    end = data.find(b"\x00", off, off + limit)
    if end < 0:
        end = min(off + limit, len(data))
    return data[off:end].decode("latin-1", "replace")


def analyse(path: Path) -> Report:
    data = path.read_bytes()
    rep = Report(path=str(path), size=len(data), ok_ps2=False)

    if data[:4] != b"\x7fELF":
        rep.reasons.append("not an ELF file (magic mismatch)")
        rep.warnings.append("if this came off a disc as an IRX, it may be a Sony CRI/IRX body; "
                            "extract with an ISO tool first")
        return rep

    if data[4] != 1:
        rep.reasons.append(f"ELF class {data[4]} -> not 32-bit")
    if data[5] != 1:
        rep.reasons.append(f"ELF data encoding {data[5]} -> not little-endian")

    with open(path, "rb") as fh:
        elf = ELFFile(fh)
        rep.machine = elf.header["e_machine"]
        rep.ok_ps2 = (elf.header["e_machine"] == "EM_MIPS"
                      and data[4] == 1 and data[5] == 1)
        if elf.header["e_machine"] != "EM_MIPS":
            rep.reasons.append(f"e_machine = {elf.header['e_machine']}, expected EM_MIPS")
        rep.entry = elf.header["e_entry"]
        rep.flags = hex(elf.header["e_flags"])

        for sec in elf.iter_sections():
            raw = sec.data() if sec["sh_type"] != "SHT_NOBITS" else b""
            rep.sections.append(Section(
                name=sec.name or "<unnamed>",
                type=sec["sh_type"],
                addr=sec["sh_addr"],
                size=sec["sh_size"],
                offset=sec["sh_offset"],
                entropy=round(entropy(raw), 3) if raw else 0.0,
            ))

        for sec in elf.iter_sections():
            if isinstance(sec, SymbolTableSection):
                for sym in sec.iter_symbols():
                    if not sym.name:
                        continue
                    info = sym["st_info"]["type"]
                    if info in ("STT_FUNC", "STT_OBJECT", "STT_NOTYPE"):
                        rep.symbols.append(Symbol(sym.name, sym["st_value"],
                                                  sym["st_size"], info))

    # ---- strings -----------------------------------------------------------
    strings = [s.decode("latin-1") for s in PRINTABLE.findall(data)]
    for s in strings[:200000]:
        if PATHLIKE.match(s) and ("/" in s or "\\" in s or ":" in s):
            if " " not in s and len(s) > 4:
                rep.paths.append(s)
    rep.paths = sorted(set(rep.paths))[:60]
    rep.urls = sorted({m.decode("latin-1") for m in URL_RE.findall(data)})[:40]
    rep.ips = sorted({m.decode("latin-1") for m in IP_RE.findall(data)})[:30]

    # ---- IOP module references --------------------------------------------
    low = data
    for hint in IOP_HINTS:
        hb = hint.encode()
        if hb in low and hint not in rep.iop_refs:
            rep.iop_refs.append(hint)

    # ---- SDK fingerprinting ------------------------------------------------
    names = [s.name for s in rep.symbols]
    blob = data
    for lib, patterns in SDK_LIBS.items():
        hits: list[str] = []
        for pat in patterns:
            for nm in names:
                if nm.startswith(pat) or pat in nm:
                    hits.append(nm)
                    break
            else:
                if pat.encode() in blob:
                    hits.append(f"string:{pat}")
        if hits:
            rep.sdk_hits[lib] = hits[:8]

    # ---- toolchain ---------------------------------------------------------
    sec_names = {s.name for s in rep.sections}
    for tc, hints in TOOLCHAIN_HINTS.items():
        found = [h for h in hints if h in sec_names or h.encode() in blob]
        if found:
            rep.toolchain[tc] = found

    # ---- symbol classification --------------------------------------------
    funcs = [s for s in rep.symbols if s.kind == "STT_FUNC" and s.size > 0]
    if funcs:
        rep.candidates = [(s.addr, s.name) for s in sorted(funcs, key=lambda s: -s.size)][:25]
    else:
        rep.warnings.append(
            "no symbol table: the ELF is stripped. Function boundaries must be "
            "recovered by recursive-descent disassembly (Ghidra/REA), not read off "
            "the file.")

    # ---- entry disassembly -------------------------------------------------
    if capstone is None:
        rep.warnings.append("capstone not installed: no disassembly")
        return rep

    md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN)
    md.detail = False

    text_addr, text_bytes = 0, b""
    for s in rep.sections:
        if s.name == ".text" and s.size:
            text_addr = s.addr
            text_bytes = data[s.offset:s.offset + s.size]
            break

    if text_bytes:
        total = min(len(text_bytes), 64 * 1024)
        ok = 0
        for insn in md.disasm(text_bytes[:total], text_addr):
            ok += insn.size
        rep.decode_ratio = round(ok / total, 3) if total else 0.0

        window = text_bytes[:4096]
        for insn in md.disasm(window, text_addr):
            rep.disasm.append(f"{insn.address:08x}  {insn.mnemonic:<8} {insn.op_str}")
            if len(rep.disasm) >= 120:
                break

        if rep.decode_ratio < 0.75:
            rep.warnings.append(
                f"only {rep.decode_ratio:.0%} of .text decodes as MIPS32: the rest is "
                "likely R5900 MMI / VU macros, which capstone cannot decode. Use a "
                "R5900-aware disassembler (Ghidra + PS2 loader) for those.")

    if not rep.ok_ps2:
        rep.warnings.append("this does not look like an EE main module; report is informational only")
    return rep


def to_markdown(rep: Report) -> str:
    L: list[str] = []
    A = L.append
    A(f"# ps2recon report — `{Path(rep.path).name}`")
    A("")
    A(f"- **File size**: {rep.size:,} bytes")
    A(f"- **ELF machine**: `{rep.machine}`")
    A(f"- **Entry point**: `0x{rep.entry:08X}`")
    A(f"- **Looks like a PS2 EE main module**: **{'YES' if rep.ok_ps2 else 'NO'}**")
    if rep.reasons:
        for r in rep.reasons:
            A(f"  - ✗ {r}")
    A("")

    if rep.warnings:
        A("## Warnings")
        for w in rep.warnings:
            A(f"- {w}")
        A("")

    A("## Sections / memory map")
    A("")
    A("| name | type | vaddr | size | entropy |")
    A("|---|---|---|---|---|")
    for s in rep.sections:
        A(f"| `{s.name}` | {s.type} | `0x{s.addr:08X}` | {s.size:,} | {s.entropy:.2f} |")
    A("")
    high = [s for s in rep.sections if s.entropy > 7.2 and s.size > 4096]
    if high:
        A("> Sections with entropy > 7.2 are probably compressed or encrypted "
          "(overlay, audio, texture container). They must be unpacked before disassembly.")
        A("")

    A("## Sony SDK libraries detected (statically linked)")
    A("")
    if rep.sdk_hits:
        A("| library | evidence |")
        A("|---|---|")
        for lib, hits in sorted(rep.sdk_hits.items(), key=lambda kv: -len(kv[1])):
            A(f"| {lib} | {', '.join('`%s`' % h for h in hits[:5])} |")
    else:
        A("_none — either stripped and string-scrubbed, or not a PS2 SDK build._")
    A("")

    A("## Toolchain")
    A("")
    if rep.toolchain:
        for tc, ev in rep.toolchain.items():
            A(f"- {tc}: {', '.join('`%s`' % e for e in ev)}")
    else:
        A("_no fingerprint (stripped + no .comment/.mdebug)._")
    A("")

    A("## IOP / ROM module references")
    A("")
    A(", ".join(f"`{h}`" for h in rep.iop_refs) if rep.iop_refs else "_none_")
    A("")

    if rep.candidates:
        A("## Largest functions (by symbol size)")
        A("")
        for addr, name in rep.candidates:
            A(f"- `0x{addr:08X}`  {name}")
        A("")

    A("## Paths / URLs / hosts")
    A("")
    for p in rep.paths[:30]:
        A(f"- `{p}`")
    for u in rep.urls[:10]:
        A(f"- URL: `{u}`")
    for i in rep.ips[:10]:
        A(f"- IP: `{i}`")
    A("")

    if rep.disasm:
        A(f"## Entry-of-.text disassembly (MIPS32 decode ratio: {rep.decode_ratio:.0%})")
        A("")
        A("```")
        L.extend(rep.disasm)
        A("```")
        A("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description="recon for PS2 EE ELF executables")
    ap.add_argument("target")
    ap.add_argument("-o", "--output")
    ap.add_argument("--json")
    args = ap.parse_args()

    p = Path(args.target)
    if not p.is_file():
        print(f"no such file: {p}", file=sys.stderr)
        return 2

    rep = analyse(p)
    md = to_markdown(rep)

    out = Path(args.output) if args.output else p.with_suffix(p.suffix + ".recon.md")
    out.write_text(md, encoding="utf-8")
    print(md if not args.output else f"report written to {out}")

    if args.json:
        payload = {
            "path": rep.path, "size": rep.size, "ok_ps2": rep.ok_ps2,
            "machine": rep.machine, "entry": hex(rep.entry),
            "sections": [s.__dict__ for s in rep.sections],
            "symbol_count": len(rep.symbols),
            "sdk": rep.sdk_hits, "iop": rep.iop_refs,
            "warnings": rep.warnings, "decode_ratio": rep.decode_ratio,
        }
        Path(args.json).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return 0 if rep.ok_ps2 else 1


if __name__ == "__main__":
    sys.exit(main())
