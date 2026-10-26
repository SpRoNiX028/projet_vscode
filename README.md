# projet_vscode

Outils d'analyse de binaires et notes de rétro-ingénierie.

## Contenu

- `tools/ps2recon.py` — reconnaissance d'exécutables PlayStation 2 (ELF EE) :
  validation, sections, entropie, symboles, fingerprint des libs Sony SDK,
  références de modules IOP, chaînes, désassemblage MIPS32 (capstone).
- `tools/ps2iso.py` — lecteur d'images ISO PS2 **sans dépendance** (stdlib) :
  arborescence ISO 9660, résolution `SYSTEM.CNF` → `BOOT2`, extraction ciblée ou
  complète, inventaire des fichiers PS2 (ELF, IRX, archives, audio, vidéo).
- `tools/gt4_core.py` — Gran Turismo 4 / Tourist Trophy : parse `CORE.GT4`
  (plain ou chiffré Salsa20), affiche l'en-tête et les sections EE, et le convertit
  en ELF MIPS chargeable par Ghidra/objdump/REA ; décode aussi l'en-tête `GT4.VOL`
  (RoFS 3.1). **Sur un disque GT4, le code du jeu est dans `CORE.GT4`, pas dans
  `SCUS_973.28` (bootstrap).**
- `tools/selftest_ps2recon.py`, `tools/selftest_ps2iso.py`, `tools/selftest_gt4_core.py`
  — auto-tests (fabriquent un faux module EE, une fausse image PS2 et un faux
  `CORE.GT4`, puis vérifient chaque détection).
- `docs/ps2-decompilation-faisabilite.md` — faisabilité d'un port natif Linux
  d'un jeu PS2 (recompilation vs décompilation), coûts et prérequis.
- `docs/port-natif-plan.md` — ce que REA fait vraiment, ce que les projets
  aboutis ont coûté, et le plan par jalons (J0 → J5).
- `docs/gt4-audit-rapport-agent.md` — GT4 : comment vérifier un rapport d'agent
  (grille de lecture), et où le travail existe déjà (ps2-web-recomp, GT4Recomp,
  gt4-decomp).

## Usage

```bash
pip install --break-system-packages pyelftools capstone
python3 tools/ps2recon.py SLUS_203.62 -o rapport.md --json rapport.json
python3 tools/ps2iso.py game.iso --layout      # dépendances : aucune
python3 tools/ps2iso.py game.iso --extract SLUS_203.62
python3 tools/gt4_core.py CORE.GT4 --info
python3 tools/gt4_core.py CORE.GT4 --to-elf CORE.GT4.elf
python3 tools/selftest_ps2recon.py && python3 tools/selftest_ps2iso.py && python3 tools/selftest_gt4_core.py
```
