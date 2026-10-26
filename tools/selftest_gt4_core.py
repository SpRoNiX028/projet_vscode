#!/usr/bin/env python3
"""Self-test for tools/gt4_core.py.

No GT4 disc here, so we synthesise a CORE file that follows the documented
layout, then check the whole chain: parse -> dedupe -> build_elf -> ps2recon.
Also synthesises a GT4.VOL header for the volume reader.

Run: python3 tools/selftest_gt4_core.py
"""
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "gt4_core.py"
RECON = ROOT / "tools" / "ps2recon.py"

sys.path.insert(0, str(ROOT / "tools"))
import gt4_core  # noqa: E402

HASH_A = b"gt4-engine-hash-deadbeef"
HASH_B = b"polyphony-build-hash-cafebabe"


def make_core(entry: int, sections: list[tuple[int, bytes]]) -> bytes:
    body = b""
    for h in (HASH_A, HASH_B):
        body += struct.pack("<H", len(h)) + h
    body += struct.pack("<iI", len(sections), entry)
    for addr, blob in sections:
        body += struct.pack("<Ii", addr, len(blob)) + blob
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = co.compress(body) + co.flush()
    return struct.pack("<HI", 0x0001, len(body)) + packed


def main() -> int:
    tmp = Path(tempfile.mkdtemp())

    text = bytearray(4096)
    # a few real MIPS32 instructions so ps2recon's decoder finds phantoms
    text[0:8] = bytes.fromhex("e8ffbd27" "1400bfaf")
    text[len(text) - 24:len(text) - 16] = bytes.fromhex("0800e003" "00000000")
    entry = 0x00100008
    sections = [(0x00100000, bytes(text)), (0x00200000, bytes(range(256)) * 4)]
    # retail GT4 quirk: the last 24 bytes of .text repeated as their own section
    sections.append((0x00100FE8, bytes(text)[-24:]))

    core = tmp / "CORE.GT4"
    core.write_bytes(make_core(entry, sections))
    print(f"[selftest] synthetic CORE.GT4: {core} ({core.stat().st_size} bytes)\n")

    info = subprocess.run([sys.executable, str(TOOL), str(core), "--info"],
                          capture_output=True, text=True).stdout
    print(info)

    elf_path = tmp / "CORE.GT4.elf"
    conv = subprocess.run([sys.executable, str(TOOL), str(core), "--to-elf", str(elf_path)],
                          capture_output=True, text=True)
    elfinfo = subprocess.run([sys.executable, str(TOOL), str(elf_path), "--elf-info"],
                             capture_output=True, text=True).stdout
    print(conv.stdout[-400:])
    print(elfinfo)

    recon = subprocess.run([sys.executable, str(RECON), str(elf_path),
                            "-o", str(tmp / "r.md")], capture_output=True, text=True)
    rebuilt = tmp / "r.md"
    md = rebuilt.read_text() if rebuilt.exists() else ""

    # round-trip: re-parsing the produced ELF's segments must hold the same bytes
    parsed = gt4_core.parse_core(core.read_bytes())
    loaded = gt4_core.drop_duplicates(parsed["sections"])
    elf_bytes = elf_path.read_bytes()
    mod = __import__("elftools.elf.elffile", fromlist=["ELFFile"]).ELFFile
    import io
    ef = mod(io.BytesIO(elf_bytes))
    seg_ok = True
    for (addr, blob) in loaded:
        found = False
        for seg in ef.iter_segments():
            if seg["p_type"] != "PT_LOAD":
                continue
            h = seg.header
            if h["p_vaddr"] == addr and h["p_filesz"] == len(blob):
                found = seg.data() == blob
                break
        seg_ok &= found

    vol = tmp / "GT4.VOL"
    header = struct.pack("<IHHiiHH", gt4_core.VOL_MAGIC_ENC, 3, 1, 0x1234, 9, 0x800, 2)
    header += bytes(0x40 - len(header)) + bytes(0x800 * 9)
    vol.write_bytes(header)
    volout = subprocess.run([sys.executable, str(TOOL), str(vol), "--vol"],
                            capture_output=True, text=True).stdout
    print(volout)

    checks = {
        "parses entry 0x00100008": "0x00100008" in info,
        "detects 3 sections": "sections   : 3" in info,
        "drops the duplicated tail section": "dropped 1 section" in info,
        "writes a valid ELF": elf_path.exists() and elf_bytes[:4] == b"\x7fELF",
        "ELF is ELF32 LE MIPS": "ELF32 LE EM_MIPS" in elfinfo,
        "ELF entry preserved": "0x00100008" in elfinfo,
        "e_flags = PS2 EE": "0x20924001" in elfinfo,
        "segments byte-identical to CORE": seg_ok,
        "ps2recon accepts converted ELF": "**YES**" in md,
        "ps2recon finds MIPS code": "addiu" in md,
        "VOL header decoded": "RoFS 3.1" in volout,
        "VOL marked encrypted": "ENCRYPTED" in volout,
    }
    ok = True
    for name, res in checks.items():
        print(f"  [{'PASS' if res else 'FAIL'}] {name}")
        ok &= res
    print("\n[selftest]", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
