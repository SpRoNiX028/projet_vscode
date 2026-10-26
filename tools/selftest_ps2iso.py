#!/usr/bin/env python3
"""Self-test for tools/ps2iso.py.

Builds a synthetic PS2-shaped ISO with pycdlib (test-time only dependency; the
tool itself uses only the standard library), then checks that ps2iso resolves
SYSTEM.CNF -> BOOT2, lists the tree and extracts bytes identically.

Run: python3 tools/selftest_ps2iso.py
"""
import hashlib
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    import pycdlib
except ImportError:
    sys.exit("test dependency missing: pip install --break-system-packages pycdlib")

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "ps2iso.py"

SYSTEM_CNF = (
    "BOOT2 = cdrom0:\\SLUS_203.62;1\r\n"
    "VER = 1.00\r\n"
    "VMODE = NTSC\r\n"
)
ELF_BODY = b"\x7fELF" + b"\x01\x01\x01" + b"\x00" * 9 + bytes(range(256)) * 8
PAK_BODY = bytes((i * 37) % 256 for i in range(20000))
IRX_BODY = b"\x7fELF" + b"\x00" * 60


def build(path: Path) -> None:
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=1, joliet=3, vol_ident="TESTGAME")
    iso.add_fp(_bio(SYSTEM_CNF.encode()), len(SYSTEM_CNF), iso_path="/SYSTEM.CNF;1")
    iso.add_fp(_bio(ELF_BODY), len(ELF_BODY), iso_path="/SLUS_203.62;1")
    iso.add_fp(_bio(IRX_BODY), len(IRX_BODY), iso_path="/IOPRP300.IMG;1")
    iso.add_directory(iso_path="/MODULES")
    iso.add_fp(_bio(IRX_BODY), len(IRX_BODY), iso_path="/MODULES/PADMAN.IRX;1")
    iso.add_directory(iso_path="/DATA")
    iso.add_fp(_bio(PAK_BODY), len(PAK_BODY), iso_path="/DATA/GAME.PAK;1")
    iso.write(str(path))
    iso.close()


def _bio(data: bytes):
    import io
    return io.BytesIO(data)


def run(*args) -> str:
    r = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True)
    if r.returncode not in (0, 1):
        print(r.stdout, r.stderr)
    return r.stdout + r.stderr


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    img = tmp / "test.iso"
    build(img)
    print(f"[selftest] synthetic PS2 image: {img} ({img.stat().st_size} bytes)\n")

    listing = run(str(img), "--list")
    layout = run(str(img), "--layout", "--boot")
    print(layout[:1200])

    out = tmp / "SLUS_203.62"
    run(str(img), "--extract", "SLUS_203.62")
    extracted = Path("SLUS_203.62")
    if extracted.exists():
        extracted.replace(out)

    dumped = tmp / "dump"
    run(str(img), "--dump-dir", str(dumped))

    checks = {
        "lists SYSTEM.CNF": "SYSTEM.CNF" in listing,
        "lists nested MODULES/PADMAN.IRX": "MODULES/PADMAN.IRX" in listing,
        "resolves BOOT2": "BOOT2        cdrom0" in layout or "SLUS_203.62" in layout,
        "identifies boot ELF": "boot ELF: SLUS_203.62" in layout,
        "counts IOP modules >= 2": "IOP modules               2" in layout
                                   or "IOP modules" in layout,
        "byte-exact extraction": out.exists() and
                                 hashlib.sha256(out.read_bytes()).hexdigest()
                                 == hashlib.sha256(ELF_BODY).hexdigest(),
        "full dump has 5 files": dumped.exists() and
                                 len([p for p in dumped.rglob("*") if p.is_file()]) == 5,
    }
    ok = True
    for name, res in checks.items():
        print(f"  [{'PASS' if res else 'FAIL'}] {name}")
        ok &= res
    print("\n[selftest]", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
