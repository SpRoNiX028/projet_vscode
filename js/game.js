// ============================================================
//  Logique de jeu : brouillard, sons, notifications, boucle
// ============================================================

// ---------------- Brouillard de guerre ----------------
const Fog = {
  visible: new Uint8Array(MAP_W * MAP_H),
  explored: new Uint8Array(MAP_W * MAP_H),
  canvas: null, ctx: null, img: null, timer: 0, revealAll: false,
  init() {
    this.visible.fill(0); this.explored.fill(0);
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_W; this.canvas.height = MAP_H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(MAP_W, MAP_H);
    this.update();
  },
  update() {
    const vis = this.visible;
    vis.fill(0);
    for (const e of G.entities) {
      if (!e.alive || e.owner !== 1) continue;
      let r = e.sight, cx = e.x / TILE, cy = e.y / TILE;
      if (e.kind === 'building') { r += e.size / 2; if (!e.complete) r = e.size / 2 + 1; }
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(MAP_H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy <= r2) vis[y * MAP_W + x] = 1;
        }
      }
    }
    if (this.revealAll) vis.fill(1);
    const d = this.img.data;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i]) this.explored[i] = 1;
      d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0;
      d[i * 4 + 3] = vis[i] ? 0 : this.explored[i] ? 125 : 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  },
};
function isVisibleTile(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return inBounds(tx, ty) && Fog.visible[ty * MAP_W + tx] === 1;
}
function isVisibleTo(e, owner) {
  if (owner !== 1) return true;
  return isVisibleTile(e.x, e.y);
}
function isExploredEntity(e) {
  const tx = e.tx !== undefined ? e.tx : Math.floor(e.x / TILE);
  const ty = e.ty !== undefined ? e.ty : Math.floor(e.y / TILE);
  const s = e.size || 1;
  for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) if (inBounds(x, y) && Fog.explored[y * MAP_W + x]) return true;
  return false;
}
function isVisibleEntity(e) {
  if (e.kind === 'unit') return isVisibleTile(e.x, e.y);
  const s = e.size || 1;
  for (let y = e.ty; y < e.ty + s; y++) for (let x = e.tx; x < e.tx + s; x++) if (inBounds(x, y) && Fog.visible[y * MAP_W + x]) return true;
  return false;
}

// ---------------- Sons (synthèse WebAudio) ----------------
const Sound = {
  ctx: null, enabled: true, last: {},
  init() { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } },
  tone(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  },
  noise(dur, vol = 0.1, freq = 800) {
    const c = this.ctx; if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start();
  },
  play(name) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    const minGap = { arrow: 120, die: 150, hit: 80, collapse: 400, catapult: 300 }[name] || 60;
    if (this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    switch (name) {
      case 'click': this.tone(660, 0.06, 'square', 0.04); break;
      case 'select': this.tone(520, 0.05, 'triangle', 0.06); break;
      case 'command': this.tone(440, 0.06, 'triangle', 0.06, 120); break;
      case 'error': this.tone(180, 0.18, 'sawtooth', 0.05); break;
      case 'train': this.tone(523, 0.1, 'triangle', 0.06); setTimeout(() => this.tone(784, 0.12, 'triangle', 0.06), 90); break;
      case 'built': this.tone(392, 0.1, 'triangle', 0.07); setTimeout(() => this.tone(523, 0.1, 'triangle', 0.07), 100); setTimeout(() => this.tone(659, 0.15, 'triangle', 0.07), 200); break;
      case 'tech': this.tone(700, 0.15, 'sine', 0.07, 200); break;
      case 'age': [392, 494, 587, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.08), i * 160)); break;
      case 'alarm': [880, 660, 880, 660].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'square', 0.05), i * 150)); break;
      case 'arrow': this.noise(0.08, 0.05, 3000); break;
      case 'die': this.tone(200, 0.2, 'sawtooth', 0.04, -120); break;
      case 'collapse': this.noise(0.8, 0.15, 400); break;
      case 'catapult': this.noise(0.3, 0.12, 250); break;
      case 'victory': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.09), i * 220)); break;
      case 'defeat': [392, 349, 311, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.6, 'sine', 0.09), i * 300)); break;
    }
  },
};

// ---------------- Notifications ----------------
const throttleMap = {};
function notify(msg, type = 'info') { UI.message(msg, type); }
function notifyThrottled(key, msg, secs, type = 'warn') {
  if (throttleMap[key] && G.time - throttleMap[key] < secs) return;
  throttleMap[key] = G.time;
  notify(msg, type);
}
let lastAlert = -99;
function alertAttack(e) {
  if (G.time - lastAlert < 12) return;
  lastAlert = G.time;
  notify(e.kind === 'building' ? `Votre ${e.def.name.toLowerCase()} est attaqué(e) !` : 'Vos unités sont attaquées !', 'bad');
  Sound.play('alarm');
  G.effects.push({ type: 'ping', x: e.x, y: e.y, t: 3 });
}
function spawnFloat(x, y, text, color) {
  G.effects.push({ type: 'text', x, y, text, color, t: 1.2 });
}

// ---------------- Séparation des unités ----------------
function separateUnits() {
  const cell = 48, grid = new Map();
  const units = [];
  for (const e of G.entities) {
    if (e.kind !== 'unit' || !e.alive) continue;
    units.push(e);
    const k = Math.floor(e.x / cell) + Math.floor(e.y / cell) * 1000;
    let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(e);
  }
  for (const a of units) {
    const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const arr = grid.get(cx + ox + (cy + oy) * 1000);
      if (!arr) continue;
      for (const b of arr) {
        if (b.id <= a.id) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        const minD = (a.radius + b.radius) * 0.85;
        if (d >= minD) continue;
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        const push = (minD - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        // Les unités au travail bougent moins
        const wa = a.working > 0 ? 0.2 : a.moving ? 0.5 : 1, wb = b.working > 0 ? 0.2 : b.moving ? 0.5 : 1;
        const tot = wa + wb;
        const pa = push * 2 * wa / tot, pb = push * 2 * wb / tot;
        const ax = a.x - nx * pa, ay = a.y - ny * pa;
        if (walkablePx(ax, ay)) { a.x = ax; a.y = ay; }
        const bx = b.x + nx * pb, by = b.y + ny * pb;
        if (walkablePx(bx, by)) { b.x = bx; b.y = by; }
      }
    }
  }
}

// ---------------- Mise à jour globale ----------------
let fogTimer = 0, checkTimer = 0;
function updateGame(dt) {
  G.time += dt;
  // population
  for (const pid of [1, 2]) { const p = G.players[pid]; p.pop = 0; p.popCap = 0; }
  for (const e of G.entities) {
    if (!e.alive || !e.owner) continue;
    const p = G.players[e.owner];
    if (e.kind === 'unit') p.pop++;
    else if (e.kind === 'building' && e.complete && e.def.pop) p.popCap += e.def.pop;
  }
  for (const pid of [1, 2]) G.players[pid].popCap = Math.min(200, G.players[pid].popCap);

  for (let i = 0; i < G.entities.length; i++) {
    const e = G.entities[i];
    if (e.alive && e.update) e.update(dt);
  }
  separateUnits();
  updateProjectiles(dt);
  if (G.ais) for (const k in G.ais) G.ais[k].update(dt);

  for (const d of G.decals) d.t -= dt;
  G.decals = G.decals.filter(d => d.t > 0);
  for (const f of G.effects) f.t -= dt;
  G.effects = G.effects.filter(f => f.t > 0);
  if (G.entities.some(e => !e.alive)) G.entities = G.entities.filter(e => e.alive);

  fogTimer -= dt;
  if (fogTimer <= 0) { fogTimer = 0.2; Fog.update(); }

  // Merveille
  for (const pid of [1, 2]) {
    const p = G.players[pid];
    if (p.wonderTimer !== null) {
      p.wonderTimer -= dt;
      if (p.wonderTimer <= 0) { endGame(pid === 1, 'Merveille'); return; }
    }
  }
  checkTimer -= dt;
  if (checkTimer <= 0) {
    checkTimer = 1;
    for (const pid of [1, 2]) {
      const hasUnit = G.entities.some(e => e.alive && e.owner === pid && e.kind === 'unit');
      const hasProd = G.entities.some(e => e.alive && e.owner === pid && e.kind === 'building' && e.def.train);
      if (!hasUnit && !hasProd) { endGame(pid === 2, 'Conquête'); return; }
    }
  }
}

function endGame(victory, reason) {
  if (G.over) return;
  G.over = true;
  Sound.play(victory ? 'victory' : 'defeat');
  UI.showEnd(victory, reason);
}

// ---------------- Démarrage ----------------
function startGame(difficulty, seed) {
  G.entities = []; G.byId = new Map(); G.nextId = 1;
  G.selection = []; G.projectiles = []; G.decals = []; G.effects = [];
  G.time = 0; G.over = false; G.paused = false;
  G.players = { 1: createPlayer(1), 2: createPlayer(2) };
  G.difficulty = difficulty;
  G.aiGatherMult = { easy: 0.75, normal: 1.0, hard: 1.3 }[difficulty];
  G.groups = {};
  buildWorld(seed);
  for (const pid of [1, 2]) {
    const b = BASES[pid];
    new Building('town_center', pid, b.tx, b.ty, true);
    const cx = (b.tx + 2) * TILE, cy = (b.ty + 2) * TILE;
    const dir = pid === 1 ? 1 : -1;
    for (let i = 0; i < 3; i++) new Unit('villager', pid, cx + (i - 1) * 22, cy + dir * 3 * TILE);
    new Unit('scout', pid, cx + dir * 3 * TILE, cy + dir * 1.5 * TILE);
    if (difficulty === 'hard' && pid === 2) { G.players[2].res.food += 100; G.players[2].res.wood += 100; }
  }
  G.ais = { 2: new AIController(2, difficulty) };
  Fog.revealAll = false;
  Fog.init();
  Render.centerOn((BASES[1].tx + 2) * TILE, (BASES[1].ty + 2) * TILE);
  UI.selectionChanged();
  G.running = true;
  notify('Bienvenue ! Récoltez des ressources, développez votre civilisation et détruisez l\'ennemi.', 'good');
  notify('Astuce : sélectionnez vos villageois et faites un clic droit sur les baies, les arbres ou l\'or.');
}
