# Verdict sur le rapport d'agent GT4

## Méthode

Un rapport de rétro-ingénierie ne vaut que par ce qui peut être **re-vérifié**. Trois
niveaux, du moins cher au plus cher :

1. **Cohérence interne** — les nombres s'additionnent-ils ? (gratuit, faisable ici)
2. **Cohérence externe** — les valeurs rares collent-elles à ce que la communauté
   documente pour GT4 ? (gratuit, faisable ici)
3. **Confrontation au fichier** — les octets sont-ils là où le rapport dit ?
   (`tools/audit_agent_report.py`, à lancer chez toi)

---

## 1. Cohérence interne : bonne

| Assertion | Vérification arithmétique | Verdict |
|---|---|---|
| `.text` = `0x2DC10`, segment code `0x01000000`–`0x0102DC54` | `0x01000000 + 0x2DC10 = 0x0102DC10`, il reste `0x44` = 68 octets ⇒ `.ctors` + `.dtors` + `.reginfo` (24 o) | ✅ **colle au bit près** |
| CORE `01 01 cc 5e 5d 00` → « 6,12 Mo » | `flags = 0x0101`, `taille = 0x005D5ECC` = **6 119 116 octets** = 6,12 Mo | ✅ **le calcul tombe juste** |
| Segments `[0x01000000-0x0102DC54]` + `[0x0102DC80-0x010519AC]` vs fichier 273 020 o | 187 476 + 146 732 = 334 208 > 273 020, l'écart = `.bss`/`.sbss` (memsz sans filesz) | ✅ normal |
| `jal 0x01000558` à `0x01000210` + delay slot `addiu $a1,$v0,4` | séquence MIPS valide, encodage `0x0C400156` puis `0x24450004` | ✅ plausible |

Des chiffres inventés cassent presque toujours à l'addition. Ici, ils s'emboîtent.

## 2. Cohérence externe : plusieurs marqueurs d'authenticité

| Détail du rapport | Ce que la réalité PS2 dit | Verdict |
|---|---|---|
| Entrée `0x01000008` | Valeur exacte relevée par PCSX2 sur GT4 (log `EntryPoint = 0x01000008`) | ✅ **factuel** |
| `e_flags = 0x20924001` | Constante exacte qu'utilisent les outils communautaires pour marquer un binaire EE | ✅ **factuel** |
| Syscalls **7** = `ExecPS2`, **60** = `SetupThread`, **61** = `SetupHeap` | Ce sont les vrais numéros de la table de syscalls PS2 | ✅ **très bon signe** : un modèle qui invente se trompe là |
| crt0 : effacement des registres 128 bits, `mthi1`/`mtlo1`, purge `.bss`/`.sbss`, `.ctors` | Comportement réel du crt0 ee-gcc | ✅ cohérent |
| `$gp` lu dans `.reginfo` | `.reginfo` (24 o, `gp_value` à l'offset 20) est bien la mécanique EE | ✅ mécanisme exact |
| Sérial PAL `SCES-51719` | Bon sérial GT4 PAL | ✅ |
| CORE à `0x00100000`, entrée `0x00100008` | Adresse de chargement par défaut des modules PS2 | ✅ |
| IOPRP300.IMG, sio2man, padman… | Vrais noms de modules IOP Sony | ✅ |

## 3. Ce qui reste à prouver — et ce que je demanderais

Ce sont les seules parties où le rapport peut broder. Chacune se tranche en une seconde.

| Assertion | Comment trancher | Pourquoi c'est suspect *a priori* |
|---|---|---|
| `PDISTD::InflateBase`, `ImageLoader::DiskSource`, `MCardSource<slot, port>`, `MCardFileName` extraits « du RTTI » | `strings gt4_principal.elf \| grep -E 'PDISTD\|ImageLoader\|MCard'` | **GT4 retail est strippé.** Du RTTI en `.rodata` est possible (C++ avec EH : `.eh_frame`, `.gcc_except_table` sont cités), mais les noms de *sources* (Disk/Host/MCard) sentent la reconstruction |
| `main` @ `0x01000558`, cadre de pile de **208 octets** | premier mot à `0x01000558` doit être `addiu $sp,$sp,-208` (`27BD FF30`) | un nom inventé ne coûte rien ; une taille de cadre est falsifiable |
| `Memcpy128` @ `0x0101E81C` « avec `lq`/`sq` » | désassembler : présence de `lq`/`sq` (opcodes MMI) | plausible mais non démontré |
| `ReadCoreStream` @ `0x01004500`, `Inflate` @ `0x0100C828`, etc. | les adresses doivent tomber sur des prologues valides | noms = étiquettes reconstruites, pas des symboles |
| Aucun **artefact de preuve** (hexdump, xref, table de sections, hash par fonction) | REA a `get_evidence_bundle` exprès | sans bundle, tout est déclaratif |

**Le test de 30 secondes** : demande à l'agent le SHA-256 du fichier *et* le premier mot
hexadécimal à `0x01000558`. Puis :

```bash
sha256sum gt4_principal.elf
python3 tools/audit_agent_report.py --elf gt4_principal.elf --core core.gt4 \
        --claims claims/gt4_report_claims.json
```

Le fichier de claims fourni contient **20 assertions du rapport**, prêtes à vérifier.
Sortie attendue : `PASS` / `FAIL` / `UNKNOWN` par ligne, code retour 1 si une seule
assertion est contredite par les octets.

## 4. Le point de périmètre, le plus important

Même si tout est vrai — et c'est probablement le cas pour l'essentiel — **ce rapport
n'analyse pas le jeu**. Il analyse le **chargeur** :

- fichier analysé : 273 020 octets (0,27 Mo) ;
- jeu réel : le CORE, `6 119 116` octets (6,12 Mo) **après** décompression.

Toutes les « fonctions clés » listées appartiennent au bootloader : init IRX, lecture
du CORE, inflate, `ExecPS2`. Le moteur GT4 (physique, IA, rendu, VU1) n'est **pas**
touché : le rapport s'arrête à la porte. C'est une bonne étape 1, pas une décompilation.

C'est aussi la limite de la question posée : « identifie le main et les fonctions clés »
n'a de sens que pour le chargeur, puisque `gt4_principal.elf` *est* le chargeur.

## 5. Suite utile

```bash
# ce que le rapport ne fait pas : entrer dans le moteur
python3 tools/gt4_core.py core.gt4 --info
python3 tools/gt4_core.py core.gt4 --to-elf CORE.GT4.elf
python3 tools/ps2recon.py CORE.GT4.elf
```

Et pour les *noms* de fonctions du moteur, la source légitime n'est pas un agent qui
devine : c'est **gt4-decomp**, qui maintient les noms, les layouts de classes et les
notes de moteur, et dont les projets de port se servent déjà.

## 6. Note sur l'outil nommé

Le rapport dit « REA (*Reverse Engineer Anything*) ». C'est le projet `morluto/rea`
(orchestrateur MCP autour de Hopper/Ghidra/IDA), **pas** `mytechnotalent/rea`
(« Reverse Engineering Assistant ») que j'avais examiné. Les deux produisent du
renseignement, aucun ne produit de port natif. La distinction vaut la peine d'être
faite si tu dois citer la source.
