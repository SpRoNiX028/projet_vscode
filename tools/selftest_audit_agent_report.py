#!/usr/bin/env python3
"""Self-test for tools/audit_agent_report.py.

Builds a synthetic PS2-style ELF (two PT_LOADs, .text/.data/.reginfo/.shstrtab)
plus a synthetic CORE, then runs the auditor twice:

  * with claims that match the file  -> every check must PASS
  * with claims that do not          -> every check must FAIL

The second run is the important one: a report auditor that cannot say "no" is
worthless, so the test proves it catches a wrong hash, a wrong entry point, a
wrong stack frame, a wrong branch target, and an invented string.

Run: python3 tools/selftest_audit_agent_report.py
"""
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "audit_agent_report.py"

TEXT_ADDR, TEXT_SIZE = 0x01000000, 0x1000
DATA_ADDR, DATA_SIZE = 0x01001000, 0x200
GP = 0x01049770
ENTRY = 0x01000008
MAIN = 0x01000558


def build_elf() -> bytes:
    text = bytearray(TEXT_SIZE)
    struct.pack_into("<I", text, 0x10, 0x0C400156)   # jal 0x01000558
    struct.pack_into("<I", text, 0x14, 0x24450004)   # addiu $a1,$v0,4
    struct.pack_into("<I", text, 0x200, 0x27BDFF30)  # addiu $sp,$sp,-208
    data = bytearray(DATA_SIZE)
    blob = b"PDISTD::InflateBase\0sio2man\0IOPRP300.IMG;\0"
    data[:len(blob)] = blob

    reginfo = struct.pack("<I", 0xFFFFFFFF) + b"\xff" * 16 + struct.pack("<I", GP)

    names = b"\0.text\0.data\0.reginfo\0.shstrtab\0"
    off_hdr = 52
    off_ph = off_hdr
    off_text = 0x100
    off_data = off_text + TEXT_SIZE
    off_reg = off_data + DATA_SIZE
    off_names = off_reg + len(reginfo)
    off_sh = (off_names + len(names) + 15) & ~0xF

    phdrs = b""
    for (vaddr, off, size, flags) in ((TEXT_ADDR, off_text, TEXT_SIZE, 5),
                                      (DATA_ADDR, off_data, DATA_SIZE, 6)):
        phdrs += struct.pack("<8I", 1, off, vaddr, vaddr, size, size, flags, 0x10)

    shdrs = bytes(40)
    shdrs += struct.pack("<10I", 1, 1, 0x6, TEXT_ADDR, off_text, TEXT_SIZE, 0, 0, 16, 0)
    shdrs += struct.pack("<10I", 7, 1, 0x3, DATA_ADDR, off_data, DATA_SIZE, 0, 0, 16, 0)
    shdrs += struct.pack("<10I", 13, 1, 0x2, 0, off_reg, len(reginfo), 0, 0, 4, 0)
    shdrs += struct.pack("<10I", 22, 3, 0, 0, off_names, len(names), 0, 0, 1, 0)

    ident = b"\x7fELF" + bytes([1, 1, 1, 0]) + bytes(8)
    header = ident + struct.pack(
        "<HHIIIIIHHHHHH", 2, 8, 1, ENTRY, off_ph, off_sh, 0x20924001,
        52, 32, 2, 40, 5, 4)

    out = bytearray(header + phdrs)
    out += bytes(off_text - len(out)) + text
    out += data + reginfo + names
    out += bytes(off_sh - len(out)) + shdrs
    return bytes(out)


def build_core() -> bytes:
    body = b""
    for h in (b"hash-a", b"hash-b"):
        body += struct.pack("<H", len(h)) + h
    blob = bytes(range(256)) * 16
    body += struct.pack("<iI", 1, 0x00100008) + struct.pack("<Ii", 0x00100000, len(blob)) + blob
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = co.compress(body) + co.flush()
    return struct.pack("<HI", 0x0101, len(body)) + packed


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    elf = build_elf()
    core = build_core()
    (tmp / "gt4_principal.elf").write_bytes(elf)
    (tmp / "core.gt4").write_bytes(core)

    honest = {"claims": [
        {"kind": "file_size", "value": len(elf), "on": "elf", "label": "taille ELF"},
        {"kind": "file_sha256", "value": hashlib.sha256(elf).hexdigest(), "on": "elf", "label": "sha256 ELF"},
        {"kind": "elf_header", "field": "machine", "value": "8", "label": "machine MIPS"},
        {"kind": "elf_header", "field": "entry", "value": hex(ENTRY), "label": "entree"},
        {"kind": "elf_header", "field": "e_flags", "value": "0x20924001", "label": "e_flags"},
        {"kind": "reginfo_gp", "value": hex(GP), "label": "gp .reginfo"},
        {"kind": "segment", "start": hex(TEXT_ADDR), "end": hex(TEXT_ADDR + TEXT_SIZE),
         "perm": "r-x", "label": "segment code r-x"},
        {"kind": "insn", "addr": "0x01000010", "mnemonic": "jal", "target": hex(MAIN),
         "label": "jal main"},
        {"kind": "insn", "addr": "0x01000014", "mnemonic": "addiu", "label": "delay slot"},
        {"kind": "function_prologue", "addr": "0x01000200", "frame_size": 208, "label": "cadre 208"},
        {"kind": "string_present", "value": "PDISTD::InflateBase", "label": "RTTI present"},
        {"kind": "file_size", "value": len(core), "on": "core", "label": "taille CORE"},
        {"kind": "core_header", "flags": "0x0101", "label": "flags CORE"},
    ]}

    lying = {"claims": [
        {"kind": "file_sha256", "value": "00" * 32, "on": "elf", "label": "sha256 faux"},
        {"kind": "elf_header", "field": "entry", "value": "0x01000000", "label": "entree fausse"},
        {"kind": "reginfo_gp", "value": "0x01000000", "label": "gp faux"},
        {"kind": "segment", "start": "0x01000000", "end": "0x0102dc54", "label": "segment inexistant"},
        {"kind": "insn", "addr": "0x01000010", "mnemonic": "jal", "target": "0x01000999",
         "label": "cible de jal fausse"},
        {"kind": "insn", "addr": "0x01000050", "mnemonic": "lw", "label": "instruction inexistante"},
        {"kind": "function_prologue", "addr": "0x01000200", "frame_size": 64, "label": "cadre faux"},
        {"kind": "function_prologue", "addr": "0x01000010", "frame_size": 32,
         "label": "pas un prologue"},
        {"kind": "string_present", "value": "ImageLoader::DiskSource", "label": "chaine inventee"},
        {"kind": "core_header", "flags": "0x0101", "decompressed_size": 6119116, "label": "taille CORE fausse"},
        {"kind": "file_size", "value": 273020, "on": "elf", "label": "taille ELF fausse"},
    ]}

    def run(claims, name):
        p = tmp / name
        p.write_text(json.dumps(claims), encoding="utf-8")
        r = subprocess.run([sys.executable, str(TOOL), "--elf", str(tmp / "gt4_principal.elf"),
                            "--core", str(tmp / "core.gt4"), "--claims", str(p),
                            "--json-out", str(tmp / (name + ".out.json"))],
                           capture_output=True, text=True)
        rows = json.loads((tmp / (name + ".out.json")).read_text()) if (
            tmp / (name + ".out.json")).exists() else []
        return r, rows

    r1, rows1 = run(honest, "honest.json")
    print("=== verite (doit tout valider) ===")
    print(r1.stdout)
    r2, rows2 = run(lying, "lying.json")
    print("=== mensonges (doit tout contredire) ===")
    print(r2.stdout)

    checks = {
        "honest: no contradiction": all(x["status"] != "FAIL" for x in rows1),
        "honest: at least 12 PASS": sum(x["status"] == "PASS" for x in rows1) >= 12,
        "lying: every claim FAIL": all(x["status"] == "FAIL" for x in rows2) and bool(rows2),
        "lying: exit code 1": r2.returncode == 1,
        "honest: exit code 0": r1.returncode == 0,
    }
    ok = True
    for name, res in checks.items():
        print(f"  [{'PASS' if res else 'FAIL'}] {name}")
        ok &= res
    print("\n[selftest]", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
