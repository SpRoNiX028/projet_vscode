#!/usr/bin/env python3
"""ps2iso - minimal, dependency-free reader for PlayStation 2 disc images.

Standard library only, so it runs anywhere (no pycdlib, no 7-Zip, no fuse).

What it does:
    --list               list the ISO 9660 tree with LBA and size
    --boot               resolve SYSTEM.CNF -> BOOT2 -> the EE main module
    --extract PATH       write one file out
    --dump-dir DIR       extract the whole tree (or a subtree with --subtree)
    --layout             report the PS2-specific files of interest
                         (SYSTEM.CNF, SLUS/SLES/SLPS/SLPM/SCUS/SCES *.ELF,
                          IOPRP*.IMG, *.IRX, *.PAK, *.VAG, *.SFD)

Scope and limits (deliberate):
  * Reads the ISO 9660 primary volume descriptor only. PS2 DVDs are usually an
    ISO9660 + UDF bridge; the ISO9660 side is enough for every file the game
    boots from, but a file that only exists in the UDF side would be missed.
  * Reads the raw image or a .iso/.bin. A .cue/.bin pair: pass the .bin.
  * Does not decrypt, does not bypass any protection, does not download
    anything. It only opens an image you already have.

Usage:
    python3 tools/ps2iso.py game.iso --layout
    python3 tools/ps2iso.py game.iso --boot
    python3 tools/ps2iso.py game.iso --dump-dir out/ --subtree MODULES
"""

from __future__ import annotations

import argparse
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

SECTOR = 2048
PVD_SECTOR = 16

PS2_PREFIXES = ("SLUS", "SLES", "SLPS", "SLPM", "SCUS", "SCES", "SCPS",
                "SLED", "SLKA", "SLPN", "SCAJ", "SLAJ", "SLUS")
PS2_SUFFIXES = (".IRX", ".IMG", ".PAK", ".VAG", ".SFD", ".ELF", ".BIN", ".IPU",
                ".CBD", ".HD2", ".DAT", ".ADP", ".MEC", ".ICO", ".TIM", ".PS2")


@dataclass
class Entry:
    name: str
    lba: int
    size: int
    is_dir: bool
    path: str = ""

    @property
    def offset(self) -> int:
        return self.lba * SECTOR


class Iso:
    def __init__(self, path: Path):
        self.path = path
        self.fh = path.open("rb")
        self.pvd = self._read_pvd()
        self.entries: list[Entry] = []
        self._walk(self.pvd["root"], "")

    # -- low level ---------------------------------------------------------
    def _read_sector(self, lba: int, count: int = 1) -> bytes:
        self.fh.seek(lba * SECTOR)
        return self.fh.read(SECTOR * count)

    def _read_pvd(self) -> dict:
        # Volume descriptors start at sector 16; type 1 = primary, type 255 = terminator.
        for lba in range(PVD_SECTOR, PVD_SECTOR + 32):
            sec = self._read_sector(lba)
            if len(sec) < SECTOR:
                break
            vd_type = sec[0]
            if vd_type == 255:
                break
            if vd_type != 1:
                continue
            if sec[1:6] != b"CD001":
                raise ValueError("not an ISO 9660 image (missing CD001 signature)")
            volume_id = sec[40:72].decode("latin-1").strip()
            root = self._parse_dir_record(sec[156:190])
            return {"volume_id": volume_id, "root": root}
        raise ValueError("no primary volume descriptor found")

    @staticmethod
    def _parse_dir_record(rec: bytes) -> Entry:
        length = rec[0]
        if length == 0:
            raise ValueError("zero-length directory record")
        lba = struct.unpack_from("<I", rec, 2)[0]
        size = struct.unpack_from("<I", rec, 10)[0]
        flags = rec[25]
        name_len = rec[32]
        raw = rec[33:33 + name_len]
        name = raw.decode("latin-1")
        if name == "\x00":
            name = "."
        elif name == "\x01":
            name = ".."
        return Entry(name=name, lba=lba, size=size, is_dir=bool(flags & 0x02))

    # -- tree --------------------------------------------------------------
    def _walk(self, dir_entry: Entry, prefix: str) -> None:
        data = self.fh.read(0)  # no-op, keeps the handle warm across seeks
        self.fh.seek(dir_entry.offset)
        blob = self.fh.read(dir_entry.size)
        pos = 0
        while pos < len(blob):
            length = blob[pos]
            if length == 0:
                # records never straddle a sector: jump to the next one
                pos = (pos // SECTOR + 1) * SECTOR
                continue
            rec = blob[pos:pos + length]
            try:
                e = self._parse_dir_record(rec)
            except ValueError:
                break
            pos += length
            if e.name in (".", ".."):
                continue
            e.path = f"{prefix}/{e.name}" if prefix else e.name
            self.entries.append(e)
            if e.is_dir:
                self._walk(e, e.path)

    # -- helpers -----------------------------------------------------------
    def clean(self, name: str) -> str:
        return name.split(";")[0].strip()

    def find(self, needle: str) -> list[Entry]:
        needle = needle.lower().rstrip("/")
        out = []
        for e in self.entries:
            c = self.clean(e.path).lower()
            if c == needle or c.endswith("/" + needle) or c.split(";")[0] == needle:
                out.append(e)
        return out

    def read(self, entry: Entry) -> bytes:
        self.fh.seek(entry.offset)
        return self.fh.read(entry.size)

    def boot_elf(self) -> tuple[str | None, Entry | None]:
        """SYSTEM.CNF contains `BOOT2 = cdrom0:\\SLUS_203.62;1`."""
        for cnfs in self.find("SYSTEM.CNF"):
            if cnfs.is_dir:
                continue
            text = self.read(cnfs).decode("latin-1", "replace")
            for line in text.splitlines():
                if "BOOT2" in line.upper():
                    target = line.split("=", 1)[-1].strip()
                    target = target.replace("\\", "/").split(":")[-1]
                    # BOOT2 may carry an ISO version suffix ("SLUS_203.62;1")
                    rel = self.clean(target).lstrip("/")
                    name = rel.split("/")[-1]
                    hits = [e for e in self.find(rel) + self.find(name)
                            if not e.is_dir and self.clean(e.name).upper() == name.upper()]
                    return target, (hits[0] if hits else None)
        return None, None


def hum(n: int) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


def main() -> int:
    ap = argparse.ArgumentParser(description="minimal PS2 ISO 9660 reader (stdlib only)")
    ap.add_argument("image")
    ap.add_argument("--list", action="store_true", help="list the whole tree")
    ap.add_argument("--layout", action="store_true", help="show PS2-relevant files")
    ap.add_argument("--boot", action="store_true", help="resolve SYSTEM.CNF -> BOOT2")
    ap.add_argument("--extract", metavar="PATH")
    ap.add_argument("--dump-dir", metavar="DIR")
    ap.add_argument("--subtree", metavar="PREFIX", default="")
    args = ap.parse_args()

    img = Path(args.image)
    if not img.is_file():
        print(f"no such image: {img}", file=sys.stderr)
        return 2

    iso = Iso(img)
    print(f"image      : {img.name} ({hum(img.stat().st_size)})")
    print(f"volume id  : {iso.pvd['volume_id']!r}")
    print(f"entries    : {len(iso.entries)} ({sum(e.is_dir for e in iso.entries)} directories)")

    if args.list:
        for e in iso.entries:
            tag = "d" if e.is_dir else "-"
            print(f"{tag} {hum(e.size):>10}  LBA {e.lba:>8}  {iso.clean(e.path)}")

    if args.layout:
        print("\n-- PS2 files of interest " + "-" * 40)
        boot_target, boot_entry = iso.boot_elf()
        if boot_target:
            state = "FOUND" if boot_entry else "MISSING from tree"
            print(f"BOOT2        {boot_target}   -> {state}")
        else:
            print("BOOT2        not found (no SYSTEM.CNF, or unbootable image)")
        groups = {
            "main module (EE ELF)": lambda n: n.startswith(PS2_PREFIXES) and not n.endswith(".IRX"),
            "IOP modules": lambda n: n.endswith(".IRX") or n.startswith("IOPRP"),
            "archives / data": lambda n: n.endswith((".PAK", ".DAT", ".CBD", ".HD2", ".BIN")),
            "audio": lambda n: n.endswith((".VAG", ".ADS", ".ADP")),
            "video": lambda n: n.endswith((".SFD", ".PSS", ".MEC")),
        }
        for label, pred in groups.items():
            hits = [iso.clean(e.path) for e in iso.entries if not e.is_dir and pred(iso.clean(e.name).upper())]
            print(f"{label:<22} {len(hits):>4}")
            for h in hits[:8]:
                print(f"    {h}")
            if len(hits) > 8:
                print(f"    ... and {len(hits) - 8} more")

    if args.boot:
        target, entry = iso.boot_elf()
        if entry:
            print(f"\nboot ELF: {iso.clean(entry.path)}  LBA {entry.lba}  {hum(entry.size)}")
        else:
            print(f"\nboot ELF: could not resolve ({target!r})")
            return 1

    if args.extract:
        hits = [e for e in iso.find(args.extract) if not e.is_dir]
        if not hits:
            print(f"\nnot found: {args.extract}", file=sys.stderr)
            return 1
        e = hits[0]
        out = Path(iso.clean(e.name))
        out.write_bytes(iso.read(e))
        print(f"\nextracted {iso.clean(e.path)} -> {out} ({hum(e.size)})")

    if args.dump_dir:
        root = Path(args.dump_dir)
        n = 0
        for e in iso.entries:
            if e.is_dir:
                continue
            if args.subtree and not iso.clean(e.path).upper().startswith(args.subtree.upper()):
                continue
            dest = root / iso.clean(e.path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(iso.read(e))
            n += 1
        print(f"\nextracted {n} files into {root}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
