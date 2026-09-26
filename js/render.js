// ============================================================
//  Rendu : terrain, entités, effets, mini-carte
// ============================================================
const Render = {
  canvas: null, ctx: null, mini: null, mctx: null,
  cam: { x: 0, y: 0, zoom: 1 },
  miniRes: null, miniResT: 0, miniFrame: 0,
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },
  get viewW() { return this.canvas.width / this.cam.zoom; },
  get viewH() { return this.canvas.height / this.cam.zoom; },
  centerOn(x, y) {
    this.cam.x = x - this.viewW / 2;
    this.cam.y = y - (this.canvas.height - UI.panelHeight()) / this.cam.zoom / 2;
    this.clampCam();
  },
  clampCam() {
    const panel = UI.panelHeight() / this.cam.zoom, top = 40 / this.cam.zoom;
    this.cam.x = clamp(this.cam.x, -120, MAP_W * TILE - this.viewW + 120);
    this.cam.y = clamp(this.cam.y, -120 - top, MAP_H * TILE - this.viewH + panel + 120);
  },
  screenToWorld(sx, sy) { return { x: sx / this.cam.zoom + this.cam.x, y: sy / this.cam.zoom + this.cam.y }; },
  worldToScreen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.zoom, y: (wy - this.cam.y) * this.cam.zoom }; },

  draw() {
    const ctx = this.ctx, cam = this.cam, z = cam.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + this.viewW, vy1 = cam.y + this.viewH;

    // Terrain
    const sx = clamp(Math.floor(vx0), 0, MAP_W * TILE), sy = clamp(Math.floor(vy0), 0, MAP_H * TILE);
    const ex = clamp(Math.ceil(vx1), 0, MAP_W * TILE), ey = clamp(Math.ceil(vy1), 0, MAP_H * TILE);
    if (ex > sx && ey > sy) ctx.drawImage(World.terrainCanvas, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);

    // Décors au sol
    for (const d of G.decals) {
      if (d.x < vx0 - 80 || d.x > vx1 + 80 || d.y < vy0 - 80 || d.y > vy1 + 80) continue;
      if (!isExploredEntity(d)) continue;
      this.drawDecal(d);
    }
    // Entités visibles
    const list = [];
    for (const e of G.entities) {
      if (!e.alive) continue;
      const m = e.kind === 'building' ? e.size * TILE : 40;
      if (e.x < vx0 - m || e.x > vx1 + m || e.y < vy0 - m || e.y > vy1 + m + 40) continue;
      if (e.kind === 'unit') { if (e.owner !== 1 && !isVisibleTile(e.x, e.y)) continue; }
      else if (e.owner !== 1 && !isExploredEntity(e)) continue;
      if (e.kind === 'building' && e.walkable) { this.drawFarm(e); continue; }
      list.push(e);
    }
    list.sort((a, b) => this.depth(a) - this.depth(b));
    // Cercles de sélection sous les unités
    for (const e of G.selection) if (e.alive && e.kind === 'unit') this.drawSelRing(e);
    for (const e of list) {
      if (e.kind === 'resource') this.drawResource(e);
      else if (e.kind === 'building') this.drawBuilding(e);
      else this.drawUnit(e);
    }
    // Projectiles
    for (const p of G.projectiles) this.drawProjectile(p);
    // Effets
    for (const f of G.effects) this.drawEffect(f);

    // Brouillard
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(Fog.canvas, 0, 0, MAP_W, MAP_H, 0, 0, MAP_W * TILE, MAP_H * TILE);

    // Barres de vie & sélection bâtiments
    for (const e of G.selection) {
      if (!e.alive) continue;
      if (e.kind !== 'unit') this.drawSelRect(e);
      this.drawHpBar(e);
    }
    for (const e of list) {
      if (e.kind !== 'resource' && e.hp < e.maxHp && !G.selection.includes(e) && isVisibleEntity(e)) this.drawHpBar(e, true);
      if (e.kind === 'building' && !e.complete && isVisibleEntity(e)) this.drawProgress(e);
    }
    // Point de ralliement
    const sel = G.selection[0];
    if (sel && sel.kind === 'building' && sel.owner === 1 && sel.rally) this.drawRally(sel.rally);
    // Indicateurs d'ordres
    for (const f of G.effects) if (f.type === 'order') this.drawOrderMarker(f);

    // Fantôme de placement
    if (Input.placing) this.drawGhost();

    // Rectangle de sélection (écran)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (Input.drag && Input.dragActive) {
      const d = Input.drag;
      ctx.strokeStyle = '#8fff8f'; ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(120,255,120,0.12)';
      const x = Math.min(d.sx, Input.mx), y = Math.min(d.sy, Input.my);
      const w = Math.abs(Input.mx - d.sx), h = Math.abs(Input.my - d.sy);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    if (++this.miniFrame % 3 === 0) this.drawMinimap();
  },
  depth(e) {
    if (e.kind === 'building') return (e.ty + e.size) * TILE - 4;
    if (e.kind === 'resource') return e.y + 12;
    return e.y;
  },

  // ---------------- Ressources ----------------
  drawResource(e) {
    const ctx = this.ctx, x = e.x, y = e.y, v = e.variant;
    if (e.type === 'tree') {
      const s = 0.9 + v * 0.35;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x + 5, y + 9, 13 * s, 5 * s, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(x - 2, y - 2, 4, 11);
      if (v < 0.4) {
        // sapin
        const cols = ['#1f4d2b', '#2a6337', '#347a42'];
        for (let i = 0; i < 3; i++) {
          const w = (14 - i * 3.5) * s, top = y - (10 + i * 7) * s, bot = y + 3 - i * 6 * s;
          ctx.fillStyle = cols[i];
          ctx.beginPath(); ctx.moveTo(x, top - 6 * s); ctx.lineTo(x + w, bot); ctx.lineTo(x - w, bot); ctx.closePath(); ctx.fill();
        }
      } else {
        const hue = 95 + v * 30;
        ctx.fillStyle = `hsl(${hue},45%,22%)`;
        ctx.beginPath(); ctx.arc(x, y - 10 * s, 13 * s, 0, 7); ctx.fill();
        ctx.fillStyle = `hsl(${hue},45%,30%)`;
        ctx.beginPath(); ctx.arc(x - 5 * s, y - 13 * s, 8 * s, 0, 7); ctx.arc(x + 5 * s, y - 11 * s, 8 * s, 0, 7); ctx.fill();
        ctx.fillStyle = `hsl(${hue},50%,40%)`;
        ctx.beginPath(); ctx.arc(x - 4 * s, y - 16 * s, 4.5 * s, 0, 7); ctx.fill();
      }
    } else if (e.type === 'gold' || e.type === 'stone') {
      const k = 0.55 + 0.45 * (e.amount / e.maxAmount);
      const base = e.type === 'gold' ? '#7d6a45' : '#7c8590';
      const hi = e.type === 'gold' ? '#ffd23f' : '#c5ccd4';
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 7, 14 * k, 6 * k, 0, 0, 7); ctx.fill();
      const rocks = [[-6, 2, 8], [5, 3, 7], [0, -4, 9]];
      for (const [ox, oy, r] of rocks) {
        const rr = r * k;
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.moveTo(x + ox - rr, y + oy + rr * 0.5);
        ctx.lineTo(x + ox - rr * 0.6, y + oy - rr * 0.7);
        ctx.lineTo(x + ox + rr * 0.4, y + oy - rr);
        ctx.lineTo(x + ox + rr, y + oy);
        ctx.lineTo(x + ox + rr * 0.6, y + oy + rr * 0.7);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = shadeColor(base, 30);
        ctx.beginPath(); ctx.moveTo(x + ox - rr * 0.6, y + oy - rr * 0.7); ctx.lineTo(x + ox + rr * 0.4, y + oy - rr); ctx.lineTo(x + ox + rr * 0.2, y + oy - rr * 0.2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = hi;
        ctx.fillRect(x + ox - 2, y + oy - 2, 3, 3);
        ctx.fillRect(x + ox + rr * 0.3, y + oy + 1, 2, 2);
      }
    } else if (e.type === 'berry') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 7, 12, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2f6b2a';
      ctx.beginPath(); ctx.arc(x - 5, y, 8, 0, 7); ctx.arc(x + 5, y + 1, 8, 0, 7); ctx.arc(x, y - 5, 8, 0, 7); ctx.fill();
      ctx.fillStyle = '#3f8a37';
      ctx.beginPath(); ctx.arc(x - 3, y - 6, 4, 0, 7); ctx.fill();
      const n = Math.ceil(10 * e.amount / e.maxAmount);
      ctx.fillStyle = '#d6284a';
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + v * 6, r = 3 + (i % 3) * 2.2;
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y - 2 + Math.sin(a) * r, 1.8, 0, 7); ctx.fill();
      }
    }
  },

  // ---------------- Bâtiments ----------------
  drawFarm(e) {
    const ctx = this.ctx;
    const X = e.tx * TILE, Y = e.ty * TILE, S = e.size * TILE;
    const k = e.complete ? e.amount / e.maxAmount : 0;
    ctx.fillStyle = e.complete ? '#7a5530' : 'rgba(122,85,48,0.6)';
    ctx.fillRect(X + 2, Y + 2, S - 4, S - 4);
    ctx.strokeStyle = 'rgba(60,35,15,0.6)'; ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(X + 4, Y + i * S / 8); ctx.lineTo(X + S - 4, Y + i * S / 8); ctx.stroke(); }
    if (e.complete) {
      ctx.fillStyle = `hsl(${60 + k * 40}, 60%, ${35 + k * 10}%)`;
      for (let r = 1; r < 8; r++) for (let c = 0; c < 10; c++) {
        if ((r * 7 + c * 3) % 10 > k * 10 + 1) continue;
        ctx.fillRect(X + 6 + c * (S - 12) / 10, Y + r * S / 8 - 4, 4, 5);
      }
    }
    ctx.strokeStyle = '#5b3d1f'; ctx.lineWidth = 2;
    ctx.strokeRect(X + 2, Y + 2, S - 4, S - 4);
    ctx.fillStyle = e.player.color;
    ctx.fillRect(X + 2, Y + 2, 4, 4); ctx.fillRect(X + S - 6, Y + S - 6, 4, 4);
    if (G.selection.includes(e)) this.drawSelRect(e);
  },

  drawBuilding(e) {
    const ctx = this.ctx;
    const X = e.tx * TILE, Y = e.ty * TILE, S = e.size * TILE;
    const col = e.player.color;
    // ombre
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.moveTo(X + 4, Y + S); ctx.lineTo(X + S + 8, Y + S + 2); ctx.lineTo(X + S + 8, Y + 10); ctx.lineTo(X + S, Y + 4); ctx.closePath(); ctx.fill();
    // fondation
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(X + 1, Y + 1, S - 2, S - 2);
    ctx.fillStyle = '#9f8866';
    ctx.fillRect(X + 3, Y + 3, S - 6, S - 6);
    if (!e.complete) {
      ctx.save();
      const lift = S * 0.6;
      const h = (S + lift) * e.progress;
      ctx.beginPath(); ctx.rect(X - 10, Y + S - h, S + 20, h + 4); ctx.clip();
      ctx.globalAlpha = 0.85;
      this.drawBuildingArt(e, X, Y, S, col);
      ctx.restore();
      // échafaudage
      ctx.strokeStyle = '#c9a36b'; ctx.lineWidth = 1.5;
      for (let i = 0; i <= e.size; i++) {
        ctx.beginPath(); ctx.moveTo(X + i * TILE, Y + S); ctx.lineTo(X + i * TILE, Y - 6); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(X, Y + S * 0.4); ctx.lineTo(X + S, Y + S * 0.4); ctx.moveTo(X, Y - 4); ctx.lineTo(X + S, Y - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X, Y + S); ctx.lineTo(X + S, Y - 4); ctx.stroke();
      return;
    }
    this.drawBuildingArt(e, X, Y, S, col);
  },

  // helpers de dessin
  poly(pts, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  },
  // maison à pignon : murs + toit
  gable(x, y, w, h, wall, roof, lift) {
    const ctx = this.ctx;
    const wallTop = y + h * 0.42;
    ctx.fillStyle = wall; ctx.fillRect(x, wallTop, w, y + h - wallTop);
    ctx.fillStyle = shadeColor(wall, -35); ctx.fillRect(x, y + h - 3, w, 3);
    const ridge = y - lift;
    this.poly([x - 3, wallTop + 2, x + w + 3, wallTop + 2, x + w - 2, ridge + (wallTop - ridge) * 0.35, x + 2, ridge + (wallTop - ridge) * 0.35], roof);
    this.poly([x + 2, ridge + (wallTop - ridge) * 0.35, x + w - 2, ridge + (wallTop - ridge) * 0.35, x + w - 5, ridge, x + 5, ridge], shadeColor(roof, 28));
    ctx.strokeStyle = shadeColor(roof, -40); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 2, ridge + (wallTop - ridge) * 0.35); ctx.lineTo(x + w - 2, ridge + (wallTop - ridge) * 0.35); ctx.stroke();
    return wallTop;
  },
  door(x, y, w, h, col) {
    const ctx = this.ctx;
    ctx.fillStyle = '#3b2412'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x - 1, y - 2, w + 2, 2);
  },
  flag(x, y, col, h = 18) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    const w = Math.sin(G.time * 4 + x) * 2;
    this.poly([x, y - h, x + 11, y - h + 3 + w, x, y - h + 7], col);
  },
  crenel(x, y, w, col) {
    const ctx = this.ctx;
    ctx.fillStyle = col;
    for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y - 3, 4, 3);
  },
  drawBuildingArt(e, X, Y, S, col) {
    const ctx = this.ctx;
    const t = e.type;
    if (t === 'house') {
      const wt = this.gable(X + 6, Y + 6, S - 12, S - 10, '#d8c29a', '#9b4a2a', 10);
      this.door(X + S / 2 - 4, Y + S - 16, 8, 12, col);
      ctx.fillStyle = '#6fa8d6'; ctx.fillRect(X + 12, wt + 5, 6, 5); ctx.fillRect(X + S - 18, wt + 5, 6, 5);
    } else if (t === 'mill') {
      ctx.fillStyle = '#cbb792'; ctx.fillRect(X + 12, Y + 14, S - 24, S - 18);
      this.poly([X + 9, Y + 16, X + S - 9, Y + 16, X + S / 2, Y - 6], '#8a4b2a');
      this.door(X + S / 2 - 3, Y + S - 14, 7, 10, col);
      const a = (e.anim || 0) * 1.5, cx = X + S / 2, cy = Y + 10;
      for (let i = 0; i < 4; i++) {
        const an = a + i * Math.PI / 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(an);
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-1, 0, 2, 22);
        ctx.fillStyle = i % 2 ? '#f1ead8' : col; ctx.fillRect(1, 6, 6, 15);
        ctx.restore();
      }
      ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 7); ctx.fill();
    } else if (t === 'lumber_camp') {
      this.gable(X + 4, Y + 4, S - 20, S - 12, '#a47a4c', '#6e4a28', 6);
      ctx.fillStyle = '#8a5a2b';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) {
        ctx.beginPath(); ctx.arc(X + S - 14 + j * 5 + i * 2.5, Y + S - 8 - i * 5, 3, 0, 7); ctx.fill();
        ctx.fillStyle = '#d8b07a'; ctx.beginPath(); ctx.arc(X + S - 14 + j * 5 + i * 2.5, Y + S - 8 - i * 5, 1.3, 0, 7); ctx.fill(); ctx.fillStyle = '#8a5a2b';
      }
      this.flag(X + 6, Y + 8, col, 14);
    } else if (t === 'mining_camp') {
      this.gable(X + 4, Y + 4, S - 20, S - 12, '#9c9486', '#5f5a52', 6);
      ctx.fillStyle = '#5b3d1f'; ctx.fillRect(X + S - 18, Y + S - 16, 14, 8);
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(X + S - 14, Y + S - 17, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#aab3bb'; ctx.beginPath(); ctx.arc(X + S - 8, Y + S - 17, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(X + S - 16, Y + S - 7, 2.5, 0, 7); ctx.arc(X + S - 6, Y + S - 7, 2.5, 0, 7); ctx.fill();
      this.flag(X + 6, Y + 8, col, 14);
    } else if (t === 'barracks') {
      const wt = this.gable(X + 6, Y + 8, S - 12, S - 14, '#c9b089', '#7a2e22', 16);
      this.door(X + S / 2 - 7, Y + S - 22, 14, 16, col);
      ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X + 14, wt + 6); ctx.lineTo(X + 26, wt + 18); ctx.moveTo(X + 26, wt + 6); ctx.lineTo(X + 14, wt + 18); ctx.stroke();
      this.flag(X + S - 10, Y + 4, col, 22);
    } else if (t === 'archery_range') {
      ctx.fillStyle = '#b7a57f'; ctx.fillRect(X + 4, Y + 4, S - 8, S - 8);
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2; ctx.strokeRect(X + 4, Y + 4, S - 8, S - 8);
      this.gable(X + 6, Y + 6, S * 0.45, S * 0.5, '#c9b089', '#4f6b2a', 10);
      const tx = X + S * 0.72, ty = Y + S * 0.6;
      [['#fff', 11], ['#d33', 8], ['#fff', 5], ['#d33', 2.5]].forEach(([c, r]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(tx, ty, r, 0, 7); ctx.fill(); });
      ctx.strokeStyle = '#5b3d1f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx - 8, ty + 12); ctx.lineTo(tx, ty + 4); ctx.lineTo(tx + 8, ty + 12); ctx.stroke();
      this.flag(X + S - 10, Y + 10, col, 20);
    } else if (t === 'stable') {
      const wt = this.gable(X + 4, Y + 10, S - 8, S - 16, '#b38a5a', '#5e3b1c', 12);
      for (let i = 0; i < 3; i++) this.door(X + 12 + i * 26, Y + S - 20, 12, 14, col);
      ctx.fillStyle = '#e3c35a'; ctx.fillRect(X + S - 18, Y + S - 10, 12, 8);
      ctx.strokeStyle = '#b39530'; ctx.strokeRect(X + S - 18, Y + S - 10, 12, 8);
      this.flag(X + 8, Y + 6, col, 20);
    } else if (t === 'blacksmith') {
      const wt = this.gable(X + 6, Y + 8, S - 12, S - 14, '#6f6a64', '#3e3a36', 14);
      ctx.fillStyle = '#4a4540'; ctx.fillRect(X + S - 24, Y - 10, 10, 22);
      for (let i = 0; i < 3; i++) {
        const ph = ((e.anim || 0) * 0.6 + i / 3) % 1;
        ctx.fillStyle = `rgba(200,200,200,${0.5 * (1 - ph)})`;
        ctx.beginPath(); ctx.arc(X + S - 19 + ph * 8, Y - 14 - ph * 26, 4 + ph * 6, 0, 7); ctx.fill();
      }
      this.door(X + S / 2 - 7, Y + S - 22, 14, 16, col);
      ctx.fillStyle = '#ff8c2a'; ctx.fillRect(X + S / 2 - 5, Y + S - 14, 10, 4);
      ctx.fillStyle = '#333'; ctx.fillRect(X + 12, Y + S - 14, 12, 5); ctx.fillRect(X + 15, Y + S - 9, 6, 4);
    } else if (t === 'siege_workshop') {
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3;
      ctx.strokeRect(X + 8, Y + 8, S - 16, S - 16);
      this.gable(X + 6, Y + 4, S - 12, S * 0.55, '#a47a4c', '#5a4a3a', 12);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(X + 18, Y + S - 26, S - 36, 10);
      ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(X + 22, Y + S - 14, 6, 0, 7); ctx.arc(X + S - 22, Y + S - 14, 6, 0, 7); ctx.fill();
      this.flag(X + S - 8, Y + 6, col, 20);
    } else if (t === 'tower') {
      const lift = 34;
      ctx.fillStyle = '#8f8a82'; ctx.fillRect(X + 10, Y + 14 - lift, S - 20, S - 16 + lift);
      ctx.fillStyle = '#a7a299'; ctx.fillRect(X + 10, Y + 14 - lift, 6, S - 16 + lift);
      ctx.fillStyle = '#9d978d'; ctx.fillRect(X + 6, Y + 8 - lift, S - 12, 10);
      this.crenel(X + 6, Y + 8 - lift, S - 12, '#9d978d');
      ctx.fillStyle = '#222'; ctx.fillRect(X + S / 2 - 2, Y + 24 - lift, 4, 8);
      this.door(X + S / 2 - 5, Y + S - 14, 10, 12, col);
      this.flag(X + S / 2, Y + 5 - lift, col, 16);
    } else if (t === 'town_center') {
      // enceinte
      ctx.fillStyle = '#b9a47c'; ctx.fillRect(X + 6, Y + 18, S - 12, S - 22);
      ctx.fillStyle = shadeColor('#b9a47c', -30); ctx.fillRect(X + 6, Y + S - 6, S - 12, 3);
      // toit principal
      this.poly([X + 2, Y + 24, X + S - 2, Y + 24, X + S - 14, Y + 2, X + 14, Y + 2], '#8c4a2c');
      this.poly([X + 14, Y + 2, X + S - 14, Y + 2, X + S - 22, Y - 10, X + 22, Y - 10], '#a85a36');
      // donjon central
      ctx.fillStyle = '#cbb892'; ctx.fillRect(X + S / 2 - 14, Y - 20, 28, 34);
      this.poly([X + S / 2 - 18, Y - 18, X + S / 2 + 18, Y - 18, X + S / 2, Y - 44], col);
      this.poly([X + S / 2, Y - 44, X + S / 2 + 18, Y - 18, X + S / 2 + 6, Y - 18], shadeColor(col, -40));
      ctx.fillStyle = '#3b2412'; ctx.fillRect(X + S / 2 - 3, Y - 8, 6, 8);
      // tourelles
      for (const tx of [X + 4, X + S - 18]) {
        ctx.fillStyle = '#a79a80'; ctx.fillRect(tx, Y + 16, 14, S - 22);
        this.poly([tx - 2, Y + 18, tx + 16, Y + 18, tx + 7, Y + 2], shadeColor(col, -20));
      }
      this.door(X + S / 2 - 9, Y + S - 26, 18, 20, col);
      ctx.fillStyle = '#6fa8d6';
      for (const wx of [X + 30, X + S - 38]) ctx.fillRect(wx, Y + S - 34, 8, 8);
      this.flag(X + S / 2, Y - 44, col, 16);
    } else if (t === 'castle') {
      ctx.fillStyle = '#8e877b'; ctx.fillRect(X + 10, Y + 6, S - 20, S - 10);
      this.crenel(X + 10, Y + 6, S - 20, '#8e877b');
      ctx.fillStyle = '#a39c8f'; ctx.fillRect(X + S / 2 - 24, Y - 26, 48, 50);
      this.crenel(X + S / 2 - 24, Y - 26, 48, '#a39c8f');
      ctx.fillStyle = '#b3ad9f'; ctx.fillRect(X + S / 2 - 24, Y - 26, 8, 50);
      for (const [tx, ty] of [[X, Y - 4], [X + S - 24, Y - 4], [X, Y + S - 34], [X + S - 24, Y + S - 34]]) {
        ctx.fillStyle = '#9a9387'; ctx.fillRect(tx, ty, 24, 32);
        this.crenel(tx, ty, 24, '#9a9387');
        ctx.fillStyle = '#222'; ctx.fillRect(tx + 10, ty + 10, 4, 8);
      }
      this.door(X + S / 2 - 10, Y + S - 24, 20, 20, col);
      ctx.fillStyle = col; ctx.fillRect(X + S / 2 - 8, Y - 16, 16, 24);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px serif'; ctx.textAlign = 'center'; ctx.fillText('✠', X + S / 2, Y);
      this.flag(X + S / 2, Y - 26, col, 22);
    } else if (t === 'wonder') {
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const inset = i * 14, lift = i * 16;
        ctx.fillStyle = shadeColor('#d9b44a', -i * 6 + 10);
        ctx.fillRect(X + inset + 4, Y + inset + 4 - lift, S - 2 * inset - 8, S - 2 * inset - 8);
        ctx.fillStyle = shadeColor('#d9b44a', -50);
        ctx.fillRect(X + inset + 4, Y + S - inset - 8 - lift, S - 2 * inset - 8, 4);
      }
      ctx.fillStyle = '#fff6c0';
      const glow = 3 + Math.sin(G.time * 3) * 1.5;
      ctx.beginPath(); ctx.arc(X + S / 2, Y + S / 2 - 80, glow + 5, 0, 7); ctx.fill();
      this.flag(X + S / 2, Y + S / 2 - 80, col, 24);
    }
  },

  // ---------------- Unités ----------------
  drawSelRing(e) {
    const ctx = this.ctx;
    ctx.strokeStyle = e.owner === 1 ? '#7dff7d' : '#ff6060';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.radius * 0.45, e.radius + 4, (e.radius + 4) * 0.55, 0, 0, 7); ctx.stroke();
  },
  drawUnit(u) {
    const ctx = this.ctx;
    const col = u.player.color, r = u.radius;
    const bob = u.moving ? Math.abs(Math.sin(u.anim * 12)) * 1.6 : 0;
    const x = u.x, y = u.y - bob;
    const ca = Math.cos(u.angle), sa = Math.sin(u.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(u.x + 2, u.y + r * 0.5, r * 0.95, r * 0.45, 0, 0, 7); ctx.fill();

    if (u.cls === 'cavalry') {
      ctx.save(); ctx.translate(x, y + 2); ctx.rotate(u.angle);
      const horse = u.type === 'scout' ? '#b07a45' : u.type === 'paladin' ? '#e8e2d5' : '#5b3a22';
      ctx.fillStyle = horse;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.5, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 1.15, 0, r * 0.45, r * 0.28, 0, 0, 7); ctx.fill();
      ctx.fillStyle = shadeColor(horse, -40);
      const leg = Math.sin(u.anim * 14) * (u.moving ? 3 : 0);
      ctx.fillRect(r * 0.6 + leg, -r * 0.6, 2, r * 1.2); ctx.fillRect(-r * 0.7 - leg, -r * 0.6, 2, r * 1.2);
      if (u.type !== 'scout') { ctx.fillStyle = col; ctx.fillRect(-r * 0.5, -r * 0.55, r * 0.9, r * 1.1); }
      ctx.restore();
      // cavalier
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - 3, r * 0.45, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = u.type === 'scout' ? '#e0b48a' : '#b8bec6';
      ctx.beginPath(); ctx.arc(x, y - 3 - r * 0.45, r * 0.32, 0, 7); ctx.fill();
      // lance / épée
      const ext = u.attackAnim > 0 ? 5 : 0;
      ctx.strokeStyle = u.type === 'scout' ? '#ccc' : '#8a6a3a'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x + sa * 4, y - 3 - ca * 4);
      ctx.lineTo(x + sa * 4 + ca * (r * 1.6 + ext), y - 3 - ca * 4 + sa * (r * 1.6 + ext)); ctx.stroke();
      return;
    }
    if (u.cls === 'siege') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(u.angle);
      if (u.type === 'ram') {
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
        ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-r + 2, -r * 0.7 + 2, r * 2 - 4, r * 1.4 - 4);
        ctx.strokeStyle = '#4a3218'; ctx.lineWidth = 1;
        for (let i = -r + 5; i < r; i += 5) { ctx.beginPath(); ctx.moveTo(i, -r * 0.7); ctx.lineTo(i, r * 0.7); ctx.stroke(); }
        const ext = u.attackAnim > 0 ? 4 : 0;
        ctx.fillStyle = '#555'; ctx.fillRect(r - 2 + ext, -3, 6, 6);
        ctx.fillStyle = col; ctx.fillRect(-r, -r * 0.7, 4, r * 1.4);
      } else {
        ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-r * 0.9, -r * 0.6, r * 1.8, r * 1.2);
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath(); ctx.arc(-r * 0.6, -r * 0.7, 3, 0, 7); ctx.arc(r * 0.6, -r * 0.7, 3, 0, 7); ctx.arc(-r * 0.6, r * 0.7, 3, 0, 7); ctx.arc(r * 0.6, r * 0.7, 3, 0, 7); ctx.fill();
        const arm = u.attackAnim > 0 ? 0.9 : -0.6;
        ctx.save(); ctx.rotate(arm);
        ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-r * 0.8, -1.5, r * 1.3, 3);
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(-r * 0.8, 0, 3.5, 0, 7); ctx.fill();
        ctx.restore();
        ctx.fillStyle = col; ctx.fillRect(r * 0.5, -r * 0.6, 4, r * 1.2);
      }
      ctx.restore();
      return;
    }
    // Fantassin / villageois
    const bodyCol = u.cls === 'villager' ? '#8f6b45' : col;
    // arme derrière si orienté vers le haut
    const drawWeapon = () => this.drawWeapon(u, x, y, ca, sa, col);
    if (sa < 0) drawWeapon();
    ctx.fillStyle = bodyCol;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.8, r * 0.7, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    if (u.cls === 'villager') { ctx.fillStyle = col; ctx.fillRect(x - r * 0.8, y - 1, r * 1.6, 3); }
    // tête
    const helm = { militia: '#8d9299', spearman: '#8d9299', swordsman: '#c3c8cf', archer: '#6a8a3a', skirmisher: '#7a5a3a', crossbowman: '#8d9299' }[u.type];
    ctx.fillStyle = '#e8b98f';
    ctx.beginPath(); ctx.arc(x + ca * 1.5, y - r * 0.55 + sa * 1.5, r * 0.45, 0, 7); ctx.fill();
    if (helm) { ctx.fillStyle = helm; ctx.beginPath(); ctx.arc(x + ca * 1.5, y - r * 0.62 + sa * 1.5, r * 0.45, Math.PI, 0); ctx.fill(); }
    else if (u.cls === 'villager') { ctx.fillStyle = '#d9c27a'; ctx.beginPath(); ctx.ellipse(x + ca * 1.5, y - r * 0.75 + sa * 1.5, r * 0.6, r * 0.25, 0, 0, 7); ctx.fill(); }
    if (sa >= 0) drawWeapon();
    // charge transportée
    if (u.carry > 0) {
      ctx.fillStyle = RES_COLOR[u.carryType];
      ctx.fillRect(x - ca * r * 0.8 - 3, y - sa * r * 0.6 - 4, 6, 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeRect(x - ca * r * 0.8 - 3, y - sa * r * 0.6 - 4, 6, 5);
    }
  },
  drawWeapon(u, x, y, ca, sa, col) {
    const ctx = this.ctx, r = u.radius;
    const hx = x + ca * r * 0.7, hy = y + sa * r * 0.5 - 1;
    const swing = u.attackAnim > 0 ? Math.sin(u.attackAnim * 20) * 0.8 : 0;
    const work = u.working > 0 ? Math.sin(u.anim * 14) * 0.9 : 0;
    ctx.lineCap = 'round';
    switch (u.type) {
      case 'villager': {
        const a = u.angle - 0.6 + work + swing;
        ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 8, hy + Math.sin(a) * 8); ctx.stroke();
        ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 7, hy + Math.sin(a) * 7); ctx.lineTo(hx + Math.cos(a + 0.5) * 9, hy + Math.sin(a + 0.5) * 9); ctx.stroke();
        break;
      }
      case 'militia': case 'swordsman': {
        const a = u.angle - 0.4 + swing * 1.5;
        ctx.strokeStyle = '#dfe3e8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 11, hy + Math.sin(a) * 11); ctx.stroke();
        if (u.type === 'swordsman') {
          const sx = x + Math.cos(u.angle + 1.4) * r * 0.8, sy = y + Math.sin(u.angle + 1.4) * r * 0.6;
          ctx.fillStyle = '#9aa0a8'; ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, 7); ctx.fill();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7); ctx.fill();
        }
        break;
      }
      case 'spearman': {
        const ext = u.attackAnim > 0 ? 4 : 0;
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(hx - ca * 8, hy - sa * 8); ctx.lineTo(hx + ca * (14 + ext), hy + sa * (14 + ext)); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(hx + ca * (15 + ext), hy + sa * (15 + ext), 2, 0, 7); ctx.fill();
        break;
      }
      case 'archer': case 'crossbowman': case 'skirmisher': {
        if (u.type === 'skirmisher') {
          ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(hx - ca * 5, hy - sa * 5); ctx.lineTo(hx + ca * 10, hy + sa * 10); ctx.stroke();
        } else if (u.type === 'crossbowman') {
          ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + ca * 9, hy + sa * 9); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(hx + ca * 7 - sa * 5, hy + sa * 7 + ca * 5); ctx.lineTo(hx + ca * 7 + sa * 5, hy + sa * 7 - ca * 5); ctx.stroke();
        } else {
          ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(hx, hy, 7, u.angle - 1.2, u.angle + 1.2); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.7;
          const pull = u.attackAnim > 0 ? 0 : 3;
          ctx.beginPath(); ctx.moveTo(hx + Math.cos(u.angle - 1.2) * 7, hy + Math.sin(u.angle - 1.2) * 7);
          ctx.lineTo(hx - ca * pull, hy - sa * pull);
          ctx.lineTo(hx + Math.cos(u.angle + 1.2) * 7, hy + Math.sin(u.angle + 1.2) * 7); ctx.stroke();
        }
        break;
      }
    }
    ctx.lineCap = 'butt';
  },

  drawHpBar(e, small) {
    if (e.kind === 'resource') return;
    const ctx = this.ctx;
    let w, x, y;
    if (e.kind === 'unit') { w = 22; x = e.x - w / 2; y = e.y - e.radius - 12; }
    else { w = Math.min(80, e.size * TILE * 0.7); x = e.x - w / 2; y = e.ty * TILE - (e.walkable ? 8 : 18) - (['tower', 'town_center', 'castle'].includes(e.type) ? 28 : 0); }
    const k = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = k > 0.6 ? '#3ddc4a' : k > 0.3 ? '#f0c030' : '#e53d2e';
    if (e.owner === 2 && !small) ctx.fillStyle = '#e53d2e';
    ctx.fillRect(x, y, w * k, 3);
  },
  drawProgress(e) {
    const ctx = this.ctx;
    const w = Math.min(70, e.size * TILE * 0.7), x = e.x - w / 2, y = e.y + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = '#5ab0ff'; ctx.fillRect(x, y, w * e.progress, 4);
  },
  drawSelRect(e) {
    const ctx = this.ctx;
    const x0 = e.tx * TILE, y0 = e.ty * TILE, s = e.size * TILE;
    ctx.strokeStyle = e.owner === 1 ? '#7dff7d' : e.owner === 0 ? '#ffe070' : '#ff6060';
    ctx.lineWidth = 2;
    const L = Math.min(12, s / 3);
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[x0, y0, 1, 1], [x0 + s, y0, -1, 1], [x0, y0 + s, 1, -1], [x0 + s, y0 + s, -1, -1]]) {
      ctx.moveTo(cx + dx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * L);
    }
    ctx.stroke();
  },
  drawRally(r) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y - 22); ctx.stroke();
    const w = Math.sin(G.time * 5) * 2;
    this.poly([r.x, r.y - 22, r.x + 14, r.y - 18 + w, r.x, r.y - 13], G.players[1].color);
  },
  drawOrderMarker(f) {
    const ctx = this.ctx;
    const k = f.t / 0.6;
    ctx.strokeStyle = f.color || '#7dff7d'; ctx.lineWidth = 2;
    ctx.globalAlpha = k;
    ctx.beginPath(); ctx.ellipse(f.x, f.y, 12 * (1.4 - k * 0.6), 6 * (1.4 - k * 0.6), 0, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
  },
  drawDecal(d) {
    const ctx = this.ctx;
    const a = Math.min(1, d.t / 5);
    ctx.globalAlpha = a;
    if (d.type === 'stump') {
      ctx.fillStyle = '#5a3a1e'; ctx.beginPath(); ctx.ellipse(d.x, d.y + 3, 4, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#b08a5a'; ctx.beginPath(); ctx.ellipse(d.x, d.y + 2, 3, 2, 0, 0, 7); ctx.fill();
    } else if (d.type === 'rubble') {
      const s = d.size * TILE;
      ctx.fillStyle = 'rgba(60,50,40,0.7)';
      ctx.fillRect(d.x - s / 2 + 3, d.y - s / 2 + 3, s - 6, s - 6);
      ctx.fillStyle = '#6d6356';
      for (let i = 0; i < d.size * 5; i++) {
        const ox = ((i * 37) % 100) / 100 * s - s / 2, oy = ((i * 61) % 100) / 100 * s - s / 2;
        ctx.fillRect(d.x + ox, d.y + oy, 5, 4);
      }
    } else if (d.type === 'corpse') {
      ctx.fillStyle = 'rgba(110,20,20,0.5)'; ctx.beginPath(); ctx.ellipse(d.x, d.y + 3, 8, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = PLAYER_COLORS[d.owner]; ctx.beginPath(); ctx.ellipse(d.x, d.y, 6, 3, 0.3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  drawProjectile(p) {
    if (!isVisibleTile(p.x, p.y)) return;
    const ctx = this.ctx;
    const y = p.y - p.h;
    if (p.type === 'rock') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#6d6356'; ctx.beginPath(); ctx.arc(p.x, y, 4.5, 0, 7); ctx.fill();
    } else {
      const a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x - Math.cos(a) * 7, y - Math.sin(a) * 7); ctx.lineTo(p.x + Math.cos(a) * 3, y + Math.sin(a) * 3); ctx.stroke();
      ctx.fillStyle = '#ddd'; ctx.fillRect(p.x + Math.cos(a) * 3 - 1, y + Math.sin(a) * 3 - 1, 2, 2);
    }
  },
  drawEffect(f) {
    const ctx = this.ctx;
    if (f.type === 'text') {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(f.text, f.x + 1, f.y - (1.2 - f.t) * 20 + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - (1.2 - f.t) * 20);
      ctx.globalAlpha = 1;
    } else if (f.type === 'smoke' || f.type === 'dust') {
      if (!isVisibleTile(f.x, f.y)) return;
      const max = f.type === 'smoke' ? 1.2 : 0.6, k = 1 - f.t / max;
      const R = (f.size || 1) * 14 * (0.5 + k);
      ctx.fillStyle = `rgba(120,110,100,${0.6 * (1 - k)})`;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * R * 0.6, f.y + Math.sin(a) * R * 0.4 - k * 20, R * 0.5, 0, 7); ctx.fill();
      }
    } else if (f.type === 'ping') {
      const k = (f.t % 1);
      ctx.strokeStyle = `rgba(255,60,60,${k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 40 * (1 - k) + 10, 0, 7); ctx.stroke();
    }
  },
  drawGhost() {
    const ctx = this.ctx;
    const type = Input.placing, d = BUILDING_DEFS[type];
    const w = this.screenToWorld(Input.mx, Input.my);
    const tx = Math.round(w.x / TILE - d.size / 2), ty = Math.round(w.y / TILE - d.size / 2);
    const ok = canPlace(type, tx, ty, 1);
    ctx.globalAlpha = 0.55;
    const fake = { type, tx, ty, size: d.size, player: G.players[1], anim: 0, def: d, walkable: d.walkable, amount: 1, maxAmount: 1, complete: true };
    if (d.walkable) this.drawFarm(fake);
    else this.drawBuildingArt(fake, tx * TILE, ty * TILE, d.size * TILE, G.players[1].color);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ok ? 'rgba(80,255,80,0.25)' : 'rgba(255,60,60,0.35)';
    ctx.fillRect(tx * TILE, ty * TILE, d.size * TILE, d.size * TILE);
    ctx.strokeStyle = ok ? '#6f6' : '#f55'; ctx.lineWidth = 2;
    ctx.strokeRect(tx * TILE, ty * TILE, d.size * TILE, d.size * TILE);
    if (d.range) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc((tx + d.size / 2) * TILE, (ty + d.size / 2) * TILE, (d.range + d.size / 2) * TILE, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  // ---------------- Mini-carte ----------------
  drawMinimap() {
    const m = this.mctx, W = this.mini.width, H = this.mini.height;
    const sx = W / (MAP_W * TILE), sy = H / (MAP_H * TILE);
    m.imageSmoothingEnabled = false;
    m.drawImage(World.miniBase, 0, 0, W, H);
    const tw = W / MAP_W, th = H / MAP_H;
    for (const e of G.entities) {
      if (!e.alive) continue;
      if (e.kind === 'resource') {
        if (!Fog.explored[e.ty * MAP_W + e.tx]) continue;
        m.fillStyle = e.type === 'tree' ? '#1d4a1d' : RES_COLOR[e.resType];
        m.fillRect(e.tx * tw, e.ty * th, Math.ceil(tw), Math.ceil(th));
      } else if (e.kind === 'building') {
        if (e.owner !== 1 && !isExploredEntity(e)) continue;
        m.fillStyle = e.player.color;
        m.fillRect(e.tx * tw, e.ty * th, e.size * tw, e.size * th);
        m.strokeStyle = 'rgba(0,0,0,0.6)'; m.lineWidth = 1;
        m.strokeRect(e.tx * tw + 0.5, e.ty * th + 0.5, e.size * tw - 1, e.size * th - 1);
      }
    }
    for (const e of G.entities) {
      if (!e.alive || e.kind !== 'unit') continue;
      if (e.owner !== 1 && !isVisibleTile(e.x, e.y)) continue;
      m.fillStyle = G.selection.includes(e) ? '#fff' : e.player.color;
      m.fillRect(e.x * sx - 1.5, e.y * sy - 1.5, 3, 3);
    }
    m.imageSmoothingEnabled = true;
    m.drawImage(Fog.canvas, 0, 0, W, H);
    for (const f of G.effects) if (f.type === 'ping') {
      const k = f.t % 1;
      m.strokeStyle = `rgba(255,60,60,${k})`; m.lineWidth = 2;
      m.beginPath(); m.arc(f.x * sx, f.y * sy, 14 * (1 - k) + 3, 0, 7); m.stroke();
    }
    m.strokeStyle = '#fff'; m.lineWidth = 1;
    m.strokeRect(this.cam.x * sx, this.cam.y * sy, this.viewW * sx, (this.canvas.height - UI.panelHeight()) / this.cam.zoom * sy);
  },
};
