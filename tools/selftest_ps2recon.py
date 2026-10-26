#!/usr/bin/env python3
"""Self-test for tools/ps2recon.py.

We have no PS2 binary in this repo, so we manufacture a stand-in: compile a tiny
ELF with the host gcc, patch e_machine to EM_MIPS, and overwrite the first words
of .text with hand-assembled MIPS32 little-endian instructions. That exercises
every code path of the recon tool (section walk, symbol walk, SDK fingerprint,
strings, entry disassembly) without needing a real disc.

It does NOT validate PS2-specific semantics - only that the tool plumbing works.
Run: python3 tools/selftest_ps2recon.py
"""
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "ps2recon.py"

C_SRC = r"""
/* freestanding: gcc -m32 -nostdlib gives us a real ELF32 with a symbol table
   and a .rodata we control, without needing any 32-bit libc installed. */
const char banner[] = "scePadRead libgraph IOPRP rom0:LIBSD // build 1.03";
void sceSifCallRpc(void) {}
void sceGsSyncPath(void) {}
void sceDmaSend(void) {}
void _start(void) {}
"""

# MIPS32 LE: addiu $sp,$sp,-24 ; sw $ra,20($sp) ; jal 0x00100040 ; nop ; jr $ra ; nop
MIPS_TEXT = bytes.fromhex(
    "e8ffbd27" "1400bfaf" "0000000c" "40000000"
    "00000000" "0800e003" "00000000" "00000000"
)


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    src = tmp / "t.c"
    src.write_text(C_SRC)
    elf = tmp / "SLUS_203.62"
    subprocess.run(["gcc", "-m32", "-O0", "-nostdlib", "-nostartfiles", "-no-pie",
                    "-Wl,-e,_start", "-o", str(elf), str(src)], check=True)

    buf = bytearray(elf.read_bytes())
    # e_machine (offset 0x12, 2 bytes LE) -> EM_MIPS = 8
    struct.pack_into("<H", buf, 0x12, 8)

    with open(elf, "rb") as fh:
        e = ELFFile(fh)
        text = e.get_section_by_name(".text")
        off, addr = text["sh_offset"], text["sh_addr"]

    buf[off:off + len(MIPS_TEXT)] = MIPS_TEXT
    elf.write_bytes(bytes(buf))

    print(f"[selftest] fake EE module: {elf} (.text @ 0x{addr:X})")
    r = subprocess.run([sys.executable, str(TOOL), str(elf),
                        "-o", str(tmp / "r.md"), "--json", str(tmp / "r.json")],
                       capture_output=True, text=True)
    print(r.stdout[:1500])
    if r.stderr:
        print("STDERR:", r.stderr[:800])

    md = (tmp / "r.md").read_text()
    checks = {
        "recognised as PS2 EE module": "**YES**" in md,
        "SDK libpad detected": "libpad" in md,
        "SDK libgraph detected": "libgraph" in md,
        "RPC (EE<->IOP) detected": "libsif" in md,
        "IOP module ref found": "rom0:" in md,
        "MIPS disassembly present": "addiu" in md or "sw" in md,
    }
    ok = True
    for name, res in checks.items():
        print(f"  [{'PASS' if res else 'FAIL'}] {name}")
        ok &= res
    print("\n[selftest]", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
