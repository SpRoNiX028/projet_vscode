# « Un agent IA + REA → port natif rapide » : ce qui est vrai, ce que je peux faire

## 1. Ce que REA fait réellement

Vérifié dans les sources (clone de `mytechnotalent/rea`, v7.1.0) et dans la doc :

Ses 31 outils MCP sont **tous de l'analyse en lecture seule** :

```
open_binary · binary_session · list_functions · decompile_function · disasm_function
find_xrefs · search_strings · run_rules · audit · inspect_crypto · decrypt_strings
emulate · unpack · get_evidence_bundle · generate_dossier · get_sbom
inspect_wasm/sqlite/coredump/evm/plist/sourcemap/capture/flutter/dos/dwarf/java/arsc/pdb…
```

Il n'y a **aucun outil qui émet du code, recompile, ou génère un projet**. REA produit
du renseignement : pseudo-C, xrefs, evidence bundle, rapport. C'est un analyste, pas
un porteur. (À noter : il existe deux projets nommés REA — `mytechnotalent/rea`
« Reverse Engineering Assistant », Rust pur, et `morluto/rea` « Reverse Engineer
Anything », orchestrateur MCP de Hopper/Ghidra/IDA. **Aucun des deux ne fait de port
natif.**)

Sa limite PS2, en plus : le R5900 n'est pas un MIPS standard (extensions MMI 128 bits,
mode macro VU), et le microcode VU1 n'est **pas du code** dans l'ELF — il est uploadé
à l'exécution. Un désassembleur générique, même excellent, ne le voit pas.

## 2. Ce que disent les projets qui ont réellement abouti

| Projet | Ce qui a été fait | Coût réel |
|---|---|---|
| **PS2Recomp** (ran-j) | Recompilateur statique R5900 → C++. Le CPU marche ; **GS, VU1 et DMA sont encore stubbed**, aucun jeu jouable en sortie directe (Recompendium, oct. 2026) | Outil, pas une solution clé en main |
| **God of War Recomp** (KIexster) | Recomp + runtime natif de Waffle565 (GS, VU1, IOP, son, DMA, disque). Boot, menus, combat du bateau OK. **AI-assisted**, `CLAUDE.md`/`AGENTS.md` dans le repo | Lancé oct. 2026, **encore WIP**, dépend d'un runtime écrit par quelqu'un d'autre |
| **RE: Code Veronica X** (aikatore) | Port où « l'essentiel du code a été écrit par des agents IA » (Claude, Codex), 280/289 commits co-signés Claude | **Bâti sur la décompilation existante de TealAlchemist** — l'IA a accéléré la couche port, pas la rétro-ingénierie |
| **OpenGOAL** (Jak & Daxter) | Le cas d'école du « natif propre », Linux inclus | Depuis 2020, une équipe, et ~98 % du jeu était dans un Lisp maison récupérable |
| Vitrine REA (DX-Ball) | Une **fonction** de pan audio reconstruite en C, 3 205 tests, 63 octets identiques | Une fonction. Pas un jeu. |

Conclusion factuelle : **l'IA divise le temps, elle ne le supprime pas.** Les cas qui
marchent le plus vite partagent tous le même atout — une décompilation humaine
existante, ou un runtime matériel déjà écrit par quelqu'un.

## 3. Suis-je capable de le faire ?

Oui, sur le fond : analyse d'ELF, rétro-ingénierie de formats, écriture du runtime
natif (C/SDL2/OpenGL), automatisation, et le travail fastidieux de fonction en
fonction. Ce que je **ne peux pas** faire, et qu'il faut savoir avant de commencer :

- **Boucler sans toi.** Je ne peux pas lancer le jeu ici (pas de GPU, pas d'ISO
  hébergée). Le cycle « je code → tu testes → je corrige » est obligatoire.
- **Tenir un projet de plusieurs mois dans une session.** Je travaille par jalons
  livrables, pas en continu.
- **Reproduire des assets.** Le code du port se réimplémente ; les données du jeu
  restent chez toi et ne se committent pas.
- **Courir plus vite que la physique du problème** : GS, VU1, DMА et IOP représentent
  l'essentiel de l'effort, et REA ne les défriche pas.

## 4. Le plan que je proposerais (jalons vérifiables)

**J0 — Qualification (1 session, ici)**
`ps2iso.py --layout` sur ton image + `ps2recon.py` sur l'ELF → on sait si le jeu est
un candidat raisonnable (taille du module, overlays, MMI, SDK utilisé). Livrable :
rapport de faisabilité chiffré. **Déjà outillé** (voir `tools/`).

**J1 — Extraction complète**
Dump de l'arborescence, identification de l'archive maison, extraction des overlays,
des `.IRX` et des tables de pointeurs. Livrable : `extracted/` + doc du format.
Faisable ici si tu me donnes l'image (ou juste l'ELF + l'archive).

**J2 — Harnais d'exécution**
Recompilation PS2Recomp **chez toi**, puis runtime minimal : mémoire EE, syscalls
stubés avec logs, boucle principale atteinte. Livrable : « le jeu démarre et
m'appelle `sceCdRead`, `scePadRead`, … » — c'est le vrai test de viabilité.

**J3 — Vidéo**
GS : au minimum interpréter les paquets GIF/DMA en un rendu logiciel puis OpenGL.
C'est le jalon le plus lourd. Les jeux 3D en dépendent entièrement.

**J4 — VU1, IOP, son, manette**
Rendre la logique de jeu et l'audio.

**J5 — Boucle de matching**
Comparer écran par écran avec PCSX2 comme oracle. C'est là que du temps se gagne
avec REA (xrefs, émulation de fonctions) et avec un agent.

Si un projet existe déjà sur ton jeu : on rejoint ou on forke, et J2–J4 sont déjà à
moitié faits. **C'est le premier truc à vérifier, avant tout code.**

## 5. Ce qu'il serait malhonnête de te promettre

- « REA + agent = port jouable du jeu en une session. » Non.
- « Décompiler l'ELF = avoir le jeu. » Non : le code du jeu est aussi dans les
  overlays, le VU1 et l'archive.
- « Pas besoin de posséder le jeu. » Si : le port ne contient aucun asset.

Ce qui est raisonnable de viser avec moi : **J0 + J1 en quelques sessions, J2 en
quelques semaines de boucles**, et un jour une démo jouable d'un écran — pas le jeu
complet, sauf si le jeu est simple ou déjà défriché.
