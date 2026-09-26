// ============================================================
//  Données du jeu : unités, bâtiments, technologies, âges
// ============================================================
const TILE = 32;
const MAP_W = 96, MAP_H = 96;

const RES_TYPES = ['food', 'wood', 'gold', 'stone'];
const RES_LABEL = { food: 'Nourriture', wood: 'Bois', gold: 'Or', stone: 'Pierre' };
const RES_ICON = { food: '🍖', wood: '🪵', gold: '🪙', stone: '🪨' };
const RES_COLOR = { food: '#e0574a', wood: '#8a5a2b', gold: '#f2c230', stone: '#9aa3ad' };

const PLAYER_COLORS = { 0: '#bbbbbb', 1: '#2f6fe0', 2: '#d83a2e' };
const PLAYER_NAMES = { 1: 'Vous', 2: 'Ennemi' };

const AGES = [
  { name: 'Âge sombre' },
  { name: 'Âge féodal', cost: { food: 500 }, time: 40 },
  { name: 'Âge des châteaux', cost: { food: 800, gold: 200 }, time: 55 },
  { name: 'Âge impérial', cost: { food: 1000, gold: 800 }, time: 70 },
];

// Vitesse de récolte (unités de ressource / seconde)
const GATHER_RATE = { tree: 0.55, gold: 0.5, stone: 0.48, berry: 0.5, farm: 0.46 };
const RES_AMOUNT = { tree: 100, gold: 800, stone: 350, berry: 150 };
const RESOURCE_DEFS = {
  tree: { name: 'Arbre', resType: 'wood' },
  gold: { name: 'Mine d\'or', resType: 'gold' },
  stone: { name: 'Carrière de pierre', resType: 'stone' },
  berry: { name: 'Buisson de baies', resType: 'food' },
};

// class : villager | infantry | archer | cavalry | siege
const UNIT_DEFS = {
  villager: {
    name: 'Villageois', icon: '👷', cls: 'villager', hp: 25, atk: 3, armor: 0, range: 0, reload: 1.5,
    speed: 1.8, sight: 5, radius: 7, cost: { food: 50 }, time: 10, from: 'town_center', age: 0, key: 'Q',
    desc: 'Récolte les ressources et construit les bâtiments.'
  },
  militia: {
    name: 'Milicien', icon: '🗡️', cls: 'infantry', hp: 45, atk: 5, armor: 1, range: 0, reload: 1.8,
    speed: 1.7, sight: 5, radius: 8, cost: { food: 60, gold: 20 }, time: 14, from: 'barracks', age: 0, key: 'Q',
    bonus: { building: 2 }, desc: 'Fantassin de base, polyvalent.'
  },
  spearman: {
    name: 'Piquier', icon: '🔱', cls: 'infantry', hp: 50, atk: 4, armor: 0, range: 0, reload: 2,
    speed: 1.8, sight: 5, radius: 8, cost: { food: 35, wood: 25 }, time: 14, from: 'barracks', age: 1, key: 'W',
    bonus: { cavalry: 14 }, desc: 'Fantassin bon marché, très efficace contre la cavalerie.'
  },
  swordsman: {
    name: 'Épéiste', icon: '⚔️', cls: 'infantry', hp: 70, atk: 10, armor: 2, range: 0, reload: 1.8,
    speed: 1.7, sight: 5, radius: 8, cost: { food: 60, gold: 30 }, time: 18, from: 'barracks', age: 2, key: 'E',
    bonus: { building: 4 }, desc: 'Fantassin lourd de l\'âge des châteaux.'
  },
  archer: {
    name: 'Archer', icon: '🏹', cls: 'archer', hp: 30, atk: 4, armor: 0, range: 4.5, reload: 2,
    speed: 1.8, sight: 7, radius: 7, cost: { wood: 25, gold: 45 }, time: 16, from: 'archery_range', age: 1, key: 'Q',
    projectile: 'arrow', bonus: { infantry: 1 }, desc: 'Attaque à distance.'
  },
  skirmisher: {
    name: 'Tirailleur', icon: '🎯', cls: 'archer', hp: 30, atk: 2, armor: 1, range: 4, reload: 2,
    speed: 1.8, sight: 6, radius: 7, cost: { food: 25, wood: 35 }, time: 16, from: 'archery_range', age: 1, key: 'W',
    projectile: 'arrow', bonus: { archer: 4 }, desc: 'Unité à distance bon marché, efficace contre les archers.'
  },
  crossbowman: {
    name: 'Arbalétrier', icon: '🎯', cls: 'archer', hp: 35, atk: 6, armor: 0, range: 5, reload: 2,
    speed: 1.8, sight: 7, radius: 7, cost: { wood: 25, gold: 45 }, time: 18, from: 'archery_range', age: 2, key: 'E',
    projectile: 'bolt', bonus: { infantry: 2 }, desc: 'Archer amélioré de l\'âge des châteaux.'
  },
  scout: {
    name: 'Éclaireur', icon: '🐎', cls: 'cavalry', hp: 45, atk: 3, armor: 0, range: 0, reload: 2,
    speed: 3.2, sight: 8, radius: 10, cost: { food: 80 }, time: 20, from: 'stable', age: 1, key: 'Q',
    desc: 'Cavalerie légère très rapide, idéale pour explorer.'
  },
  knight: {
    name: 'Chevalier', icon: '🏇', cls: 'cavalry', hp: 100, atk: 10, armor: 2, range: 0, reload: 1.8,
    speed: 2.7, sight: 6, radius: 10, cost: { food: 60, gold: 75 }, time: 24, from: 'stable', age: 2, key: 'W',
    desc: 'Cavalerie lourde puissante.'
  },
  paladin: {
    name: 'Paladin', icon: '🛡️', cls: 'cavalry', hp: 160, atk: 14, armor: 3, range: 0, reload: 1.8,
    speed: 2.8, sight: 6, radius: 10, cost: { food: 60, gold: 90 }, time: 26, from: 'stable', age: 3, key: 'E',
    desc: 'L\'élite de la cavalerie impériale.'
  },
  ram: {
    name: 'Bélier', icon: '🪵', cls: 'siege', hp: 175, atk: 2, armor: 5, range: 0, reload: 3,
    speed: 1.2, sight: 4, radius: 12, cost: { wood: 160, gold: 75 }, time: 30, from: 'siege_workshop', age: 2, key: 'Q',
    bonus: { building: 110 }, onlyBuildings: true, desc: 'Détruit les bâtiments. N\'attaque que les bâtiments.'
  },
  mangonel: {
    name: 'Mangonneau', icon: '☄️', cls: 'siege', hp: 50, atk: 30, armor: 0, range: 6.5, reload: 5,
    speed: 1.2, sight: 7, radius: 11, cost: { wood: 160, gold: 135 }, time: 34, from: 'siege_workshop', age: 2, key: 'W',
    projectile: 'rock', splash: 1.1, bonus: { building: 25 }, desc: 'Arme de siège à dégâts de zone.'
  },
};

// Bâtiments ------------------------------------------------------
const BUILDING_DEFS = {
  town_center: {
    name: 'Hôtel de ville', size: 4, hp: 2400, armor: 3, cost: { wood: 275, stone: 100 }, time: 120, age: 0,
    pop: 5, drop: ['food', 'wood', 'gold', 'stone'], train: ['villager'], techs: ['loom', 'wheelbarrow', 'conscription'],
    ageUp: true, atk: 5, range: 6, reload: 2, sight: 8, page: 'eco', key: 'T',
    desc: 'Centre de votre civilisation. Forme des villageois, fait progresser les âges.'
  },
  house: {
    name: 'Maison', size: 2, hp: 550, armor: 1, cost: { wood: 25 }, time: 18, age: 0, pop: 5, sight: 3, page: 'eco', key: 'Q',
    desc: '+5 de population.'
  },
  mill: {
    name: 'Moulin', size: 2, hp: 600, armor: 1, cost: { wood: 100 }, time: 25, age: 0, drop: ['food'], sight: 4,
    techs: ['horse_collar', 'heavy_plow'], page: 'eco', key: 'W', desc: 'Dépôt de nourriture. Permet les fermes.'
  },
  lumber_camp: {
    name: 'Camp de bûcherons', size: 2, hp: 600, armor: 1, cost: { wood: 100 }, time: 25, age: 0, drop: ['wood'], sight: 4,
    techs: ['double_axe', 'bow_saw'], page: 'eco', key: 'E', desc: 'Dépôt de bois.'
  },
  mining_camp: {
    name: 'Camp de mineurs', size: 2, hp: 600, armor: 1, cost: { wood: 100 }, time: 25, age: 0, drop: ['gold', 'stone'], sight: 4,
    techs: ['gold_mining', 'stone_mining'], page: 'eco', key: 'R', desc: 'Dépôt d\'or et de pierre.'
  },
  farm: {
    name: 'Ferme', size: 3, hp: 300, armor: 0, cost: { wood: 60 }, time: 14, age: 0, walkable: true, sight: 1,
    req: 'mill', food: 250, page: 'eco', key: 'A', desc: 'Source de nourriture renouvelable (250). Nécessite un moulin.'
  },
  blacksmith: {
    name: 'Forge', size: 3, hp: 1200, armor: 2, cost: { wood: 150 }, time: 35, age: 1, sight: 4,
    techs: ['forging', 'iron_casting', 'fletching', 'scale_mail', 'scale_barding'], page: 'eco', key: 'S',
    desc: 'Améliore l\'attaque et l\'armure de vos troupes.'
  },
  wonder: {
    name: 'Merveille', size: 5, hp: 4800, armor: 3, cost: { wood: 1000, gold: 1000, stone: 1000 }, time: 250, age: 3, sight: 6,
    page: 'eco', key: 'D', desc: 'Construisez-la et défendez-la pendant 3 minutes pour gagner la partie !'
  },
  barracks: {
    name: 'Caserne', size: 3, hp: 1200, armor: 2, cost: { wood: 175 }, time: 35, age: 0, sight: 4,
    train: ['militia', 'spearman', 'swordsman'], page: 'mil', key: 'Q', desc: 'Forme l\'infanterie.'
  },
  archery_range: {
    name: 'Camp de tir à l\'arc', size: 3, hp: 1200, armor: 2, cost: { wood: 175 }, time: 35, age: 1, req: 'barracks', sight: 4,
    train: ['archer', 'skirmisher', 'crossbowman'], page: 'mil', key: 'W', desc: 'Forme les unités à distance.'
  },
  stable: {
    name: 'Écurie', size: 3, hp: 1200, armor: 2, cost: { wood: 175 }, time: 35, age: 1, req: 'barracks', sight: 4,
    train: ['scout', 'knight', 'paladin'], page: 'mil', key: 'E', desc: 'Forme la cavalerie.'
  },
  siege_workshop: {
    name: 'Atelier de siège', size: 3, hp: 1200, armor: 2, cost: { wood: 200 }, time: 40, age: 2, req: 'blacksmith', sight: 4,
    train: ['ram', 'mangonel'], page: 'mil', key: 'R', desc: 'Construit les armes de siège.'
  },
  tower: {
    name: 'Tour de guet', size: 2, hp: 800, armor: 3, cost: { wood: 25, stone: 125 }, time: 40, age: 1, sight: 9,
    atk: 6, range: 7, reload: 2, page: 'mil', key: 'A', desc: 'Tour défensive qui tire des flèches.'
  },
  castle: {
    name: 'Château', size: 4, hp: 4800, armor: 5, cost: { stone: 650 }, time: 150, age: 2, sight: 10,
    atk: 11, range: 8, reload: 1.3, page: 'mil', key: 'S', desc: 'Forteresse imposante qui tire une pluie de flèches.'
  },
};

// Technologies ----------------------------------------------------
const TECH_DEFS = {
  loom: { name: 'Métier à tisser', icon: '🧵', age: 0, cost: { gold: 50 }, time: 20, key: 'W',
    desc: 'Villageois : +15 PV, +1 armure.', apply: p => { p.mods.hp.villager += 15; p.mods.armor.villager += 1; } },
  wheelbarrow: { name: 'Brouette', icon: '🛒', age: 1, cost: { food: 175, wood: 50 }, time: 30, key: 'E',
    desc: 'Villageois : +10% vitesse, +5 capacité de transport.', apply: p => { p.mods.speed.villager *= 1.1; p.mods.carry += 5; } },
  conscription: { name: 'Conscription', icon: '📜', age: 3, cost: { food: 150, gold: 150 }, time: 40, key: 'R',
    desc: 'Formation des unités militaires 33% plus rapide.', apply: p => { p.mods.trainSpeed *= 1.33; } },
  horse_collar: { name: 'Collier de cheval', icon: '🐴', age: 1, cost: { food: 75, wood: 75 }, time: 20, key: 'Q',
    desc: 'Fermes : +75 nourriture.', apply: p => { p.mods.farmFood += 75; } },
  heavy_plow: { name: 'Charrue lourde', icon: '⚒️', age: 2, cost: { food: 125, wood: 125 }, time: 30, key: 'W',
    desc: 'Fermes : +125 nourriture, récolte de nourriture +15%.', apply: p => { p.mods.farmFood += 125; p.mods.gather.food *= 1.15; } },
  double_axe: { name: 'Hache à double tranchant', icon: '🪓', age: 1, cost: { food: 100, wood: 50 }, time: 20, key: 'Q',
    desc: 'Récolte du bois +20%.', apply: p => { p.mods.gather.wood *= 1.2; } },
  bow_saw: { name: 'Scie à deux mains', icon: '🪚', age: 2, cost: { food: 150, wood: 100 }, time: 30, key: 'W',
    desc: 'Récolte du bois +20%.', apply: p => { p.mods.gather.wood *= 1.2; } },
  gold_mining: { name: 'Extraction de l\'or', icon: '⛏️', age: 1, cost: { food: 100, wood: 75 }, time: 25, key: 'Q',
    desc: 'Récolte de l\'or +15%.', apply: p => { p.mods.gather.gold *= 1.15; } },
  stone_mining: { name: 'Extraction de la pierre', icon: '⛏️', age: 1, cost: { food: 100, wood: 75 }, time: 25, key: 'W',
    desc: 'Récolte de la pierre +15%.', apply: p => { p.mods.gather.stone *= 1.15; } },
  forging: { name: 'Forgeage', icon: '🔨', age: 1, cost: { food: 150 }, time: 30, key: 'Q',
    desc: 'Infanterie et cavalerie : +1 attaque.', apply: p => { p.mods.atk.infantry += 1; p.mods.atk.cavalry += 1; } },
  iron_casting: { name: 'Fonte du fer', icon: '🔥', age: 2, cost: { food: 220, gold: 120 }, time: 40, key: 'W', requires: 'forging',
    desc: 'Infanterie et cavalerie : +1 attaque.', apply: p => { p.mods.atk.infantry += 1; p.mods.atk.cavalry += 1; } },
  fletching: { name: 'Empennage', icon: '🪶', age: 1, cost: { food: 100, wood: 50 }, time: 30, key: 'E',
    desc: 'Archers, tours et HDV : +1 attaque, +1 portée.', apply: p => { p.mods.atk.archer += 1; p.mods.range.archer += 1; p.mods.atk.building += 1; } },
  scale_mail: { name: 'Cotte de mailles', icon: '🥋', age: 1, cost: { food: 100 }, time: 30, key: 'R',
    desc: 'Infanterie : +1 armure.', apply: p => { p.mods.armor.infantry += 1; } },
  scale_barding: { name: 'Barde en écailles', icon: '🐎', age: 1, cost: { food: 150 }, time: 30, key: 'A',
    desc: 'Cavalerie : +1 armure.', apply: p => { p.mods.armor.cavalry += 1; } },
};

function newMods() {
  return {
    gather: { food: 1, wood: 1, gold: 1, stone: 1 },
    atk: { villager: 0, infantry: 0, archer: 0, cavalry: 0, siege: 0, building: 0 },
    armor: { villager: 0, infantry: 0, archer: 0, cavalry: 0, siege: 0 },
    range: { archer: 0 },
    hp: { villager: 0 },
    speed: { villager: 1 },
    carry: 0, farmFood: 0, trainSpeed: 1,
  };
}
