// ============================================================
//  Entités : ressources, bâtiments, unités, projectiles
// ============================================================
const G = {
  entities: [], byId: new Map(), nextId: 1,
  players: {}, time: 0, selection: [], projectiles: [], decals: [], effects: [],
  running: false, paused: false, over: false, speed: 1, difficulty: 'normal',
  aiGatherMult: 1,
};

function createPlayer(id) {
  return {
    id, color: PLAYER_COLORS[id], name: PLAYER_NAMES[id],
    res: { food: 200, wood: 200, gold: 100, stone: 200 },
    age: 0, pop: 0, popCap: 0, reserved: 0, mods: newMods(), techs: new Set(), researching: new Set(),
    ageing: false, wonderTimer: null,
    stats: { trained: 0, killed: 0, lost: 0, built: 0, gathered: 0, razed: 0 },
  };
}

const alive = e => e && e.alive;

class Entity {
  constructor(kind, owner) {
    this.id = G.nextId++;
    this.kind = kind;
    this.owner = owner;
    this.alive = true;
    G.entities.push(this);
    G.byId.set(this.id, this);
  }
  get player() { return G.players[this.owner]; }
}

// ---------------- Ressources ----------------
class ResourceNode extends Entity {
  constructor(type, tx, ty) {
    super('resource', 0);
    this.type = type;
    this.def = RESOURCE_DEFS[type];
    this.resType = this.def.resType;
    this.tx = tx; this.ty = ty; this.size = 1;
    this.x = (tx + 0.5) * TILE; this.y = (ty + 0.5) * TILE;
    this.amount = this.maxAmount = RES_AMOUNT[type];
    this.variant = Math.random();
    this.hp = this.maxHp = 1;
    World.block[ty * MAP_W + tx] = this.id;
  }
}
function createResource(type, tx, ty) { return new ResourceNode(type, tx, ty); }

// ---------------- Bâtiments ----------------
class Building extends Entity {
  constructor(type, owner, tx, ty, complete = false) {
    super('building', owner);
    this.type = type;
    this.def = BUILDING_DEFS[type];
    this.size = this.def.size;
    this.tx = tx; this.ty = ty;
    this.x = (tx + this.size / 2) * TILE; this.y = (ty + this.size / 2) * TILE;
    this.maxHp = this.def.hp;
    this.complete = complete;
    this.progress = complete ? 1 : 0;
    this.hp = complete ? this.maxHp : Math.max(1, this.maxHp * 0.05);
    this.queue = []; this.prod = 0; this.rally = null;
    this.cooldown = 0; this.acqTimer = Math.random(); this.target = null;
    this.anim = Math.random() * 10;
    if (this.def.walkable) {
      this.resType = 'food';
      this.amount = this.maxAmount = this.def.food + this.player.mods.farmFood;
      this.farmer = null;
    } else {
      for (let y = ty; y < ty + this.size; y++) for (let x = tx; x < tx + this.size; x++) World.block[y * MAP_W + x] = this.id;
    }
    if (complete) this.onComplete(true);
  }
  get sight() { return this.def.sight || 4; }
  onComplete(initial) {
    this.complete = true;
    this.progress = 1;
    if (this.type === 'wonder') {
      this.player.wonderTimer = 180;
      notify(this.owner === 1 ? 'Votre Merveille est terminée ! Défendez-la pendant 3 minutes.' : 'L\'ennemi a terminé une Merveille ! Détruisez-la en moins de 3 minutes !', 'warn');
    }
    if (!initial) {
      this.player.stats.built++;
      if (this.owner === 1) { Sound.play('built'); }
    }
  }
  addBuildProgress(amount) {
    if (this.complete) return;
    const before = this.progress;
    this.progress = Math.min(1, this.progress + amount);
    this.hp = Math.min(this.maxHp, this.hp + (this.progress - before) * this.maxHp * 0.95);
    if (this.progress >= 1) {
      if (this.maxHp - this.hp < 1) this.hp = this.maxHp;
      this.onComplete(false);
    }
  }
  enqueue(kind, id, silent) {
    const p = this.player;
    let item;
    if (kind === 'unit') {
      const d = UNIT_DEFS[id];
      if (p.age < d.age) return false;
      item = { kind, id, cost: d.cost, time: d.time, icon: d.icon, name: d.name };
    } else if (kind === 'tech') {
      const d = TECH_DEFS[id];
      if (p.techs.has(id) || p.researching.has(id) || p.age < d.age) return false;
      if (d.requires && !p.techs.has(d.requires)) return false;
      item = { kind, id, cost: d.cost, time: d.time, icon: d.icon, name: d.name };
    } else if (kind === 'age') {
      if (p.ageing || p.age >= AGES.length - 1) return false;
      const a = AGES[p.age + 1];
      item = { kind, id: p.age + 1, cost: a.cost, time: a.time, icon: '🏰', name: a.name };
    }
    if (this.queue.length >= 10) { if (!silent) notify('File de production pleine.'); return false; }
    if (!canAfford(p, item.cost)) {
      if (!silent) { notify(`Pas assez de ${RES_LABEL[missingRes(p, item.cost)].toLowerCase()}.`); Sound.play('error'); }
      return false;
    }
    pay(p, item.cost);
    if (kind === 'tech') p.researching.add(id);
    if (kind === 'age') p.ageing = true;
    this.queue.push(item);
    if (!silent && this.owner === 1) Sound.play('click');
    return true;
  }
  cancel(index) {
    const item = this.queue[index];
    if (!item) return;
    const p = this.player;
    refund(p, item.cost);
    if (item.kind === 'tech') p.researching.delete(item.id);
    if (item.kind === 'age') p.ageing = false;
    if (index === 0) { if (item.started && item.kind === 'unit') p.reserved--; this.prod = 0; }
    this.queue.splice(index, 1);
  }
  update(dt) {
    if (!this.complete) return;
    this.anim += dt;
    const p = this.player;
    // Production
    if (this.queue.length) {
      const item = this.queue[0];
      if (!item.started) {
        if (item.kind === 'unit') {
          if (p.pop + p.reserved >= p.popCap) {
            if (this.owner === 1) notifyThrottled('pop', 'Population maximale atteinte : construisez des maisons !', 6);
            return;
          }
          p.reserved++;
        }
        item.started = true;
      }
      const rate = (item.kind === 'unit' && item.id !== 'villager') ? p.mods.trainSpeed : 1;
      this.prod += dt * rate;
      if (this.prod >= item.time) {
        this.queue.shift();
        this.prod = 0;
        this.finishItem(item);
      }
    }
    // Attaque (HDV, tours, châteaux)
    if (this.def.atk) {
      this.cooldown -= dt; this.acqTimer -= dt;
      const range = (this.def.range + (p.mods.range.archer > 0 ? 1 : 0)) * TILE;
      if (this.target && (!this.target.alive || distToEntity(this.x, this.y, this.target) > range + this.size * TILE / 2)) this.target = null;
      if (!this.target && this.acqTimer <= 0) {
        this.acqTimer = 0.4;
        this.target = findEnemyNear(this.owner, this.x, this.y, range / TILE + this.size / 2, true);
      }
      if (this.target && this.cooldown <= 0) {
        this.cooldown = this.def.reload;
        const n = this.type === 'castle' ? 2 : 1;
        for (let i = 0; i < n; i++) {
          spawnProjectile(this, this.target, { atk: this.def.atk + p.mods.atk.building, bonus: null, type: 'arrow' });
        }
      }
    }
  }
  finishItem(item) {
    const p = this.player;
    if (item.kind === 'unit') {
      p.reserved--;
      const pos = this.spawnPoint();
      const u = new Unit(item.id, this.owner, pos.x, pos.y);
      p.stats.trained++;
      if (this.rally) {
        const r = this.rally;
        if (r.entity && alive(r.entity) && u.type === 'villager' && (r.entity.kind === 'resource' || r.entity.walkable)) u.orderGather(r.entity);
        else u.orderMove(r.x, r.y);
      }
      if (this.owner === 1) Sound.play('train');
      if (G.ais && G.ais[this.owner]) G.ais[this.owner].onUnitCreated(u);
    } else if (item.kind === 'tech') {
      const d = TECH_DEFS[item.id];
      p.researching.delete(item.id);
      p.techs.add(item.id);
      d.apply(p);
      refreshUnitStats(this.owner);
      if (this.owner === 1) { notify(`Technologie recherchée : ${d.name}`, 'good'); Sound.play('tech'); }
    } else if (item.kind === 'age') {
      p.age = item.id; p.ageing = false;
      if (this.owner === 1) { notify(`Vous êtes entré dans l'${AGES[p.age].name} !`, 'good'); Sound.play('age'); }
      else notify(`L'ennemi est entré dans l'${AGES[p.age].name}.`, 'warn');
    }
  }
  spawnPoint() {
    const target = this.rally || { x: this.x, y: this.y + this.size * TILE };
    let best = null, bd = 1e9;
    for (let r = 1; r <= 5 && !best; r++) {
      for (let y = this.ty - r; y < this.ty + this.size + r; y++) for (let x = this.tx - r; x < this.tx + this.size + r; x++) {
        if (x >= this.tx && x < this.tx + this.size && y >= this.ty && y < this.ty + this.size) continue;
        if (!isFree(x, y)) continue;
        const d = dist((x + 0.5) * TILE, (y + 0.5) * TILE, target.x, target.y);
        if (d < bd) { bd = d; best = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }; }
      }
    }
    return best || { x: this.x, y: this.y + this.size * TILE / 2 + 8 };
  }
  get walkable() { return !!this.def.walkable; }
}

function refreshUnitStats(owner) {
  for (const e of G.entities) {
    if (e.kind !== 'unit' || e.owner !== owner || !e.alive) continue;
    const nm = e.computeMaxHp();
    if (nm !== e.maxHp) { e.hp += nm - e.maxHp; e.maxHp = nm; }
  }
}

// ---------------- Unités ----------------
class Unit extends Entity {
  constructor(type, owner, x, y) {
    super('unit', owner);
    this.type = type;
    this.def = UNIT_DEFS[type];
    this.cls = this.def.cls;
    this.x = x; this.y = y;
    this.radius = this.def.radius;
    this.maxHp = this.computeMaxHp();
    this.hp = this.maxHp;
    this.angle = Math.PI / 2;
    this.cmd = null; this.path = null; this.pi = 0;
    this.cooldown = 0; this.carry = 0; this.carryType = null; this.gAcc = 0;
    this.anim = Math.random() * 10; this.moving = false; this.working = 0; this.attackAnim = 0;
    this.acqTimer = Math.random() * 0.5; this.stuckT = 0; this.fails = 0; this.repathT = 0;
  }
  computeMaxHp() { return this.def.hp + (this.cls === 'villager' ? this.player.mods.hp.villager : 0); }
  get sight() { return this.def.sight; }
  atk() { return this.def.atk + (this.player.mods.atk[this.cls] || 0); }
  armor() { return this.def.armor + (this.player.mods.armor[this.cls] || 0); }
  range() { return this.def.range + (this.cls === 'archer' ? this.player.mods.range.archer : 0); }
  speed() { return this.def.speed * (this.cls === 'villager' ? this.player.mods.speed.villager : 1); }
  capacity() { return 10 + this.player.mods.carry; }
  isMilitary() { return this.cls !== 'villager'; }

  // --- ordres ---
  setCmd(cmd) {
    if (this.cmd && this.cmd.type === 'gather' && this.cmd.target && this.cmd.target.farmer === this.id) this.cmd.target.farmer = null;
    this.cmd = cmd; this.path = null; this.fails = 0; this.working = 0; this.moving = false;
  }
  stop() { this.setCmd(null); }
  orderMove(x, y) { this.setCmd({ type: 'move', x, y }); }
  orderGather(res) {
    if (this.cls !== 'villager') { this.orderMove(res.x, res.y); return; }
    this.setCmd({ type: 'gather', target: res, resType: res.resType, sub: 'go' });
  }
  orderBuild(b) {
    if (this.cls !== 'villager') { this.orderMove(b.x, b.y); return; }
    this.setCmd({ type: 'build', target: b });
  }
  orderAttack(t, auto = false) {
    if (this.def.onlyBuildings && t.kind !== 'building') return;
    this.setCmd({ type: 'attack', target: t, auto, home: auto ? { x: this.x, y: this.y } : null });
  }
  orderDeposit(b) {
    if (this.carry <= 0) { this.orderMove(b.x, b.y); return; }
    this.setCmd({ type: 'gather', target: null, resType: this.carryType, sub: 'drop', drop: b, stopAfter: true });
  }

  // --- déplacement ---
  pathToPoint(x, y) {
    const sx = clamp(Math.floor(this.x / TILE), 0, MAP_W - 1), sy = clamp(Math.floor(this.y / TILE), 0, MAP_H - 1);
    const tx = clamp(Math.floor(x / TILE), 0, MAP_W - 1), ty = clamp(Math.floor(y / TILE), 0, MAP_H - 1);
    const goal = PF.nearestFree(tx, ty);
    if (!goal) { this.path = []; this.pi = 0; return; }
    const r = PF.find(sx, sy, (a, b) => a === goal.x && b === goal.y, goal.x, goal.y);
    const exact = r.reached && goal.x === tx && goal.y === ty;
    this.setPath(r.path, exact ? { x, y } : null);
  }
  pathToEntity(e) {
    if (e.kind === 'unit') { this.pathToPoint(e.x, e.y); return; }
    const sx = clamp(Math.floor(this.x / TILE), 0, MAP_W - 1), sy = clamp(Math.floor(this.y / TILE), 0, MAP_H - 1);
    let x0, y0, x1, y1;
    if (e.walkable) { x0 = e.tx; y0 = e.ty; x1 = e.tx + e.size - 1; y1 = e.ty + e.size - 1; }
    else { x0 = e.tx - 1; y0 = e.ty - 1; x1 = e.tx + e.size; y1 = e.ty + e.size; }
    const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
    const r = PF.find(sx, sy, (a, b) => a >= x0 && a <= x1 && b >= y0 && b <= y1, cx, cy, 4000);
    this.setPath(r.path, null);
  }
  setPath(tiles, finalPt) {
    this.path = tiles.map(t => ({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE }));
    if (finalPt) {
      if (this.path.length) this.path[this.path.length - 1] = finalPt;
      else this.path.push(finalPt);
    }
    this.pi = 0; this.stuckT = 0;
  }
  tryMove(nx, ny) {
    if (walkablePx(nx, ny) || !walkablePx(this.x, this.y)) { this.x = nx; this.y = ny; return true; }
    if (walkablePx(nx, this.y)) { this.x = nx; return true; }
    if (walkablePx(this.x, ny)) { this.y = ny; return true; }
    return false;
  }
  followPath(dt) {
    if (!this.path || this.pi >= this.path.length) { this.moving = false; return true; }
    if (this.pi + 1 < this.path.length && PF.los(this.x, this.y, this.path[this.pi + 1].x, this.path[this.pi + 1].y)) this.pi++;
    const wp = this.path[this.pi];
    const dx = wp.x - this.x, dy = wp.y - this.y;
    const d = Math.hypot(dx, dy);
    const step = this.speed() * TILE * dt;
    this.moving = true;
    if (d > 0.01) this.angle = Math.atan2(dy, dx);
    const ox = this.x, oy = this.y;
    if (d <= step) {
      this.tryMove(wp.x, wp.y);
      this.pi++;
      if (this.pi >= this.path.length) { this.moving = false; return true; }
    } else {
      this.tryMove(this.x + dx / d * step, this.y + dy / d * step);
    }
    const moved = Math.hypot(this.x - ox, this.y - oy);
    if (moved < step * 0.25) {
      this.stuckT += dt;
      if (this.stuckT > 0.7) { this.path = null; this.stuckT = 0; this.fails++; }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
    return false;
  }
  distTo(e) { return distToEntity(this.x, this.y, e); }
  // Se rapproche d'une entité ; renvoie vrai si à portée
  approach(e, reach, dt) {
    if (this.distTo(e) <= reach) { this.path = null; this.moving = false; return true; }
    if (!this.path) this.pathToEntity(e);
    if (this.followPath(dt)) { this.path = null; this.fails++; }
    return false;
  }
  faceTo(e) { this.angle = Math.atan2(e.y - this.y, e.x - this.x); }

  // --- mise à jour ---
  update(dt) {
    this.anim += dt;
    this.cooldown -= dt;
    this.attackAnim = Math.max(0, this.attackAnim - dt);
    this.working = Math.max(0, this.working - dt);
    const c = this.cmd;
    if (!c) { this.moving = false; this.idleUpdate(dt); return; }
    switch (c.type) {
      case 'move':
        if (!this.path) {
          if (this.fails > 3) { this.stop(); break; }
          this.pathToPoint(c.x, c.y);
        }
        if (this.followPath(dt) && this.path) this.stop();
        break;
      case 'gather': this.updateGather(dt); break;
      case 'build': this.updateBuild(dt); break;
      case 'attack': this.updateAttack(dt); break;
    }
  }
  idleUpdate(dt) {
    if (this.cls === 'villager') return;
    this.acqTimer -= dt;
    if (this.acqTimer <= 0) {
      this.acqTimer = 0.5;
      const t = findEnemyNear(this.owner, this.x, this.y, this.sight, false, this.def.onlyBuildings);
      if (t) this.orderAttack(t, true);
    }
  }
  updateGather(dt) {
    const c = this.cmd, p = this.player;
    const reach = 24;
    if (c.sub === 'drop') {
      if (!alive(c.drop) || !c.drop.complete) {
        c.drop = findDropsite(this.owner, this.carryType, this.x, this.y);
        this.path = null;
        if (!c.drop) { this.working = 0; if (this.owner === 1) notifyThrottled('nodrop', 'Aucun dépôt pour cette ressource !', 8); this.stop(); return; }
      }
      if (this.approach(c.drop, reach, dt)) {
        if (this.carry > 0) {
          p.res[this.carryType] += this.carry;
          p.stats.gathered += this.carry;
          if (this.owner === 1) spawnFloat(this.x, this.y - 14, `+${this.carry}`, RES_COLOR[this.carryType]);
        }
        this.carry = 0; this.carryType = null;
        if (c.stopAfter) { this.stop(); return; }
        c.sub = 'go'; this.path = null; this.fails = 0;
      } else if (this.fails > 4) { c.drop = null; this.fails = 0; }
      return;
    }
    let t = c.target;
    if (!this.validRes(t) || this.fails > 3) {
      if (t && t.farmer === this.id) t.farmer = null;
      const exclude = this.fails > 3 ? t : null;
      t = c.target = findNearestResource(c.resType, this.x, this.y, 10, this.owner, exclude);
      this.path = null; this.fails = 0;
      if (!t) {
        if (this.carry > 0) { c.sub = 'drop'; c.stopAfter = true; c.drop = findDropsite(this.owner, this.carryType, this.x, this.y); }
        else this.stop();
        return;
      }
    }
    if (this.carry > 0 && this.carryType !== t.resType) { c.sub = 'drop'; c.drop = findDropsite(this.owner, this.carryType, this.x, this.y); this.path = null; return; }
    if (this.carry >= this.capacity()) {
      c.sub = 'drop'; c.drop = findDropsite(this.owner, this.carryType, this.x, this.y); this.path = null; this.fails = 0;
      if (t.farmer === this.id) t.farmer = null;
      return;
    }
    const r = t.walkable ? 2 : reach;
    if (this.approach(t, r, dt)) {
      if (t.walkable) {
        if (t.farmer && t.farmer !== this.id) { this.fails = 99; return; }
        t.farmer = this.id;
      }
      this.faceTo(t);
      this.working = 0.2;
      const rate = GATHER_RATE[t.walkable ? 'farm' : t.type] * p.mods.gather[t.resType] * (this.owner === 2 ? G.aiGatherMult : 1);
      this.gAcc += rate * dt;
      this.carryType = t.resType;
      while (this.gAcc >= 1 && this.carry < this.capacity() && t.amount > 0) {
        this.gAcc -= 1; this.carry++; t.amount--;
      }
      if (t.amount <= 0) {
        killEntity(t, null);
      }
    }
  }
  validRes(t) {
    if (!alive(t) || t.amount <= 0) return false;
    if (t.kind === 'resource') return true;
    return t.walkable && t.complete && t.owner === this.owner && (!t.farmer || t.farmer === this.id);
  }
  updateBuild(dt) {
    const b = this.cmd.target;
    if (!alive(b) || b.complete) {
      const done = alive(b) && b.complete ? b : null;
      this.afterBuild(done);
      return;
    }
    if (this.fails > 5) { this.stop(); return; }
    const reach = b.walkable ? 26 : 24;
    if (this.approach(b, reach, dt)) {
      this.faceTo(b);
      this.working = 0.2;
      b.addBuildProgress(dt / b.def.time * (this.owner === 2 ? G.aiGatherMult : 1));
    }
  }
  afterBuild(b) {
    if (b && b.walkable && b.owner === this.owner && !b.farmer) { this.orderGather(b); return; }
    if (b && b.def.drop && b.type !== 'town_center') {
      for (const rt of b.def.drop) {
        const r = findNearestResource(rt, b.x, b.y, 8, this.owner);
        if (r) { this.orderGather(r); return; }
      }
    }
    // autre chantier proche ?
    let best = null, bd = 10 * TILE;
    for (const e of G.entities) {
      if (e.kind === 'building' && e.alive && e.owner === this.owner && !e.complete) {
        const d = dist(e.x, e.y, this.x, this.y);
        if (d < bd) { bd = d; best = e; }
      }
    }
    if (best) this.orderBuild(best); else this.stop();
  }
  updateAttack(dt) {
    const c = this.cmd;
    let t = c.target;
    if (!alive(t) || (t.kind === 'unit' && !isVisibleTo(t, this.owner) && this.distTo(t) > this.sight * TILE)) {
      const nt = findEnemyNear(this.owner, this.x, this.y, this.sight, false, this.def.onlyBuildings);
      if (nt) { c.target = nt; this.path = null; t = nt; }
      else {
        if (c.auto && c.home && dist(this.x, this.y, c.home.x, c.home.y) > 2 * TILE) this.orderMove(c.home.x, c.home.y);
        else this.stop();
        return;
      }
    }
    if (c.auto && c.home && dist(this.x, this.y, c.home.x, c.home.y) > (this.sight + 6) * TILE) {
      this.orderMove(c.home.x, c.home.y); return;
    }
    const ranged = this.def.range > 0;
    let reach = ranged ? this.range() * TILE : this.radius + 6;
    if (!ranged && t.kind !== 'unit') reach = Math.max(reach, 24);
    const d = this.distTo(t);
    if (d <= reach) {
      this.path = null; this.moving = false;
      this.faceTo(t);
      if (this.cooldown <= 0) {
        this.cooldown = this.def.reload;
        this.attackAnim = 0.3;
        if (this.def.projectile) spawnProjectile(this, t, { atk: this.atk(), bonus: this.def.bonus, type: this.def.projectile, splash: this.def.splash });
        else applyDamage(t, calcDamage(this.atk(), this.def.bonus, t), this);
      }
    } else {
      this.repathT -= dt;
      if (t.kind === 'unit') {
        // poursuite : trajet direct si proche et dégagé
        if (d < 3 * TILE && PF.los(this.x, this.y, t.x, t.y)) {
          const dx = t.x - this.x, dy = t.y - this.y, dd = Math.hypot(dx, dy) || 1;
          const step = this.speed() * TILE * dt;
          this.angle = Math.atan2(dy, dx);
          this.moving = true;
          this.tryMove(this.x + dx / dd * step, this.y + dy / dd * step);
          this.path = null;
          return;
        }
        if (!this.path || this.repathT <= 0) { this.repathT = 0.6; this.pathToPoint(t.x, t.y); }
        if (this.followPath(dt)) this.path = null;
        if (this.fails > 8) this.stop();
      } else {
        this.approach(t, reach, dt);
        if (this.fails > 6) this.stop();
      }
    }
  }
  onAttacked(attacker) {
    if (!attacker || !attacker.alive || attacker.kind !== 'unit') return;
    if (this.owner === 1) alertAttack(this);
    if (this.isMilitary() && !this.def.onlyBuildings) {
      if (!this.cmd) this.orderAttack(attacker, true);
      else if (this.cmd.type === 'attack' && this.cmd.target.kind === 'building' && this.cmd.auto) this.orderAttack(attacker, true);
    } else if (this.cls === 'villager' && G.ais && G.ais[this.owner]) G.ais[this.owner].onVillagerAttacked(this, attacker);
  }
}

// ---------------- Fonctions utilitaires d'entités ----------------
function distToEntity(px, py, e) {
  if (e.kind === 'unit') return Math.max(0, Math.hypot(px - e.x, py - e.y) - e.radius);
  const x0 = e.tx * TILE, y0 = e.ty * TILE, x1 = (e.tx + e.size) * TILE, y1 = (e.ty + e.size) * TILE;
  const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

function isEnemy(a, b) { return a !== 0 && b !== 0 && a !== b; }

function findEnemyNear(owner, x, y, rangeTiles, preferUnits = true, onlyBuildings = false) {
  const R = rangeTiles * TILE;
  let bestU = null, bu = 1e9, bestB = null, bb = 1e9;
  for (const e of G.entities) {
    if (!e.alive || !isEnemy(owner, e.owner)) continue;
    if (e.kind === 'unit') {
      if (onlyBuildings) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < R && d < bu) { bu = d; bestU = e; }
    } else if (e.kind === 'building') {
      const d = distToEntity(x, y, e);
      if (d < R && d < bb) { bb = d; bestB = e; }
    }
  }
  if (onlyBuildings) return bestB;
  return bestU || bestB;
}

function findNearestResource(resType, x, y, maxTiles, owner, exclude) {
  let best = null, bd = maxTiles * TILE;
  for (const e of G.entities) {
    if (!e.alive || e === exclude) continue;
    if (e.kind === 'resource') {
      if (e.resType !== resType || e.amount <= 0) continue;
    } else if (e.kind === 'building') {
      if (!e.walkable || resType !== 'food' || e.owner !== owner || !e.complete || e.farmer) continue;
    } else continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function findDropsite(owner, resType, x, y) {
  let best = null, bd = 1e9;
  for (const e of G.entities) {
    if (e.kind !== 'building' || !e.alive || e.owner !== owner || !e.complete || !e.def.drop) continue;
    if (!e.def.drop.includes(resType)) continue;
    const d = distToEntity(x, y, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function calcDamage(atk, bonus, target) {
  let dmg = atk;
  if (bonus) {
    if (target.kind === 'building' && bonus.building) dmg += bonus.building;
    if (target.kind === 'unit' && bonus[target.cls]) dmg += bonus[target.cls];
  }
  const armor = target.kind === 'unit' ? target.armor() : (target.def.armor || 0);
  return Math.max(1, dmg - armor);
}

function applyDamage(target, dmg, attacker) {
  if (!alive(target) || target.kind === 'resource') return;
  target.hp -= dmg;
  if (target.kind === 'unit') target.onAttacked(attacker);
  else if (target.owner === 1) alertAttack(target);
  if (G.ais && G.ais[target.owner] && attacker) G.ais[target.owner].onAttacked(target, attacker);
  if (target.hp <= 0) killEntity(target, attacker);
}

function killEntity(e, killer) {
  if (!e.alive) return;
  e.alive = false;
  G.byId.delete(e.id);
  if (e.kind === 'resource') {
    World.block[e.ty * MAP_W + e.tx] = 0;
    if (e.type === 'tree') G.decals.push({ type: 'stump', x: e.x, y: e.y, t: 60 });
  } else if (e.kind === 'building') {
    if (!e.walkable) for (let y = e.ty; y < e.ty + e.size; y++) for (let x = e.tx; x < e.tx + e.size; x++) World.block[y * MAP_W + x] = 0;
    const p = e.player;
    if (e.queue.length && e.queue[0].started && e.queue[0].kind === 'unit') p.reserved--;
    for (const it of e.queue) {
      if (it.kind === 'tech') p.researching.delete(it.id);
      if (it.kind === 'age') p.ageing = false;
    }
    if (e.type === 'wonder') p.wonderTimer = null;
    if (!e.walkable || e.amount > 0) {
      G.decals.push({ type: 'rubble', x: e.x, y: e.y, size: e.size, t: 40 });
      if (killer) {
        G.effects.push({ type: 'smoke', x: e.x, y: e.y, t: 1.2, size: e.size });
        if (killer.player) killer.player.stats.razed++;
        if (isVisibleTile(e.x, e.y)) Sound.play('collapse');
      }
    }
  } else if (e.kind === 'unit') {
    e.player.stats.lost++;
    if (killer && killer.player) killer.player.stats.killed++;
    if (e.cmd && e.cmd.target && e.cmd.target.farmer === e.id) e.cmd.target.farmer = null;
    G.decals.push({ type: 'corpse', x: e.x, y: e.y, owner: e.owner, t: 20, cls: e.cls });
    if (isVisibleTile(e.x, e.y)) Sound.play('die');
  }
  const si = G.selection.indexOf(e);
  if (si >= 0) { G.selection.splice(si, 1); UI.selectionChanged(); }
}

function spawnProjectile(src, target, info) {
  const sx = src.x, sy = src.y - (src.kind === 'building' ? src.size * 8 : 6);
  const d = Math.hypot(target.x - sx, target.y - sy);
  const speed = info.type === 'rock' ? 260 : 420;
  G.projectiles.push({
    x: sx, y: sy, sx, sy, tx: target.x, ty: target.y, target, owner: src.owner, attacker: src,
    atk: info.atk, bonus: info.bonus, type: info.type, splash: info.splash,
    t: 0, dur: Math.max(0.15, d / speed), homing: info.type !== 'rock',
  });
  if (isVisibleTile(sx, sy) && Math.random() < 0.5) Sound.play(info.type === 'rock' ? 'catapult' : 'arrow');
}

function updateProjectiles(dt) {
  for (const p of G.projectiles) {
    p.t += dt;
    if (p.homing && alive(p.target)) { p.tx = p.target.x; p.ty = p.target.y; }
    const k = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k;
    p.h = Math.sin(k * Math.PI) * Math.min(60, p.dur * 60);
    if (k >= 1) {
      p.done = true;
      if (p.splash) {
        const R = p.splash * TILE;
        for (const e of G.entities) {
          if (!e.alive || !isEnemy(p.owner, e.owner)) continue;
          if (distToEntity(p.tx, p.ty, e) <= R) applyDamage(e, calcDamage(p.atk, p.bonus, e), alive(p.attacker) ? p.attacker : null);
        }
        G.effects.push({ type: 'dust', x: p.tx, y: p.ty, t: 0.6 });
      } else if (alive(p.target)) {
        applyDamage(p.target, calcDamage(p.atk, p.bonus, p.target), alive(p.attacker) ? p.attacker : null);
      }
    }
  }
  G.projectiles = G.projectiles.filter(p => !p.done);
}

// Peut-on poser un bâtiment ici ?
function canPlace(type, tx, ty, owner) {
  const d = BUILDING_DEFS[type];
  for (let y = ty; y < ty + d.size; y++) for (let x = tx; x < tx + d.size; x++) {
    if (!isFree(x, y)) return false;
    if (World.terrain[y * MAP_W + x] === 1) return false;
    if (owner === 1 && !Fog.explored[y * MAP_W + x]) return false;
  }
  // pas sur une ferme existante
  for (const e of G.entities) {
    if (e.alive && e.kind === 'building' && e.walkable) {
      if (tx < e.tx + e.size && tx + d.size > e.tx && ty < e.ty + e.size && ty + d.size > e.ty) return false;
    }
  }
  // pas sur des unités ennemies
  const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + d.size) * TILE, y1 = (ty + d.size) * TILE;
  for (const e of G.entities) {
    if (e.alive && e.kind === 'unit' && e.owner !== owner && e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) return false;
  }
  return true;
}

function placeBuilding(type, tx, ty, owner) {
  const b = new Building(type, owner, tx, ty, false);
  // repousser les unités présentes sur l'emprise
  if (!b.walkable) {
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + b.size) * TILE, y1 = (ty + b.size) * TILE;
    for (const e of G.entities) {
      if (e.alive && e.kind === 'unit' && e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) {
        const f = PF.nearestFree(Math.floor(e.x / TILE), Math.floor(e.y / TILE));
        if (f) { e.x = (f.x + 0.5) * TILE; e.y = (f.y + 0.5) * TILE; }
      }
    }
  }
  return b;
}

function buildingRequirementMet(p, type) {
  const d = BUILDING_DEFS[type];
  if (p.age < d.age) return false;
  if (!d.req) return true;
  return G.entities.some(e => e.alive && e.kind === 'building' && e.owner === p.id && e.type === d.req && e.complete);
}
