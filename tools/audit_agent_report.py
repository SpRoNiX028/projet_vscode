#!/usr/bin/env python3
"""audit_agent_report - verify an AI agent's claims about a binary, byte by byte.

A reverse-engineering report is only worth the claims that can be re-checked.
This tool takes a claims file (JSON) and the artefacts the report talks about,
then returns PASS / FAIL / UNKNOWN for every assertion.

Typical use: an agent says "main starts at 0x01000558, reserves 208 bytes of
stack, and the CORE header declares 6,119,116 decompressed bytes". Run this and
you learn in one second whether the file actually contains that.

Claim kinds
-----------
  file_size            {"value": 273020}
  file_sha256          {"value": "a8dd..."}
  elf_header           {"field": "entry"|"e_flags"|"machine"|"class"|"endian", "value": ...}
  reginfo_gp           {"value": "0x01049770"}
  segment              {"start": "0x01000000", "end": "0x0102dc54", "perm": "r-x"}
  insn                 {"addr": "0x01000210", "mnemonic": "jal", "target": "0x01000558"}
  function_prologue    {"addr": "0x01000558", "frame_size": 208}
  string_present       {"value": "PDISTD::InflateBase"}
  core_header          {"flags": "0x0101", "decompressed_size": 6119116}

Usage
-----
    python3 tools/audit_agent_report.py --elf gt4_principal.elf \
        --core core.gt4 --claims claims/gt4_report_claims.json

Exit code: 0 if no FAIL, 1 if at least one claim is contradicted by the file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import capstone
except ImportError:  # pragma: no cover
    capstone = None

try:
    import gt4_core
except ImportError:  # pragma: no cover
    gt4_core = None

PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"


@dataclass
class Result:
    claim: str
    status: str
    evidence: str


# ---------------------------------------------------------------------------
# Minimal ELF32 reader (no external deps)
# ---------------------------------------------------------------------------
class Elf32:
    def __init__(self, raw: bytes):
        if raw[:4] != b"\x7fELF":
            raise ValueError("not an ELF")
        self.raw = raw
        self.cls = raw[4]
        self.endian = raw[5]
        if self.cls != 1:
            raise ValueError(f"expected ELF32, got class {self.cls}")
        bo = "<" if self.endian == 1 else ">"
        self._bo = bo
        self.machine = struct.unpack_from(bo + "H", raw, 0x12)[0]
        self.entry = struct.unpack_from(bo + "I", raw, 0x18)[0]
        self.phoff = struct.unpack_from(bo + "I", raw, 0x1C)[0]
        self.shoff = struct.unpack_from(bo + "I", raw, 0x20)[0]
        self.eflags = struct.unpack_from(bo + "I", raw, 0x24)[0]
        self.phentsize = struct.unpack_from(bo + "H", raw, 0x2A)[0]
        self.phnum = struct.unpack_from(bo + "H", raw, 0x2C)[0]
        self.shentsize = struct.unpack_from(bo + "H", raw, 0x2E)[0]
        self.shnum = struct.unpack_from(bo + "H", raw, 0x30)[0]
        self.shstrndx = struct.unpack_from(bo + "H", raw, 0x32)[0]
        self.segments = []
        for i in range(self.phnum):
            off = self.phoff + i * self.phentsize
            p_type, p_off, p_vaddr, p_paddr, p_filesz, p_memsz, p_flags, _ = struct.unpack_from(
                bo + "8I", raw, off)
            if p_type == 1:
                self.segments.append({"off": p_off, "vaddr": p_vaddr,
                                      "filesz": p_filesz, "memsz": p_memsz,
                                      "flags": p_flags})
        self.sections = self._read_sections()

    def _read_sections(self) -> dict[str, dict]:
        if not self.shoff or not self.shnum:
            return {}
        bo = self._bo
        raw_sections = []
        for i in range(self.shnum):
            off = self.shoff + i * self.shentsize
            name, stype, flags, addr, offset, size = struct.unpack_from(bo + "6I", raw if False else self.raw, off)
            raw_sections.append({"name_off": name, "type": stype, "flags": flags,
                                 "addr": addr, "offset": offset, "size": size})
        strtab = b""
        if self.shstrndx < len(raw_sections):
            s = raw_sections[self.shstrndx]
            strtab = self.raw[s["offset"]:s["offset"] + s["size"]]
        out = {}
        for s in raw_sections:
            end = strtab.find(b"\0", s["name_off"])
            name = strtab[s["name_off"]:end if end >= 0 else None].decode("latin-1")
            if name:
                out[name] = s
        return out

    def read_vaddr(self, vaddr: int, size: int) -> bytes | None:
        for seg in self.segments:
            if seg["vaddr"] <= vaddr < seg["vaddr"] + seg["filesz"]:
                delta = vaddr - seg["vaddr"]
                start = seg["off"] + delta
                return self.raw[start:start + size]
        return None

    def all_data(self) -> bytes:
        return self.raw


# ---------------------------------------------------------------------------
# Instruction helpers
# ---------------------------------------------------------------------------
def decode_word(word: int) -> str:
    """Name the encoding of one MIPS word without capstone (for jal/j/lui/addiu)."""
    op = (word >> 26) & 0x3F
    if op == 0x02:
        return "j"
    if op == 0x03:
        return "jal"
    if op == 0x0F:
        return "lui"
    if op == 0x09:
        return "addiu"
    if op == 0x23:
        return "lw"
    return f"opcode 0x{op:02x}"


def jal_target(word: int) -> int:
    return (word & 0x03FFFFFF) << 2


def _disasm(elf: Elf32, addr: int):
    if capstone is None:
        return None
    blob = elf.read_vaddr(addr, 16)
    if not blob:
        return None
    md = capstone.Cs(capstone.CS_ARCH_MIPS,
                     capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN)
    for insn in md.disasm(blob, addr):
        return insn
    return None


# ---------------------------------------------------------------------------
# Claim checkers
# ---------------------------------------------------------------------------
def check_claim(claim: dict, elf: Elf32 | None, elf_raw: bytes | None,
                core_raw: bytes | None) -> Result:
    kind = claim.get("kind", "?")
    label = claim.get("label") or json.dumps(claim, ensure_ascii=False)

    try:
        if kind == "file_size":
            target = core_raw if claim.get("on") == "core" else elf_raw
            if target is None:
                return Result(label, UNKNOWN, f"no file for on={claim.get('on', 'elf')}")
            ok = len(target) == claim["value"]
            return Result(label, PASS if ok else FAIL,
                          f"actual {len(target):,} bytes, claimed {claim['value']:,}")

        if kind == "file_sha256":
            target = core_raw if claim.get("on") == "core" else elf_raw
            if target is None:
                return Result(label, UNKNOWN, f"no file for on={claim.get('on', 'elf')}")
            actual = hashlib.sha256(target).hexdigest()
            ok = actual == claim["value"].lower()
            return Result(label, PASS if ok else FAIL,
                          f"actual {actual[:32]}…" if not ok else "hash matches")

        if kind == "elf_header":
            if elf is None:
                return Result(label, UNKNOWN, "no --elf given")
            field = claim["field"]
            got = {"entry": elf.entry, "e_flags": elf.eflags, "machine": elf.machine,
                   "class": elf.cls, "endian": elf.endian}[field]
            want = claim["value"]
            if isinstance(want, str):
                want = int(want, 0)
            ok = got == want
            fmt = (lambda v: v) if field == "machine" else (lambda v: hex(v))
            return Result(label, PASS if ok else FAIL,
                          f"actual {fmt(got)}, claimed {fmt(want)}")

        if kind == "reginfo_gp":
            if elf is None:
                return Result(label, UNKNOWN, "no --elf given")
            sec = elf.sections.get(".reginfo")
            if not sec:
                return Result(label, FAIL, "no .reginfo section in the ELF")
            blob = elf.raw[sec["offset"]:sec["offset"] + sec["size"]]
            if len(blob) < 24:
                return Result(label, FAIL, f".reginfo too short ({len(blob)} bytes, need 24)")
            gp = struct.unpack_from("<I", blob, 20)[0]
            want = int(claim["value"], 0)
            ok = gp == want
            return Result(label, PASS if ok else FAIL,
                          f"actual gp {gp:#010x}, claimed {want:#010x}")

        if kind == "segment":
            if elf is None:
                return Result(label, UNKNOWN, "no --elf given")
            want_start = int(claim["start"], 0)
            want_end = int(claim["end"], 0)
            want_perm = claim.get("perm")
            for seg in elf.segments:
                start = seg["vaddr"]
                end = seg["vaddr"] + seg["filesz"]
                if start == want_start and end == want_end:
                    actual_perm = ("r" if seg["flags"] & 4 else "-") + \
                                  ("w" if seg["flags"] & 2 else "-") + \
                                  ("x" if seg["flags"] & 1 else "-")
                    if want_perm and actual_perm != want_perm:
                        return Result(label, FAIL,
                                      f"range matches but perms are {actual_perm}, claimed {want_perm}")
                    return Result(label, PASS,
                                  f"found LOAD {start:#010x}-{end:#010x} ({actual_perm})")
            ranges = ", ".join(f"{s['vaddr']:#010x}-{s['vaddr'] + s['filesz']:#010x}"
                               for s in elf.segments)
            return Result(label, FAIL, f"no LOAD {want_start:#010x}-{want_end:#010x}; have {ranges}")

        if kind == "insn":
            if elf is None:
                return Result(label, UNKNOWN, "no --elf given")
            addr = int(claim["addr"], 0)
            blob = elf.read_vaddr(addr, 8)
            if not blob or len(blob) < 4:
                return Result(label, FAIL, f"address {addr:#010x} is not mapped in a LOAD segment")
            word = struct.unpack_from("<I", blob, 0)[0]
            insn = _disasm(elf, addr)
            if insn is not None:
                mn, ops = insn.mnemonic, insn.op_str
            else:
                mn, ops = decode_word(word), ""
            want_mn = claim["mnemonic"]
            ok = mn == want_mn
            detail = f"actual `{mn} {ops}` (word {word:#010x})"
            if ok and "target" in claim:
                want_t = int(claim["target"], 0)
                got_t = jal_target(word) if mn in ("jal", "j") else None
                ok = got_t == want_t
                detail += f", target {got_t:#010x}" if got_t is not None else ", no branch target"
            return Result(label, PASS if ok else FAIL, detail)

        if kind == "function_prologue":
            if elf is None:
                return Result(label, UNKNOWN, "no --elf given")
            addr = int(claim["addr"], 0)
            blob = elf.read_vaddr(addr, 8)
            if not blob or len(blob) < 4:
                return Result(label, FAIL, f"address {addr:#010x} is not mapped")
            word = struct.unpack_from("<I", blob, 0)[0]
            op = (word >> 26) & 0x3F
            rs = (word >> 21) & 0x1F
            rt = (word >> 16) & 0x1F
            imm = struct.unpack("<h", struct.pack("<H", word & 0xFFFF))[0]
            if op != 0x09 or rs != 29 or rt != 29:
                insn = _disasm(elf, addr)
                shown = f"{insn.mnemonic} {insn.op_str}" if insn else f"word {word:#010x}"
                return Result(label, FAIL,
                              f"not a stack-frame prologue (`{shown}`); "
                              f"claimed frame of {claim['frame_size']} bytes")
            ok = imm == -claim["frame_size"]
            return Result(label, PASS if ok else FAIL,
                          f"actual `addiu $sp,$sp,{imm}`, claimed -{claim['frame_size']}")

        if kind == "string_present":
            if elf_raw is None:
                return Result(label, UNKNOWN, "no --elf given")
            needle = claim["value"].encode()
            found = needle in elf_raw
            return Result(label, PASS if found else FAIL,
                          "string found in the file" if found else "string absent from the file")

        if kind == "core_header":
            target = core_raw
            if target is None:
                return Result(label, UNKNOWN, "no --core given")
            if gt4_core is None:
                flags, size = struct.unpack_from("<HI", target, 0)
                parsed = None
            else:
                try:
                    parsed = gt4_core.parse_core(target)
                except Exception as exc:  # noqa: BLE001
                    return Result(label, FAIL, f"core does not parse: {exc}")
                flags, size = parsed["flags"], struct.unpack_from("<I", target, 2)[0]
            ok = True
            details = []
            if "flags" in claim:
                want = int(claim["flags"], 0)
                ok &= flags == want
                details.append(f"flags actual {flags:#06x}, claimed {want:#06x}")
            if "decompressed_size" in claim:
                want = claim["decompressed_size"]
                ok &= size == want
                details.append(f"declared size actual {size:,}, claimed {want:,}")
            if parsed is not None:
                total = sum(len(b) for _, b in parsed["sections"])
                details.append(f"{len(parsed['sections'])} sections, {total:,} bytes of payload")
            return Result(label, PASS if ok else FAIL, "; ".join(details))

        return Result(label, UNKNOWN, f"unknown claim kind {kind!r}")
    except KeyError as exc:
        return Result(label, UNKNOWN, f"claim is missing field {exc}")


def main() -> int:
    ap = argparse.ArgumentParser(description="verify an agent's binary claims")
    ap.add_argument("--elf")
    ap.add_argument("--core")
    ap.add_argument("--claims", required=True)
    ap.add_argument("--json-out")
    args = ap.parse_args()

    elf_raw = Path(args.elf).read_bytes() if args.elf else None
    core_raw = Path(args.core).read_bytes() if args.core else None
    elf = None
    if elf_raw is not None:
        try:
            elf = Elf32(elf_raw)
        except ValueError as exc:
            print(f"warning: {args.elf}: {exc}", file=sys.stderr)

    claims = json.loads(Path(args.claims).read_text(encoding="utf-8"))
    items = claims["claims"] if isinstance(claims, dict) else claims

    results = [check_claim(c, elf, elf_raw, core_raw) for c in items]

    print(f"{'STATUS':<8} {'CLAIM':<58} EVIDENCE")
    print("-" * 120)
    for r in results:
        label = r.claim if len(r.claim) <= 58 else r.claim[:55] + "..."
        print(f"{r.status:<8} {label:<58} {r.evidence}")

    counts = {s: sum(1 for r in results if r.status == s) for s in (PASS, FAIL, UNKNOWN)}
    print("-" * 120)
    print(f"{counts[PASS]} verified · {counts[FAIL]} contradicted · {counts[UNKNOWN]} unverifiable")

    if counts[FAIL]:
        print("\nVERDICT: the report does not describe this file (or is wrong on those points).")
    elif counts[UNKNOWN]:
        print("\nVERDICT: everything checkable holds; the rest needs the missing artefact or tool.")
    else:
        print("\nVERDICT: every claim checked out against the file.")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(
            [{"claim": r.claim, "status": r.status, "evidence": r.evidence} for r in results],
            indent=2, ensure_ascii=False), encoding="utf-8")
    return 1 if counts[FAIL] else 0


if __name__ == "__main__":
    sys.exit(main())
