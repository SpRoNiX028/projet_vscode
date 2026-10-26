# Décompiler un jeu PS2 → version native Linux : étude de faisabilité

> Réponse courte : **techniquement oui, pratiquement c'est un projet de plusieurs
> mois à plusieurs années**, et le `.elf` n'est que la partie visible. Ce document
> explique où est la vraie difficulté, quels chemins existent, et ce qui peut être
> automatisé ici.

---

## 1. Ce qu'il y a réellement sur un DVD PS2

Le `.elf` que tu as n'est **pas** le jeu. C'est le module principal du CPU EE
(Emotion Engine), et il est presque toujours :

- **strippé** (aucun nom de fonction) ;
- **statiquement lié** au SDK Sony (pas d'imports à lire, comme sur PC) ;
- **incomplet** : une grosse partie de la logique est dans des *overlays* et dans
  des modules tournant sur le second CPU.

| Élément du disque | Rôle | Conséquence pour la décompilation |
|---|---|---|
| `SLUS_xxx.xx` / `SLES_xxx.xx` (le `.elf`) | Module principal EE (MIPS R5900) | Point de départ de l'analyse |
| `IOPRP*.IMG`, `*.IRX` | Modules IOP (CPU I/O : CD, pad, son, FS) | Souvent réutilisables ; à auditer à part |
| Overlays (souvent dans un `.pak`/archive maison) | Code chargé à la demande | À extraire + relocaliser avant désassemblage |
| VU0 / VU1 microcode | Programmes vectoriels, uploadés à l'exécution | **Invisibles en tant que code** dans l'ELF : ce sont des données |
| `*.VAG`, `*.SFD`, textures GS | Audio ADPCM, vidéo, images | Format à rétro-ingénierer, pas du code |
| Chaînes DMA/GIF | Le « GPU » PS2 est piloté par paquets | Toute scène qui dessine = séquence de paquets, pas des draw calls |

**Point clé** : tu ne peux pas « décompiler le .elf et obtenir un jeu ». Tu obtiens
un programme MIPS qui pilote du matériel PS2 par DMA et registres. Il faut ensuite
réimplémenter ce matériel, ou le traduire.

---

## 2. Les trois chemins réels

### A. Recompilation statique (le plus rapide à un résultat jouable)
Traduction automatique MIPS R5900 → C, puis compilation native.
Projets : `PS2Recomp` (N64Recomp-like), `urban-reign-recomp`, `ProjectCane` (Sly Cooper).

- ✅ Sort un binaire natif sans réécrire le jeu ; atteignable en semaines/mois.
- ❌ Le code généré est illisible ; il faut quand même fournir une couche HLE
  (DMA, VU, GS, RPC vers l'IOP) sinon rien ne s'affiche.
- ❌ Les jeux qui font de l'**auto-modification** ou du microcode VU dynamique
  cassent la traduction statique.
- Réaliste pour : jeux à boucle simple, peu de VU, peu d'overlays.

### B. Décompilation (le résultat propre, façon OpenGOAL / recvx-decomp)
Reconstruire du C (ou du GOAL, pour Jak & Daxter) fonction par fonction, en visant
un **matching** du binaire d'origine, puis recompiler pour x86-64.

- ✅ Vrai natif, moddable, maintenable, 60 fps / 4K gratuits.
- ✅ Le précédent existe : **OpenGOAL** (Jak 1 complet, Jak II/III en beta, Linux
  inclus, ISO perso obligatoire) ; `recvx-decomp` pour Resident Evil Code: Veronica X.
- ❌ Coût : OpenGOAL a démarré en 2020 avec une équipe, sur des jeux dont ~98 % du
  code était écrit dans un Lisp maison — donc **récupérable**. Sur un jeu écrit en
  C++ compilé par `ee-gcc`, il n'y a pas de « langage maison » à retrouver : tout
  est à reconstruire à la main. Compter **des années-personnes** pour un jeu moyen.

### C. Hybride (recommandé si le but est de jouer)
Recompilation des parties chaudes + HLE du matériel, en s'appuyant sur un projet
existant. Si un projet existe déjà pour ton jeu, **ne réécris pas** : contribue.

---

## 3. Pourquoi la PS2 est un cas particulièrement dur

1. **Deux CPU coopérants** : EE et IOP communiquent par RPC SIF. Un port natif doit
   reproduire ce protocole ou le remplacer.
2. **Pas d'accès direct au framebuffer** : tout passe par des chaînes DMA et des
   paquets GIF. Il n'y a pas de « draw call » à traduire en Vulkan.
3. **VU0/VU1** : microcode vectoriel chargé à l'exécution → invisible statiquement.
   C'est le plus gros poste de travail de la plupart des ports.
4. **Le R5900 n'est pas un MIPS standard** : instructions MMI (packed), registres
   128 bits. Les désassembleurs génériques (capstone, objdump) échouent sur une
   partie du code — voir l'avertissement produit par `tools/ps2recon.py`.
5. **Overlays + archives propriétaires** : il faut d'abord rétro-ingénierer le
   conteneur avant de pouvoir analyser le code contenu.

---

## 4. Ce qui peut être fait ici, dans ce sandbox

| Étape | Faisable ici ? | Outil |
|---|---|---|
| Valider qu'un `.elf` est bien un module EE | ✅ | `tools/ps2recon.py` (livré) |
| Cartographier sections, entropie, symboles, chaînes | ✅ | idem |
| Identifier les libs SDK liées (pad, GS, DMA, RPC…) | ✅ | idem (base de ~17 libs) |
| Désassemblage MIPS32 + repérage des zones non décodables (MMI) | ✅ partiel | capstone via le script |
| Extraire/parser une archive ou un format maison | ✅ | Python (`pyelftools`, `lief` dispo) |
| Désassemblage complet R5900, décompilation en pseudo-C | ⚠️ hors sandbox | **Ghidra + plugin PS2** ou **REA** chez toi |
| Émulation d'une fonction pour retrouver une clé/un décryptage | ⚠️ | `unicorn`/`angr` (installables), ou REA `emulate` |
| Recompilation statique | ❌ | `PS2Recomp` (hors sandbox, réseau fermé) |
| Lancer le jeu | ❌ | pas de GPU, pas de ROM légale |

Note d'honnêteté : **REA ne peut pas être exécuté ici** (aucun binaire Linux
précompilé publié, pas de `cargo`, `crates.io` injoignable). En revanche tu peux le
lancer chez toi et me renvoyer `re-<nom>.md` / `.json` : je les exploite.

---

## 5. Ordre d'opérations recommandé

```text
1. Vérifier qu'un projet n'existe pas déjà (recompendium.com, recompedia.com)
2. Récupérer l'ISO depuis TON disque, extraire l'ELF + les overlays
3. python3 tools/ps2recon.py SLUS_xxx.xx      # savoir à quoi on a affaire
4. Identifier l'archive et les overlays, les découper
5. Choisir : recomp (A) si tu veux jouer, décomp (B) si tu veux du code propre
6. Construire le harnais : HLE des appels SDK, une fonction à la fois
7. Boucle : désassembler → renommer → réécrire → comparer au binaire
```

L'étape 6 est le vrai travail. Tout le reste est de la préparation.

---

## 6. Cadre légal

Décompiler ton propre exemplaire pour interopérabilité/étude est toléré dans
plusieurs juridictions (UE : directive 2009/24/CE, art. 6, sous conditions), mais
**redistribuer du code ou des assets du jeu ne l'est pas**. Tous les projets cités
(OpenGOAL, recvx-decomp) fonctionnent ainsi : le code est libre, les données du jeu
restent chez le joueur. Aucun lien vers des ISO ici.

---

## 7. Si tu veux avancer concrètement

- **Tu veux savoir si ton jeu est faisable** → donne-moi la sortie de
  `tools/ps2recon.py` (ou juste le nom du jeu + taille de l'ELF) et je chiffre.
- **Tu veux le code le plus lisible possible** → dépose l'ELF, j'analyse les
  fonctions intéressantes (décodage de l'archive, format de sauvegarde, boucle
  principale) et je te sors du C annoté pour les parties que tu veux réécrire.
- **Tu veux juste jouer** → PCSX2, ou un port existant s'il y en a un.
