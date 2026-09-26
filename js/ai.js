// ============================================================
//  Intelligence artificielle de l'adversaire
// ============================================================
const AI_CFG = {
  easy: { firstWave: 660, waveSize: 5, waveGrow: 2, waveGap: 200, vill: [14, 20, 24, 28], ageVills: [16, 22, 28], towers: 0, castle: false, techChance: 0.2 },
  normal: { firstWave: 450, waveSize: 7, waveGrow: 3, waveGap: 150, vill: [20, 28, 34, 40], ageVills: [19, 26, 32], towers: 1, castle: true, techChance: 0.5 },
  hard: { firstWave: 330, waveSize: 8, waveGrow: 4, waveGap: 110, vill: [24, 32, 40, 48], ageVills: [20, 28, 34], towers: 2, castle: true, techChance: 0.9 },
};
const AI_RATIOS = [
  { food: 0.55, wood: 0.42, gold: 0.03, stone: 0 },
  { food: 0.44, wood: 0.32, gold: 0.19, stone: 0.05 },
  { food: 0.40, wood: 0.28, gold: 0.24, stone: 0.08 },
  { food: 0.40, wood: 0.27, gold: 0.25, stone: 0.08 },
];

class AIController {
  constructor(pid, diff) {
    this.pid = pid;
    this.p = G.players[pid];
    this.enemy = pid === 1 ? 2 : 1;
    this.cfg = AI_CFG[diff];
    this.thinkT = 1;
    this.nextWave = this.cfg.firstWave;
    this.waveSize = this.cfg.waveSize;
    this.attackers = new Set();
    const b = BASES[pid];
    this.home = { x: (b.tx + 2) * TILE, y: (b.ty + 2) * TILE };
    const eb = BASES[this.enemy];
    const ex = (eb.tx + 2) * TILE, ey = (eb.ty + 2) * TILE;
    const dx = ex - this.home.x, dy = ey - this.home.y, d = Math.hypot(dx, dy);
    this.rally = { x: this.home.x + dx / d * 7 * TILE, y: this.home.y + dy / d * 7 * TILE };
    this.threat = null;
    this.waveCount = 0;
  }
  onUnitCreated(u) {
    if (u.isMilitary()) u.orderMove(this.rally.x + rand(-40, 40), this.rally.y + rand(-40, 40));
  }
  onAttacked(target, attacker) {
    if (attacker && attacker.alive && attacker.kind === 'unit') this.threat = attacker;
  }
  onVillagerAttacked(v, attacker) { this.threat = attacker; }

  update(dt) {
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 1; this.think(); }
  }

  build(type, near, minR, maxR, nBuilders = 1) {
    const p = this.p;
    const d = BUILDING_DEFS[type];
    if (!canAfford(p, d.cost) || !buildingRequirementMet(p, type)) return false;
    const pos = this.findPlacement(type, near.x, near.y, minR, maxR);
    if (!pos) return false;
    const builders = this.pickBuilders(pos, nBuilders);
    if (!builders.length) return false;
    pay(p, d.cost);
    const b = placeBuilding(type, pos.tx, pos.ty, this.pid);
    for (const v of builders) v.orderBuild(b);
    return true;
  }
  pickBuilders(pos, n) {
    const x = (pos.tx + 1) * TILE, y = (pos.ty + 1) * TILE;
    const cand = this.vills.filter(v => !v.cmd || v.cmd.type !== 'build')
      .map(v => ({ v, d: dist(v.x, v.y, x, y) + (v.cmd && v.cmd.resType === 'food' ? 200 : 0) + (v.carry > 5 ? 150 : 0) }))
      .sort((a, b) => a.d - b.d);
    return cand.slice(0, n).map(c => c.v);
  }
  findPlacement(type, cx, cy, minR, maxR) {
    const d = BUILDING_DEFS[type];
    const s = d.size;
    const ctx = Math.floor(cx / TILE), cty = Math.floor(cy / TILE);
    const a0 = Math.random() * Math.PI * 2;
    for (let r = minR; r <= maxR; r++) {
      const steps = Math.max(8, Math.floor(r * 6));
      for (let i = 0; i < steps; i++) {
        const a = a0 + i / steps * Math.PI * 2;
        const tx = Math.round(ctx + Math.cos(a) * r - s / 2), ty = Math.round(cty + Math.sin(a) * r - s / 2);
        if (!canPlace(type, tx, ty, this.pid)) continue;
        if (!this.marginOk(tx, ty, s, type)) continue;
        return { tx, ty };
      }
    }
    return null;
  }
  // Laisse un couloir d'une case autour des bâtiments pour ne pas bloquer
  marginOk(tx, ty, s, type) {
    for (let y = ty - 1; y <= ty + s; y++) for (let x = tx - 1; x <= tx + s; x++) {
      if (x >= tx && x < tx + s && y >= ty && y < ty + s) continue;
      if (!inBounds(x, y)) return false;
      const id = World.block[y * MAP_W + x];
      if (id > 0) {
        const e = G.byId.get(id);
        if (e && e.kind === 'building') return false;
      }
      // éviter de coller une ferme / un bâtiment à une ferme
      for (const f of this.farms) {
        if (x >= f.tx && x < f.tx + f.size && y >= f.ty && y < f.ty + f.size && type !== 'farm') return false;
      }
    }
    return true;
  }

  think() {
    if (G.over) return;
    const p = this.p, pid = this.pid;
    const vills = [], mil = [], bld = {};
    this.farms = [];
    for (const e of G.entities) {
      if (!e.alive || e.owner !== pid) continue;
      if (e.kind === 'unit') (e.cls === 'villager' ? vills : mil).push(e);
      else if (e.kind === 'building') {
        (bld[e.type] = bld[e.type] || []).push(e);
        if (e.walkable) this.farms.push(e);
      }
    }
    this.vills = vills; this.mil = mil; this.bld = bld;
    const count = t => (bld[t] || []).length;
    const tc = (bld.town_center || []).find(b => b.complete) || null;
    if (tc) this.home = { x: tc.x, y: tc.y };
    const age = p.age;
    const underConstruction = Object.values(bld).flat().filter(b => !b.complete && !b.walkable).length;

    // Reconstruire un HDV
    if (!bld.town_center && vills.length) this.build('town_center', this.home, 0, 10, 3);

    // --- Économie : villageois
    const vt = this.cfg.vill[age];
    if (tc) {
      const queuedV = tc.queue.filter(q => q.kind === 'unit').length;
      if (vills.length + queuedV < vt && queuedV < 2 && !tc.queue.some(q => q.kind === 'age')) tc.enqueue('unit', 'villager', true);
    }
    // --- Passage d'âge
    let saving = null;
    if (tc && age < 3 && !p.ageing && vills.length >= this.cfg.ageVills[age] - 2) {
      saving = AGES[age + 1].cost;
      if (tc.queue.filter(q => q.kind === 'unit').length <= 1 && canAfford(p, saving)) {
        if (tc.enqueue('age', null, true)) saving = null;
      }
    }
    const spare = cost => {
      if (!saving) return canAfford(p, cost);
      for (const k in cost) if (p.res[k] - cost[k] < (saving[k] || 0)) return false;
      return true;
    };

    // --- Maisons
    const housesBuilding = (bld.house || []).filter(h => !h.complete).length;
    if (p.popCap < 200 && p.popCap - (p.pop + p.reserved) <= 3 + age * 2 && housesBuilding < (p.pop > 40 ? 2 : 1)) {
      this.build('house', this.home, 4, 16);
    }
    // --- Dépôts
    if (vills.length >= 4) {
      const berry = findNearestResource('food', this.home.x, this.home.y, 16, pid);
      if (berry && berry.kind === 'resource' && !this.hasDropNear('food', berry, 5) && count('mill') < 2) this.build('mill', berry, 1, 5);
      if (count('mill') === 0 && !berry && vills.length >= 10) this.build('mill', this.home, 4, 10);
    }
    if (vills.length >= 5) {
      const tree = findNearestResource('wood', this.home.x, this.home.y, 30, pid);
      if (tree && !this.hasDropNear('wood', tree, 5) && underConstruction < 3) this.build('lumber_camp', tree, 1, 4);
    }
    if (vills.length >= 10 || age >= 1) {
      const gold = findNearestResource('gold', this.home.x, this.home.y, 30, pid);
      if (gold && !this.hasDropNear('gold', gold, 5) && underConstruction < 3) this.build('mining_camp', gold, 1, 4);
    }
    if (age >= 1 && vills.length >= 20) {
      const stone = findNearestResource('stone', this.home.x, this.home.y, 30, pid);
      if (stone && !this.hasDropNear('stone', stone, 5) && underConstruction < 3) this.build('mining_camp', stone, 1, 4);
    }

    // --- Bâtiments militaires
    if (underConstruction < 3) {
      if (!count('barracks') && vills.length >= 11) this.build('barracks', this.home, 6, 14, 2);
      else if (age >= 1 && !count('archery_range') && vills.length >= 15) this.build('archery_range', this.home, 6, 14, 2);
      else if (age >= 1 && !count('blacksmith') && vills.length >= 18) this.build('blacksmith', this.home, 5, 14);
      else if (age >= 1 && !count('stable') && vills.length >= 20) this.build('stable', this.home, 6, 14, 2);
      else if (age >= 2 && !count('siege_workshop')) this.build('siege_workshop', this.home, 6, 15, 2);
      else if (age >= 1 && count('tower') < this.cfg.towers && p.res.stone >= 200) this.build('tower', this.rally, 0, 5);
      else if (age >= 2 && this.cfg.castle && !count('castle') && p.res.stone >= 650) this.build('castle', this.rally, 0, 6, 4);
      else if (age >= 2 && count('barracks') < 2 && p.res.wood > 500) this.build('barracks', this.home, 7, 16, 2);
      else if (age >= 2 && count('archery_range') < 2 && p.res.wood > 500) this.build('archery_range', this.home, 7, 16, 2);
    }

    // --- Technologies
    if (Math.random() < this.cfg.techChance) {
      for (const list of Object.values(bld)) for (const b of list) {
        if (!b.complete || b.queue.length || !b.def.techs) continue;
        for (const t of b.def.techs) {
          const d = TECH_DEFS[t];
          if (p.techs.has(t) || p.researching.has(t) || p.age < d.age) continue;
          if (d.requires && !p.techs.has(d.requires)) continue;
          const cost = d.cost;
          const total = Object.values(cost).reduce((a, c) => a + c, 0);
          if (spare(cost) && Object.keys(cost).every(k => p.res[k] > cost[k] + total * 0.5)) { b.enqueue('tech', t, true); break; }
        }
      }
    }

    // --- Formation militaire
    const enemyCav = G.entities.filter(e => e.alive && e.owner === this.enemy && e.cls === 'cavalry').length;
    const enemyArch = G.entities.filter(e => e.alive && e.owner === this.enemy && e.cls === 'archer').length;
    for (const type of ['barracks', 'archery_range', 'stable', 'siege_workshop']) {
      for (const b of bld[type] || []) {
        if (!b.complete || b.queue.length >= 2) continue;
        const opts = b.def.train.filter(u => UNIT_DEFS[u].age <= age);
        if (!opts.length) continue;
        let u;
        if (type === 'barracks') u = enemyCav > 3 && opts.includes('spearman') ? 'spearman' : (opts.includes('swordsman') ? 'swordsman' : (Math.random() < 0.4 && opts.includes('spearman') ? 'spearman' : 'militia'));
        else if (type === 'archery_range') u = enemyArch > 4 && opts.includes('skirmisher') ? 'skirmisher' : (opts.includes('crossbowman') ? 'crossbowman' : 'archer');
        else if (type === 'stable') u = opts.includes('paladin') ? 'paladin' : opts.includes('knight') ? 'knight' : 'scout';
        else u = mil.filter(m => m.cls === 'siege').length >= 4 ? null : (Math.random() < 0.5 ? 'ram' : 'mangonel');
        if (!u) continue;
        if (type === 'stable' && u === 'scout' && mil.filter(m => m.type === 'scout').length >= 3) continue;
        if (spare(UNIT_DEFS[u].cost) && p.pop + p.reserved < p.popCap) b.enqueue('unit', u, true);
      }
    }

    // --- Affectation des villageois
    this.assignVillagers(vills, age);

    // --- Défense
    this.defend(mil);
    // --- Attaque
    this.manageAttack(mil);
  }

  hasDropNear(resType, r, tiles) {
    const d = findDropsite(this.pid, resType, r.x, r.y);
    if (d && distToEntity(r.x, r.y, d) < tiles * TILE) return true;
    // bâtiment de dépôt en construction à proximité
    for (const list of Object.values(this.bld)) for (const b of list) {
      if (!b.complete && b.def.drop && b.def.drop.includes(resType) && distToEntity(r.x, r.y, b) < tiles * TILE) return true;
    }
    return false;
  }

  assignVillagers(vills, age) {
    const p = this.p;
    // Chantiers abandonnés : on y renvoie un villageois
    const builders = new Set(vills.filter(v => v.cmd && v.cmd.type === 'build').map(v => v.cmd.target));
    for (const list of Object.values(this.bld)) for (const b of list) {
      if (b.complete || builders.has(b)) continue;
      const cand = vills.filter(v => !v.cmd || v.cmd.type === 'gather').sort((a, c) => dist(a.x, a.y, b.x, b.y) - dist(c.x, c.y, b.x, b.y))[0];
      if (cand) { cand.orderBuild(b); builders.add(b); }
    }
    const counts = { food: 0, wood: 0, gold: 0, stone: 0 };
    const byType = { food: [], wood: [], gold: [], stone: [] };
    const idle = [];
    for (const v of vills) {
      if (!v.cmd) idle.push(v);
      else if (v.cmd.type === 'gather') { counts[v.cmd.resType]++; byType[v.cmd.resType].push(v); }
    }
    // Ratios ajustés selon les stocks
    const ratios = {};
    let sum = 0;
    for (const k of RES_TYPES) {
      let r = AI_RATIOS[age][k];
      if (p.res[k] > 1500) r *= 0.3; else if (p.res[k] > 700) r *= 0.6; else if (p.res[k] < 100 && r > 0) r *= 1.4;
      ratios[k] = r; sum += r;
    }
    for (const k of RES_TYPES) ratios[k] /= sum;
    const total = vills.length;
    const deficit = k => ratios[k] * total - counts[k];
    for (const v of idle) {
      let best = null, bd = -1e9;
      for (const k of RES_TYPES) if (ratios[k] > 0 && deficit(k) > bd) { bd = deficit(k); best = k; }
      const got = this.assignOne(v, best);
      if (got) counts[got]++;
    }
    // Rééquilibrage : un villageois change de tâche par cycle
    let hi = null, lo = null;
    for (const k of RES_TYPES) {
      if (ratios[k] > 0 && (!hi || deficit(k) > deficit(hi))) hi = k;
      if (!lo || deficit(k) < deficit(lo)) lo = k;
    }
    if (hi && lo && hi !== lo && deficit(hi) >= 1.5 && deficit(lo) <= -1) {
      const v = byType[lo].filter(v => v.carry < 3)[0] || byType[lo][0];
      if (v) this.assignOne(v, hi);
    }
  }

  assignOne(v, type) {
    let target = findNearestResource(type, this.home.x, this.home.y, type === 'food' ? 14 : 34, this.pid);
    if (!target && type === 'food') {
      if (this.bld.mill && this.bld.mill.some(m => m.complete) && canAfford(this.p, BUILDING_DEFS.farm.cost)) {
        const near = (this.bld.mill.find(m => m.complete && dist(m.x, m.y, this.home.x, this.home.y) < 10 * TILE)) || this.home;
        const pos = this.findPlacement('farm', near.x, near.y, 3, 9) || this.findPlacement('farm', this.home.x, this.home.y, 3, 11);
        if (pos) {
          pay(this.p, BUILDING_DEFS.farm.cost);
          const f = placeBuilding('farm', pos.tx, pos.ty, this.pid);
          this.farms.push(f);
          v.orderBuild(f);
          return 'food';
        }
      } else if (!(this.bld.mill || []).length && canAfford(this.p, BUILDING_DEFS.mill.cost)) {
        this.build('mill', this.home, 4, 10);
      }
      type = 'wood';
      target = findNearestResource('wood', v.x, v.y, 40, this.pid);
    }
    if (!target) target = findNearestResource(type, v.x, v.y, 60, this.pid);
    if (!target) for (const k of RES_TYPES) { target = findNearestResource(k, v.x, v.y, 60, this.pid); if (target) break; }
    if (target) { v.orderGather(target); return target.resType; }
    return null;
  }

  defend(mil) {
    let threat = alive(this.threat) ? this.threat : null;
    if (!threat) {
      let bd = 16 * TILE;
      for (const e of G.entities) {
        if (!e.alive || e.owner !== this.enemy || e.kind !== 'unit') continue;
        const d = dist(e.x, e.y, this.home.x, this.home.y);
        if (d < bd) { bd = d; threat = e; }
      }
    }
    this.threat = null;
    if (!threat || dist(threat.x, threat.y, this.home.x, this.home.y) > 22 * TILE) return;
    for (const m of mil) {
      if (this.attackers.has(m.id)) continue;
      if (m.def.onlyBuildings) continue;
      if (!m.cmd || m.cmd.type === 'move' || (m.cmd.type === 'attack' && m.cmd.auto)) m.orderAttack(threat, false);
    }
  }

  manageAttack(mil) {
    // Nettoyage
    for (const id of [...this.attackers]) if (!G.byId.has(id)) this.attackers.delete(id);
    const available = mil.filter(m => !this.attackers.has(m.id) && (!m.cmd || m.cmd.type === 'move'));
    if (G.time >= this.nextWave && available.length >= this.waveSize) {
      this.waveCount++;
      for (const m of available) this.attackers.add(m.id);
      this.nextWave = G.time + this.cfg.waveGap;
      this.waveSize = Math.min(45, this.waveSize + this.cfg.waveGrow);
      if (this.waveCount === 1 && this.enemy === 1) notify('Des éclaireurs signalent une armée ennemie en marche !', 'bad');
    }
    // Les attaquants inactifs cherchent une nouvelle cible
    for (const id of this.attackers) {
      const m = G.byId.get(id);
      if (!m || (m.cmd && m.cmd.type === 'attack')) continue;
      const t = this.globalTarget(m);
      if (t) m.orderAttack(t, false);
      else { m.orderMove(this.rally.x, this.rally.y); this.attackers.delete(id); }
    }
    // Retour des vagues épuisées : si le reste de la vague est très réduit, on garde la pression quand même
  }

  globalTarget(m) {
    let best = null, bd = 1e12;
    for (const e of G.entities) {
      if (!e.alive || e.owner !== this.enemy) continue;
      if (m.def.onlyBuildings && e.kind !== 'building') continue;
      let d = dist(e.x, e.y, m.x, m.y);
      if (e.kind === 'building' && e.walkable) d += 400;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
}
