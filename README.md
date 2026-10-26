# projet_vscode

Outils d'analyse de binaires et notes de rétro-ingénierie.

## Contenu

- `tools/ps2recon.py` — reconnaissance d'exécutables PlayStation 2 (ELF EE) :
  validation, sections, entropie, symboles, fingerprint des libs Sony SDK,
  références de modules IOP, chaînes, désassemblage MIPS32 (capstone).
- `tools/selftest_ps2recon.py` — auto-test (fabrique un faux module EE et vérifie
  chaque détection).
- `docs/ps2-decompilation-faisabilite.md` — faisabilité d'un port natif Linux
  d'un jeu PS2 (recompilation vs décompilation), coûts et prérequis.

## Usage

```bash
pip install --break-system-packages pyelftools capstone
python3 tools/ps2recon.py SLUS_203.62 -o rapport.md --json rapport.json
python3 tools/selftest_ps2recon.py
```
