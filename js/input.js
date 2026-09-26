// ============================================================
//  Entrées : souris, clavier, caméra
// ============================================================
const Input = {
  mx: 0, my: 0, drag: null, dragActive: false, placing: null, keys: {}, shift: false, ctrl: false,
  lastClick: { t: 0, id: 0 }, pan: null, mouseInWindow: true, miniDrag: false, lastGroupKey: { k: null, t: 0 },

  init() {
    const c = Render.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    document.addEventListener('mouseleave', () => { this.mouseInWindow = false; });
    document.addEventListener('mouseenter', () => { this.mouseInWindow = true; });
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys = {}; });
    const m = Render.mini;
    m.addEventListener('contextmenu', e => e.preventDefault());
    m.addEventListener('mousedown', e => {
      e.stopPropagation();
      const w = this.miniToWorld(e);
      if (e.button === 0) { this.miniDrag = true; Render.centerOn(w.x, w.y); }
      else if (e.button === 2) this.command(w.x, w.y);
    });
  },
  miniToWorld(e) {
    const r = Render.mini.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * MAP_W * TILE, y: (e.clientY - r.top) / r.height * MAP_H * TILE };
  },
  get world() { return Render.screenToWorld(this.mx, this.my); },

  onDown(e) {
    if (!G.running || G.over) return;
    Sound.ctx && Sound.ctx.state === 'suspended' && Sound.ctx.resume();
    this.mx = e.clientX; this.my = e.clientY;
    this.shift = e.shiftKey;
    const w = this.world;
    if (e.button === 0) {
      if (this.placing) { this.tryPlace(w, e.shiftKey); return; }
      this.drag = { sx: e.clientX, sy: e.clientY };
      this.dragActive = false;
    } else if (e.button === 2) {
      if (this.placing) { this.placing = null; return; }
      if (!G.paused) this.command(w.x, w.y);
    } else if (e.button === 1) {
      e.preventDefault();
      this.pan = { x: e.clientX, y: e.clientY };
    }
  },
  onMove(e) {
    this.mx = e.clientX; this.my = e.clientY;
    this.mouseInWindow = true;
    if (this.drag && Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 6) this.dragActive = true;
    if (this.pan) {
      Render.cam.x -= (e.clientX - this.pan.x) / Render.cam.zoom;
      Render.cam.y -= (e.clientY - this.pan.y) / Render.cam.zoom;
      this.pan = { x: e.clientX, y: e.clientY };
      Render.clampCam();
    }
    if (this.miniDrag) { const w = this.miniToWorld(e); Render.centerOn(w.x, w.y); }
  },
  onUp(e) {
    if (e.button === 1) this.pan = null;
    if (e.button === 0) {
      this.miniDrag = false;
      if (this.drag) {
        if (this.dragActive) this.boxSelect(this.drag.sx, this.drag.sy, e.clientX, e.clientY, e.shiftKey);
        else this.clickSelect(e.shiftKey, e.ctrlKey);
      }
      this.drag = null; this.dragActive = false;
    }
  },
  onWheel(e) {
    e.preventDefault();
    const before = this.world;
    const z = clamp(Render.cam.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.5, 1.6);
    Render.cam.zoom = z;
    Render.cam.x = before.x - this.mx / z;
    Render.cam.y = before.y - this.my / z;
    Render.clampCam();
  },

  // ------------- Sélection -------------
  pickEntity(wx, wy) {
    let best = null, bd = 1e9;
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit') continue;
      if (e.owner !== 1 && !isVisibleTile(e.x, e.y)) continue;
      const d = Math.hypot(e.x - wx, e.y - (wy + 3));
      if (d < e.radius + 6 && d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    let found = null, fd = -1;
    for (const e of G.entities) {
      if (!e.alive || e.kind === 'unit') continue;
      if (e.owner !== 1 && !isExploredEntity(e)) continue;
      const x0 = e.tx * TILE, y0 = e.ty * TILE, s = e.size * TILE;
      const lift = e.kind === 'resource' ? (e.type === 'tree' ? 18 : 4) : e.walkable ? 0 : s * 0.4;
      if (wx >= x0 && wx < x0 + s && wy >= y0 - lift && wy < y0 + s) {
        const depth = y0 + s;
        if (depth > fd) { fd = depth; found = e; }
      }
    }
    return found;
  },
  clickSelect(shift, ctrl) {
    const w = this.world;
    const e = this.pickEntity(w.x, w.y);
    const now = performance.now();
    const dbl = e && this.lastClick.id === e.id && now - this.lastClick.t < 350;
    this.lastClick = { t: now, id: e ? e.id : 0 };
    if (!e) { if (!shift) G.selection = []; UI.selectionChanged(); return; }
    if ((dbl || ctrl) && e.owner === 1) {
      const vx0 = Render.cam.x, vy0 = Render.cam.y, vx1 = vx0 + Render.viewW, vy1 = vy0 + Render.viewH;
      G.selection = G.entities.filter(o => o.alive && o.owner === 1 && o.type === e.type && o.x >= vx0 && o.x <= vx1 && o.y >= vy0 && o.y <= vy1);
    } else if (shift && e.owner === 1 && G.selection.every(s => s.owner === 1)) {
      const i = G.selection.indexOf(e);
      if (i >= 0) G.selection.splice(i, 1); else G.selection.push(e);
    } else G.selection = [e];
    if (e.owner === 1) Sound.play('select');
    UI.selectionChanged();
  },
  boxSelect(sx0, sy0, sx1, sy1, shift) {
    const a = Render.screenToWorld(Math.min(sx0, sx1), Math.min(sy0, sy1));
    const b = Render.screenToWorld(Math.max(sx0, sx1), Math.max(sy0, sy1));
    let units = G.entities.filter(e => e.alive && e.owner === 1 && e.kind === 'unit' && e.x + e.radius >= a.x && e.x - e.radius <= b.x && e.y + e.radius >= a.y && e.y - e.radius <= b.y);
    if (!units.length) {
      units = G.entities.filter(e => e.alive && e.owner === 1 && e.kind === 'building' && !e.walkable && e.x >= a.x && e.x <= b.x && e.y >= a.y && e.y <= b.y);
      if (units.length) units = units.filter(e => e.type === units[0].type);
    }
    if (shift) { for (const u of units) if (!G.selection.includes(u)) G.selection.push(u); }
    else G.selection = units;
    if (units.length) Sound.play('select');
    UI.selectionChanged();
  },

  // ------------- Ordres -------------
  command(wx, wy) {
    const sel = G.selection.filter(e => e.alive && e.owner === 1);
    if (!sel.length) return;
    const target = this.pickEntity(wx, wy);
    const units = sel.filter(e => e.kind === 'unit');
    if (!units.length) {
      // point de ralliement
      for (const b of sel) if (b.kind === 'building' && b.def.train) b.rally = { x: wx, y: wy, entity: target && (target.kind === 'resource' || (target.walkable && target.owner === 1)) ? target : null };
      G.effects.push({ type: 'order', x: wx, y: wy, t: 0.6 });
      Sound.play('command');
      return;
    }
    let color = '#7dff7d';
    const movers = [];
    for (const u of units) {
      if (target && isEnemy(1, target.owner) && (target.kind === 'unit' || target.kind === 'building')) {
        if (u.def.onlyBuildings && target.kind !== 'building') movers.push(u);
        else { u.orderAttack(target); color = '#ff5050'; }
      } else if (target && target.kind === 'resource' && u.cls === 'villager') {
        u.orderGather(target); color = '#ffe070';
      } else if (target && target.kind === 'building' && target.owner === 1 && u.cls === 'villager') {
        if (!target.complete) u.orderBuild(target);
        else if (target.walkable) u.orderGather(target);
        else if (u.carry > 0 && target.def.drop && target.def.drop.includes(u.carryType)) u.orderDeposit(target);
        else movers.push(u);
        color = '#ffe070';
      } else movers.push(u);
    }
    if (movers.length) {
      const n = movers.length, cols = Math.ceil(Math.sqrt(n)), sp = 20;
      // tri pour limiter les croisements
      const cx = movers.reduce((a, u) => a + u.x, 0) / n, cy = movers.reduce((a, u) => a + u.y, 0) / n;
      const ang = Math.atan2(wy - cy, wx - cx);
      const fx = Math.cos(ang), fy = Math.sin(ang), px = -fy, py = fx;
      const proj = movers.map(u => ({ u, s: (u.x - cx) * px + (u.y - cy) * py, f: (u.x - cx) * fx + (u.y - cy) * fy }));
      proj.sort((a, b) => b.f - a.f);
      const rows = [];
      for (let i = 0; i < n; i += cols) rows.push(proj.slice(i, i + cols).sort((a, b) => a.s - b.s));
      rows.forEach((row, ri) => row.forEach((o, ci) => {
        const offS = (ci - (row.length - 1) / 2) * sp, offF = -ri * sp;
        o.u.orderMove(wx + px * offS + fx * offF, wy + py * offS + fy * offF);
      }));
    }
    G.effects.push({ type: 'order', x: wx, y: wy, t: 0.6, color });
    Sound.play('command');
  },
  tryPlace(w, keep) {
    const type = this.placing, d = BUILDING_DEFS[type], p = G.players[1];
    const tx = Math.round(w.x / TILE - d.size / 2), ty = Math.round(w.y / TILE - d.size / 2);
    if (!canPlace(type, tx, ty, 1)) { notify('Impossible de construire ici.'); Sound.play('error'); return; }
    if (!canAfford(p, d.cost)) { notify(`Pas assez de ${RES_LABEL[missingRes(p, d.cost)].toLowerCase()}.`); Sound.play('error'); this.placing = null; return; }
    pay(p, d.cost);
    const b = placeBuilding(type, tx, ty, 1);
    const vills = G.selection.filter(e => e.alive && e.owner === 1 && e.cls === 'villager');
    if (type === 'farm') { if (vills[0]) vills[0].orderBuild(b); }
    else vills.forEach(v => v.orderBuild(b));
    Sound.play('command');
    if (!keep || !canAfford(p, d.cost)) this.placing = null;
  },
  deleteSelection() {
    const sel = G.selection.filter(e => e.alive && e.owner === 1);
    for (const e of sel) {
      if (e.kind === 'building' && !e.complete) refund(e.player, e.def.cost, 0.8);
      killEntity(e, null);
    }
    G.selection = [];
    UI.selectionChanged();
  },
  selectIdleVillager() {
    const idle = UI.idleVillagers();
    if (!idle.length) return;
    UI.idleIdx = (UI.idleIdx + 1) % idle.length;
    const v = idle[UI.idleIdx];
    G.selection = [v];
    Render.centerOn(v.x, v.y);
    UI.selectionChanged();
  },

  // ------------- Clavier -------------
  onKey(e, down) {
    this.shift = e.shiftKey; this.ctrl = e.ctrlKey;
    const k = e.key;
    this.keys[k] = down;
    if (!down || !G.running) return;
    if (G.over) return;
    if (k === 'F1' || k === 'p' || k === 'P' || k === 'Pause') { e.preventDefault(); UI.togglePause(); return; }
    if (G.paused) { if (k === 'Escape') UI.togglePause(false); return; }
    if (k.startsWith('Arrow')) { e.preventDefault(); return; }
    if (k === 'Escape') {
      if (this.placing) this.placing = null;
      else if (UI.menu !== 'root') { UI.menu = 'root'; UI.updatePanel(true); }
      else { G.selection = []; UI.selectionChanged(); }
      return;
    }
    if (k === 'Delete') { this.deleteSelection(); return; }
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      if (e.ctrlKey) { G.groups[k] = G.selection.filter(x => x.owner === 1).map(x => x.id); notify(`Groupe ${k} défini.`); return; }
      const ids = G.groups[k] || [];
      const sel = ids.map(id => G.byId.get(id)).filter(alive);
      if (!sel.length) return;
      const now = performance.now();
      if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400) Render.centerOn(sel[0].x, sel[0].y);
      this.lastGroupKey = { k, t: now };
      G.selection = sel; UI.selectionChanged();
      return;
    }
    if (k === ' ') { e.preventDefault(); const s = G.selection[0]; if (s) Render.centerOn(s.x, s.y); return; }
    if (k === '.' || k === ';') { this.selectIdleVillager(); return; }
    if (e.ctrlKey || e.metaKey) return;
    if (UI.handleHotkey(k)) return;
    if (k === 'h' || k === 'H') {
      const tc = G.entities.find(x => x.alive && x.owner === 1 && x.type === 'town_center');
      if (tc) { G.selection = [tc]; Render.centerOn(tc.x, tc.y); UI.selectionChanged(); }
    }
  },

  update(dt) {
    if (!G.running) return;
    const sp = 900 * dt / Render.cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.ArrowLeft) dx -= sp;
    if (this.keys.ArrowRight) dx += sp;
    if (this.keys.ArrowUp) dy -= sp;
    if (this.keys.ArrowDown) dy += sp;
    if (this.mouseInWindow && !this.drag && !this.pan && document.hasFocus()) {
      const m = 6, W = window.innerWidth, H = window.innerHeight;
      if (this.mx <= m) dx -= sp;
      if (this.mx >= W - m) dx += sp;
      if (this.my <= m) dy -= sp;
      if (this.my >= H - m) dy += sp;
    }
    if (dx || dy) { Render.cam.x += dx; Render.cam.y += dy; Render.clampCam(); }
  },
};
