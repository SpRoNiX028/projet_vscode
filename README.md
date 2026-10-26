# projet_vscode

Outils d'analyse de binaires et notes de rétro-ingénierie.

## Contenu

- `tools/ps2recon.py` — reconnaissance d'exécutables PlayStation 2 (ELF EE) :
  validation, sections, entropie, symboles, fingerprint des libs Sony SDK,
  références de modules IOP, chaînes, désassemblage MIPS32 (capstone).
- `tools/ps2iso.py` — lecteur d'images ISO PS2 **sans dépendance** (stdlib) :
  arborescence ISO 9660, résolution `SYSTEM.CNF` → `BOOT2`, extraction ciblée ou
  complète, inventaire des fichiers PS2 (ELF, IRX, archives, audio, vidéo).
- `tools/selftest_ps2recon.py`, `tools/selftest_ps2iso.py` — auto-tests (fabriquent
  un faux module EE et une fausse image PS2, puis vérifient chaque détection).
- `docs/ps2-decompilation-faisabilite.md` — faisabilité d'un port natif Linux
  d'un jeu PS2 (recompilation vs décompilation), coûts et prérequis.
- `docs/port-natif-plan.md` — ce que REA fait vraiment, ce que les projets
  aboutis ont coûté, et le plan par jalons (J0 → J5).

## Usage

```bash
pip install --break-system-packages pyelftools capstone
python3 tools/ps2recon.py SLUS_203.62 -o rapport.md --json rapport.json
python3 tools/ps2iso.py game.iso --layout      # dépendances : aucune
python3 tools/ps2iso.py game.iso --extract SLUS_203.62
python3 tools/selftest_ps2recon.py && python3 tools/selftest_ps2iso.py
```
