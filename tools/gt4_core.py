#!/usr/bin/env python3
"""gt4_core - inspect and convert Gran Turismo 4 / Tourist Trophy PS2 executables.

Why this exists
---------------
On a GT4 disc, the boot file (`SCUS_973.28` / `SCES_517.19`) is a tiny bootstrap.
The actual game code lives in **CORE.GT4**, which is *not* an ELF and *not* a
plain binary: it is a header + raw-deflate stream that expands to a list of
address/size sections, with the EE entry point in the middle.

So "analyse the game's ELF" is the wrong first step: there is no game ELF on the
disc. You must (1) extract CORE.GT4, (2) turn it into an ELF that tools can load,
(3) only then disassemble. This script does steps 1-check and 2 offline.

Two other PS2-side bonus modes are included because they are one-line checks that
save hours:
    --vol        : decode the GT4.VOL (RoFS 3.1) volume header
    --core-hash  : print SHA-1/SHA-256 so a build can be pinned

Format (reverse-engineered by the GT modding scene / gt4-decomp; implemented here
from the published description, no code copied):

    CORE (plain):
        u16 boot flags | u32 decompressed size | raw deflate (windowBits=-15)
        inflated:
            u16 hash_size, hash          (x2)
            i32 section_count, u32 entry
            section_count x (i32 EE address, i32 size, data)

    CORE (encrypted - Tourist Trophy, GT4 Online):
        u8[8] IV | Salsa20(body) | u32 CRC
        key = b"PolyphonyDigital" (16 bytes, "expand 16-byte k")

Usage
-----
    python3 tools/gt4_core.py CORE.GT4 --info
    python3 tools/gt4_core.py CORE.GT4 --to-elf CORE.GT4.elf
    python3 tools/gt4_core.py GT4.VOL --vol
    python3 tools/gt4_core.py CORE.GT4.elf --elf-info
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
import zlib
from pathlib import Path

SALSA20_KEY = b"PolyphonyDigital"
EE_EFLAGS = 0x20924001  # noreorder | 5900 | mips3, what ee-gcc emits
VOL_MAGIC_ENC = 0xAD90B9AC   # bytes AC B9 90 AD
VOL_MAGIC_PLAIN = b"RoFS"    # the negated magic: volume table not encrypted


# ---------------------------------------------------------------------------
# Salsa20/20, 16-byte key ("expand 16-byte k")
# ---------------------------------------------------------------------------
def _rotl(v: int, c: int) -> int:
    return ((v << c) & 0xFFFFFFFF) | (v >> (32 - c))


def _salsa20_block(key: bytes, iv: bytes, counter: int) -> bytes:
    k = struct.unpack("<4I", key)
    c = struct.unpack("<4I", b"expand 16-byte k")
    n = struct.unpack("<2I", iv)
    state = [c[0], *k, c[1], n[0], n[1], counter & 0xFFFFFFFF,
             (counter >> 32) & 0xFFFFFFFF, c[2], *k, c[3]]
    x = state[:]
    for _ in range(10):
        for a, b, cc, d in ((0, 4, 8, 12), (5, 9, 13, 1), (10, 14, 2, 6), (15, 3, 7, 11),
                            (0, 1, 2, 3), (5, 6, 7, 4), (10, 11, 8, 9), (15, 12, 13, 14)):
            x[b] ^= _rotl((x[a] + x[d]) & 0xFFFFFFFF, 7)
            x[cc] ^= _rotl((x[b] + x[a]) & 0xFFFFFFFF, 9)
            x[d] ^= _rotl((x[cc] + x[b]) & 0xFFFFFFFF, 13)
            x[a] ^= _rotl((x[d] + x[cc]) & 0xFFFFFFFF, 18)
    return struct.pack("<16I", *[(x[i] + state[i]) & 0xFFFFFFFF for i in range(16)])


def salsa20_decrypt(raw: bytes) -> bytes:
    """Encrypted CORE: IV = raw[:8], ciphertext = raw[8:-4], CRC = raw[-4:]."""
    iv, body = raw[:8], raw[8:-4]
    blocks = (len(body) + 63) // 64
    stream = b"".join(_salsa20_block(SALSA20_KEY, iv, i) for i in range(blocks))
    return (int.from_bytes(body, "little")
            ^ int.from_bytes(stream[:len(body)], "little")).to_bytes(len(body), "little")


# ---------------------------------------------------------------------------
# CORE parsing
# ---------------------------------------------------------------------------
class CoreError(Exception):
    pass


def _inflate(raw: bytes) -> tuple[int, bytes]:
    if len(raw) < 6:
        raise CoreError("file too small to be a CORE")
    flags, size = struct.unpack_from("<HI", raw, 0)
    inflater = zlib.decompressobj(-15)
    try:
        data = inflater.decompress(raw[6:])
    except zlib.error as exc:
        raise CoreError(f"not a CORE (deflate failed: {exc})") from exc
    if len(data) != size:
        raise CoreError(f"decompressed {len(data)} bytes, header declares {size}")
    return flags, data


def parse_core(raw: bytes) -> dict:
    """Parse a plain or Salsa20-encrypted CORE. Raises CoreError if neither."""
    encrypted = False
    try:
        flags, data = _inflate(raw)
    except CoreError as first:
        try:
            flags, data = _inflate(salsa20_decrypt(raw))
        except CoreError:
            raise first
        encrypted = True

    pos = 0
    hashes = []
    for _ in range(2):
        if pos + 2 > len(data):
            raise CoreError("truncated hash table")
        (hsize,) = struct.unpack_from("<H", data, pos)
        hashes.append(data[pos + 2:pos + 2 + hsize])
        pos += 2 + hsize

    if pos + 8 > len(data):
        raise CoreError("truncated header")
    count, entry = struct.unpack_from("<iI", data, pos)
    pos += 8
    if not 0 < count < 4096:
        raise CoreError(f"implausible section count {count}")

    sections = []
    for i in range(count):
        if pos + 8 > len(data):
            raise CoreError(f"truncated section table at {i}")
        addr, length = struct.unpack_from("<Ii", data, pos)
        pos += 8
        blob = data[pos:pos + length]
        if len(blob) != length:
            raise CoreError(f"section {i} truncated")
        sections.append((addr, blob))
        pos += length
    if pos != len(data):
        raise CoreError(f"{len(data) - pos} trailing bytes after the last section")

    return {"flags": flags, "hashes": hashes, "entry": entry,
            "sections": sections, "encrypted": encrypted}


def drop_duplicates(sections: list[tuple[int, bytes]]) -> list[tuple[int, bytes]]:
    """Retail GT4 repeats the last 24 bytes of .text as its own section."""
    kept = []
    for i, (addr, blob) in enumerate(sections):
        inside = any(
            j != i
            and a <= addr
            and addr + len(blob) <= a + len(b)
            and len(b) > len(blob)
            and b[addr - a:addr - a + len(blob)] == blob
            for j, (a, b) in enumerate(sections)
        )
        if not inside:
            kept.append((addr, blob))
    return kept


# ---------------------------------------------------------------------------
# ELF emission
# ---------------------------------------------------------------------------
def build_elf(entry: int, sections: list[tuple[int, bytes]]) -> bytes:
    ehsize, phentsize, shentsize = 52, 32, 40
    phoff = ehsize
    offset = phoff + phentsize * len(sections)
    offset = (offset + 0xFF) & ~0xFF

    phdrs = b""
    blobs = []
    names = []
    for addr, blob in sections:
        phdrs += struct.pack("<8I", 1, offset, addr, addr, len(blob), len(blob), 7, 0x10)
        blobs.append((offset, blob))
        is_code = addr <= entry < addr + len(blob)
        name = ".text" if is_code else (".data" if ".data" not in names else f".data{len(names)}")
        names.append(name)
        offset = (offset + len(blob) + 0xF) & ~0xF

    shstrtab = b"\0" + b"".join(n.encode() + b"\0" for n in names) + b".shstrtab\0"
    shstr_off = offset
    shoff = (shstr_off + len(shstrtab) + 3) & ~3

    shdrs = bytes(shentsize)
    name_pos = 1
    for (addr, blob), (off, _), name in zip(sections, blobs, names):
        shdrs += struct.pack("<10I", name_pos, 1, 0x6 if name == ".text" else 0x3,
                             addr, off, len(blob), 0, 0, 16, 0)
        name_pos += len(name) + 1
    shdrs += struct.pack("<10I", name_pos, 3, 0, 0, shstr_off, len(shstrtab), 0, 0, 1, 0)

    ident = b"\x7fELF" + bytes([1, 1, 1, 0]) + bytes(8)
    header = ident + struct.pack(
        "<HHIIIIIHHHHHH", 2, 8, 1, entry, phoff, shoff, EE_EFLAGS,
        ehsize, phentsize, len(sections), shentsize, len(sections) + 2, len(sections) + 1)

    out = bytearray(header + phdrs)
    for off, blob in blobs:
        out += bytes(off - len(out))
        out += blob
    out += bytes(shstr_off - len(out)) + shstrtab
    out += bytes(shoff - len(out)) + shdrs
    return bytes(out)


# ---------------------------------------------------------------------------
# GT4.VOL (RoFS 3.1) header
# ---------------------------------------------------------------------------
def inspect_vol(raw: bytes) -> dict:
    magic = raw[:4]
    if magic == VOL_MAGIC_PLAIN:
        encrypted = False
    elif struct.unpack_from("<I", raw, 0)[0] == VOL_MAGIC_ENC:
        encrypted = True
    else:
        raise CoreError(f"not a GT4 volume (magic {magic.hex()})")
    major, minor = struct.unpack_from("<HH", raw, 4)
    toc_len = struct.unpack_from("<i", raw, 8)[0]
    pages = struct.unpack_from("<i", raw, 0x0C)[0]
    page_len = struct.unpack_from("<H", raw, 0x10)[0]
    toc_pages = struct.unpack_from("<H", raw, 0x12)[0]
    return {"encrypted": encrypted, "version": f"{major}.{minor}", "toc_len": toc_len,
            "pages": pages, "page_len": page_len, "toc_pages": toc_pages,
            "data_start": 0x40 + pages * page_len}


def _elf_info(raw: bytes) -> dict:
    if raw[:4] != b"\x7fELF":
        raise CoreError("not an ELF")
    cls, enc = raw[4], raw[5]
    machine = struct.unpack_from("<H", raw, 0x12)[0]
    entry = struct.unpack_from("<I", raw, 0x18)[0]
    eflags = struct.unpack_from("<I", raw, 0x24)[0]
    phnum = struct.unpack_from("<H", raw, 0x2C)[0]
    phoff = struct.unpack_from("<I", raw, 0x1C)[0]
    segs = []
    for i in range(phnum):
        p_type, p_off, p_vaddr, p_paddr, p_filesz, p_memsz, p_flags, _ = struct.unpack_from(
            "<8I", raw, phoff + 32 * i)
        if p_type == 1:
            segs.append((p_vaddr, p_vaddr + p_memsz, p_flags))
    return {"class": cls, "endian": enc, "machine": machine, "entry": entry,
            "eflags": eflags, "segments": segs}


def main() -> int:
    ap = argparse.ArgumentParser(description="GT4 / Tourist Trophy CORE inspector and ELF converter")
    ap.add_argument("target")
    ap.add_argument("--info", action="store_true", help="parse the CORE header and sections")
    ap.add_argument("--to-elf", metavar="OUT")
    ap.add_argument("--vol", action="store_true", help="decode a GT4.VOL header")
    ap.add_argument("--elf-info", action="store_true", help="describe a converted ELF")
    ap.add_argument("--core-hash", action="store_true")
    args = ap.parse_args()

    path = Path(args.target)
    if not path.is_file():
        print(f"no such file: {path}", file=sys.stderr)
        return 2
    raw = path.read_bytes()
    print(f"file : {path.name} ({len(raw):,} bytes)")

    if args.core_hash:
        print(f"sha1 : {hashlib.sha1(raw).hexdigest()}")
        print(f"sha256: {hashlib.sha256(raw).hexdigest()}")

    if args.vol:
        v = inspect_vol(raw)
        state = "ENCRYPTED table" if v["encrypted"] else "plain table"
        print(f"volume : RoFS {v['version']} ({state})")
        print(f"  toc   : {v['toc_len']:,} bytes compressed, {v['toc_pages']} page(s)")
        print(f"  pages : {v['pages']} x {v['page_len']} bytes")
        print(f"  data  : starts at 0x{v['data_start']:X}")
        if v["encrypted"]:
            print("  note  : the real file table is encrypted+compressed behind a decoy GT3-style table")
        return 0

    if args.elf_info:
        try:
            info = _elf_info(raw)
        except CoreError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        names = {8: "EM_MIPS", 3: "EM_386", 62: "EM_X86_64"}
        print(f"ELF{32 if info['class'] == 1 else 64} "
              f"{'LE' if info['endian'] == 1 else 'BE'} "
              f"{names.get(info['machine'], info['machine'])}")
        print(f"  entry    : 0x{info['entry']:08X}")
        print(f"  e_flags  : 0x{info['eflags']:08X}"
              + ("  (PS2 EE / ee-gcc)" if info["eflags"] == EE_EFLAGS else ""))
        for i, (start, end, flags) in enumerate(info["segments"]):
            perm = ("r" if flags & 4 else "-") + ("w" if flags & 2 else "-") + ("x" if flags & 1 else "-")
            print(f"  LOAD[{i}]  : 0x{start:08X}-0x{end:08X}  {perm}  ({end - start:,} bytes)")
        return 0

    try:
        core = parse_core(raw)
    except CoreError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("\nHint: this is probably not CORE.GT4. On a GT4 disc the boot file "
              "(SCUS_973.28 / SCES_517.19) is a bootstrap; the game code is CORE.GT4.", file=sys.stderr)
        return 1

    print(f"CORE   : {'Salsa20-encrypted (Tourist Trophy / GT4 Online style)' if core['encrypted'] else 'plain'}")
    print(f"  boot flags : 0x{core['flags']:04X}")
    print(f"  entry      : 0x{core['entry']:08X}")
    for i, h in enumerate(core["hashes"]):
        print(f"  hash[{i}]    : {len(h)} bytes, {h[:12].hex()}…")
    print(f"  sections   : {len(core['sections'])}")
    for addr, blob in core["sections"]:
        print(f"    0x{addr:08X} .. 0x{addr + len(blob):08X}  ({len(blob):,} bytes)")

    loaded = drop_duplicates(core["sections"])
    if len(loaded) != len(core["sections"]):
        print(f"  (dropped {len(core['sections']) - len(loaded)} section(s) duplicated inside another)")

    if args.to_elf:
        elf = build_elf(core["entry"], loaded)
        Path(args.to_elf).write_bytes(elf)
        print(f"\nwrote {args.to_elf} ({len(elf):,} bytes) — now: "
              f"python3 tools/ps2recon.py {args.to_elf}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
