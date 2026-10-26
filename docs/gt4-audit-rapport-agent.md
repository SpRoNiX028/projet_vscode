# GT4 : auditer le rapport d'un agent (et pourquoi il faut changer de cible)

## 0. Le fait qui structure tout

**Il n'y a pas d'ELF « du jeu » sur un disque de Gran Turismo 4.**

| Fichier sur le disque | Ce que c'est | Taille typique |
|---|---|---|
| `SCUS_973.28` (NTSC-U) / `SCES_517.19` (PAL) | **Bootstrap** PS2-ELF minuscule, il ne contient pas le jeu | quelques dizaines de Ko |
| `CORE.GT4` | **Le vrai code du jeu**, format Polyphony : en-tête + deflate brut → liste de sections `(adresse EE, taille, data)` | plusieurs Mo |
| `GT4.VOL` | Volume RoFS 3.1 : arbre de fichiers chiffré + compressé, caché derrière une fausse table GT3 | plusieurs Go |

Conséquence directe : un rapport qui prétend avoir « décompilé `gt4_principal.elf`, trouvé le
`main` et les fonctions clés » sans mentionner `CORE.GT4` **n'a pas analysé le jeu**. Il a
analysé le bootstrap (au mieux), ou rien.

Le point d'entrée du bootstrap `SCUS_973.28` est **`0x01000008`** (visible dans les logs
PCSX2). Le code du jeu, lui, est dans `CORE.GT4`, avec son propre point d'entrée déclaré
dans l'en-tête — c'est `tools/gt4_core.py --info` qui le donne.

## 1. La chaîne correcte

```bash
# 1. extraire du disque (ton ISO, que tu possèdes)
python3 tools/ps2iso.py "Gran Turismo 4.iso" --boot
python3 tools/ps2iso.py "Gran Turismo 4.iso" --extract SCUS_973.28
python3 tools/ps2iso.py "Gran Turismo 4.iso" --extract CORE.GT4

# 2. convertir CORE.GT4 -> ELF chargeable par Ghidra / objdump / REA
python3 tools/gt4_core.py CORE.GT4 --info
python3 tools/gt4_core.py CORE.GT4 --to-elf CORE.GT4.elf

# 3. seulement maintenant, l'analyse
python3 tools/ps2recon.py CORE.GT4.elf
```

`tools/gt4_core.py` gère aussi le cas **chiffré Salsa20** (Tourist Trophy, GT4 Online) :
clé 16 octets `PolyphonyDigital`, IV = 8 premiers octets, CRC en fin de fichier.

## 2. Grille de lecture : le rapport de l'agent est-il réel ?

Coche ce qui est présent. Chaque case manquante est un signal.

| À vérifier | Pourquoi | Verdict si absent |
|---|---|---|
| Mentionne `CORE.GT4` et `SCUS_973.28` | c'est la structure réelle du disque | ❌ l'agent n'a pas vu le jeu |
| Donne le point d'entrée **du CORE**, pas `0x01000008` seul | `0x01000008` = bootstrap | ❌ confond bootstrap et jeu |
| Reconnaît que le binaire est **strippé** | GT4 retail n'a aucune table de symboles | ❌ toute liste de « symboles » est inventée |
| Ne nomme **aucune** fonction par un nom parlant (`UpdateCars`, `PhysicsStep`…) | impossible sans debug symbols | ❌ hallucination |
| Parle du **VU1 chiffré dans l'exécutable** | microcode VU1 récupéré puis compilé hors ligne (2 048 points d'entrée) | ❌ analyse superficielle |
| Cite `GT4.VOL` / RoFS 3.1 | sinon l'agent n'a pas vu les données | ⚠️ incomplet |
| Fournit des **offsets et hashes** vérifiables | REA a `get_evidence_bundle` exprès | ❌ rien n'est vérifiable |
| Ne prétend pas produire du C compilable | REA rend du pseudo-C, pas la source | ❌ survente |

Test le plus rapide : demande à l'agent **le hash SHA-1 du fichier analysé** et **l'adresse
d'entrée imprimée par `gt4_core.py --info`**. S'ils ne collent pas, le rapport ne décrit pas
ton fichier. Les hashes de référence de la décompilation communautaire (build USA v1.01) :
`SCUS_973.28` = `1df6f08c348e55f66c3a38e1774a9a989ce7d6ba`,
`CORE.GT4` = `30031137ce494323816bb707b90d3ec0d07937d2`.

## 3. La mauvaise nouvelle, puis la bonne

**Mauvaise** : GT4 est probablement le pire candidat possible pour un port « from scratch ».
C'est un DVD-9 de ~5,3 Go, il s'appuie sur **les deux unités vectorielles**, sur un
comportement flottant exact (replays, permis), et sur des ruses graphiques qui relisent des
images rendues comme palettes. Le VU1 est massif (2 048 points d'entrée) et son microcode
est chiffré dans l'exécutable.

**Bonne** : **le travail existe déjà, et il est jouable.**

| Projet | État (oct. 2026) | Plateformes |
|---|---|---|
| **ps2-web-recomp** (snuri00) | GT4 = premier jeu amené ; boot → menus → courses avec son et sauvegarde ; ~50 fps à 2× la résolution PS2 | Navigateur (WASM+WebGPU) **et runner natif Linux x86-64** |
| **GT4Recomp** (moesuito / nateo91) | 60 fps verrouillé à 100 % de vitesse, VU0/VU1 précompilés, Vulkan | Windows ; **Linux prévu** (après CoreGS 2.0) |
| **gt4-decomp** (gustavocanepa) | Décompilation matching du moteur, **AI-assisted**, avec noms de fonctions et layouts de classes | fournit les noms aux projets ci-dessus |
| gt4-staticrecomp, vulcan4 | variantes / forks | Windows |

Donc la question n'est plus « comment porter GT4 », mais **« où ajouter de la valeur »** :

1. **Builder le runner Linux de ps2-web-recomp** sur ton ISO — c'est documenté comme
   fonctionnant sur Linux x86-64. C'est ton « GT4 natif sous Linux » ce week-end, pas dans
   deux ans.
2. **Contribuer à gt4-decomp** : c'est là que « REA + agent » sert vraiment — nommer des
   fonctions, matcher des unités de compilation, documenter des classes. Le projet a
   d'ailleurs `.claude/` (agents, skills), `CLAUDE.md` et `AGENTS.md` dans le dépôt : le
   workflow agent y est déjà prévu.
3. Recompiler toi-même ne se justifie que si tu veux apprendre — et dans ce cas commence
   par un jeu simple, pas GT4.

## 4. Cadre

GT4 est la propriété de Sony / Polyphony Digital. Aucun de ces projets ne distribue de
données de jeu : tu fournis ton propre ISO. Ne committe ni l'ISO, ni `CORE.GT4`, ni les
extractions — seulement du code et des notes.
