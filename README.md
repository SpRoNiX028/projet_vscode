# ⚔️ L'Âge des Empires — RTS en JavaScript

Un jeu de stratégie en temps réel inspiré d'**Age of Empires**, écrit en HTML5 Canvas + JavaScript pur, sans dépendance ni étape de build.

## Lancer le jeu

Ouvrez simplement `index.html` dans un navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

## Fonctionnalités

- **Carte générée aléatoirement** (symétrique pour l'équité) : forêts, lacs, or, pierre, baies — avec graine reproductible.
- **Économie** : villageois qui récoltent 4 ressources (nourriture, bois, or, pierre), dépôts (moulin, camps de bûcherons / mineurs), fermes, population limitée par les maisons.
- **4 âges** : sombre → féodal → châteaux → impérial, chacun débloquant bâtiments, unités et technologies.
- **14 bâtiments** : hôtel de ville, maison, moulin, camps, ferme, forge, caserne, camp de tir, écurie, atelier de siège, tour, château, merveille…
- **12 unités** avec système de bonus (piquiers > cavalerie, tirailleurs > archers, siège > bâtiments…) : milicien, piquier, épéiste, archer, tirailleur, arbalétrier, éclaireur, chevalier, paladin, bélier, mangonneau.
- **15 technologies** (métier à tisser, brouette, hache à double tranchant, forgeage, empennage…).
- **IA adversaire** (3 niveaux de difficulté) : gère son économie, construit, avance en âge, se défend et lance des vagues d'attaque.
- **Brouillard de guerre**, mini-carte, pathfinding A*, formations, points de ralliement, groupes de contrôle, zoom, sons synthétisés.
- **Victoire** par conquête ou en défendant une Merveille pendant 3 minutes.

## Commandes

| Action | Commande |
|---|---|
| Sélectionner | Clic gauche / glisser / double-clic (même type) / Maj+clic |
| Ordre contextuel (déplacer, récolter, construire, attaquer, ralliement) | Clic droit |
| Caméra | Flèches, bords de l'écran, clic molette, mini-carte · molette = zoom |
| Raccourcis des boutons | Q W E R A S D T |
| Hôtel de ville / villageois inactif | H / . |
| Groupes | Ctrl+1…9 pour créer, 1…9 pour rappeler (double = centrer) |
| Former ×5 / placer plusieurs bâtiments | Maj |
| Annuler / supprimer / pause | Échap / Suppr / P |

## Structure

```
index.html        page + interface
css/style.css     styles
js/data.js        définitions (unités, bâtiments, technologies, âges)
js/map.js         génération de la carte
js/path.js        recherche de chemin A*
js/entities.js    ressources, bâtiments, unités, combat
js/game.js        boucle de jeu, brouillard, sons, conditions de victoire
js/ai.js          intelligence artificielle
js/render.js      rendu Canvas et mini-carte
js/ui.js          panneaux et commandes
js/input.js       souris / clavier / caméra
js/main.js        démarrage
```
