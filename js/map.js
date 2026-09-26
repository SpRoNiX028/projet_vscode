// ============================================================
//  Carte : génération du terrain et grille de collision
// ============================================================
const World = {
  terrain: new Uint8Array(MAP_W * MAP_H),   // 0 herbe, 1 eau, 2 sable
  block: new Int32Array(MAP_W * MAP_H),     // 0 libre, -1 eau, >0 id d'entité
  shade: new Float32Array(MAP_W * MAP_H),
  terrainCanvas: null,
  miniBase: null,
};

function inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H; }
function isFree(tx, ty) { return inBounds(tx, ty) && World.block[ty * MAP_W + tx] === 0; }
function walkablePx(x, y) { return isFree(Math.floor(x / TILE), Math.floor(y / TILE)); }

// Emplacement des bases (coin supérieur gauche de l'hôtel de ville)
const BASES = {
  1: { tx: 10, ty: 10 },
  2: { tx: MAP_W - 14, ty: MAP_H - 14 },
};

// Plan de carte : 0 herbe, 1 eau, 2 arbre, 3 or, 4 pierre, 5 baies
function generatePlan(seed) {
  const rng = mulberry32(seed);
  const W = MAP_W, H = MAP_H;
  const plan = new Uint8Array(W * H);
  const noise = makeNoise(rng, W, H, 7);
  const noise2 = makeNoise(rng, W, H, 3);
  const bc = { x: BASES[1].tx + 2, y: BASES[1].ty + 2 };  // centre base 1
  const bc2 = { x: W - 1 - bc.x, y: H - 1 - bc.y };
  const dBase = (x, y) => Math.min(Math.hypot(x - bc.x, y - bc.y), Math.hypot(x - bc2.x, y - bc2.y));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) plan[y * W + x] = v; };
  const get = (x, y) => plan[y * W + x];

  // Forêts par bruit
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = noise(x, y) * 0.75 + noise2(x, y) * 0.25;
    const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (edge < 2 && rng() < 0.8) { plan[y * W + x] = 2; continue; }
    if (n > 0.66 && dBase(x, y) > 13) plan[y * W + x] = 2;
  }
  // Lacs
  const lakes = 3;
  for (let l = 0; l < lakes; l++) {
    let cx, cy, tries = 0;
    do { cx = randRange(rng, 15, W - 15); cy = randRange(rng, 15, H - 15); tries++; }
    while ((dBase(cx, cy) < 24 || cx + cy > W - 1) && tries < 100);
    const blobs = 4 + Math.floor(rng() * 4);
    for (let b = 0; b < blobs; b++) {
      const r = 2 + rng() * 2.5;
      const ox = cx + (rng() - 0.5) * 8, oy = cy + (rng() - 0.5) * 8;
      for (let y = Math.floor(oy - r); y <= oy + r; y++) for (let x = Math.floor(ox - r); x <= ox + r; x++) {
        if (Math.hypot(x - ox, y - oy) <= r && dBase(x, y) > 16) set(x, y, 1);
      }
    }
  }
  // Nettoyage autour de la base
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (Math.hypot(x - bc.x, y - bc.y) < 11) plan[y * W + x] = 0;
  }
  // Ressources de la base
  const angle0 = rng() * Math.PI * 2;
  const placeClump = (ang, d, count, type) => {
    let cx = Math.round(bc.x + Math.cos(ang) * d), cy = Math.round(bc.y + Math.sin(ang) * d);
    const cells = [[cx, cy]];
    set(cx, cy, type);
    let guard = 0;
    while (cells.length < count && guard++ < 200) {
      const [px, py] = cells[Math.floor(rng() * cells.length)];
      const nx = px + Math.floor(rng() * 3) - 1, ny = py + Math.floor(rng() * 3) - 1;
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      if (get(nx, ny) === type) continue;
      if (Math.abs(nx - bc.x) <= 3 && Math.abs(ny - bc.y) <= 3) continue;
      set(nx, ny, type); cells.push([nx, ny]);
    }
  };
  placeClump(angle0, 7, 7, 3);                     // or
  placeClump(angle0 + 1.6, 7.5, 5, 4);             // pierre
  placeClump(angle0 + 3.3, 6, 6, 5);               // baies
  placeClump(angle0 + 4.4, 12, 7, 3);              // or secondaire
  // Forêts proches
  const forestAt = (ang, d, r) => {
    const fx = bc.x + Math.cos(ang) * d, fy = bc.y + Math.sin(ang) * d;
    for (let y = Math.floor(fy - r); y <= fy + r; y++) for (let x = Math.floor(fx - r); x <= fx + r; x++) {
      if (Math.hypot(x - fx, y - fy) <= r - rng() * 0.8 && x > 0 && y > 0 && x < W && y < H && get(x, y) === 0) set(x, y, 2);
    }
  };
  forestAt(angle0 + 2.4, 10, 3.2);
  forestAt(angle0 + 5.3, 11, 3.6);
  // Ressources au milieu de la carte
  for (let i = 0; i < 4; i++) {
    let x, y, tries = 0;
    do { x = randRange(rng, 8, W - 8); y = randRange(rng, 8, H - 8); tries++; }
    while ((dBase(x, y) < 20 || x + y > W - 4 || get(x, y) !== 0) && tries < 200);
    const type = i % 2 === 0 ? 3 : 4;
    const cnt = 5 + Math.floor(rng() * 3);
    // clump autour de x,y
    let cells = [[x, y]]; set(x, y, type);
    let guard = 0;
    while (cells.length < cnt && guard++ < 100) {
      const [px, py] = cells[Math.floor(rng() * cells.length)];
      const nx = px + Math.floor(rng() * 3) - 1, ny = py + Math.floor(rng() * 3) - 1;
      if (get(nx, ny) === 0) { set(nx, ny, type); cells.push([nx, ny]); }
    }
  }
  // Baies supplémentaires
  for (let i = 0; i < 2; i++) {
    let x, y, tries = 0;
    do { x = randRange(rng, 8, W - 8); y = randRange(rng, 8, H - 8); tries++; }
    while ((dBase(x, y) < 18 || x + y > W - 4 || get(x, y) !== 0) && tries < 200);
    for (let k = 0; k < 5; k++) { const nx = x + (k % 3), ny = y + Math.floor(k / 3); if (get(nx, ny) === 0) set(nx, ny, 5); }
  }

  // Symétrie centrale (équité)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const mx = W - 1 - x, my = H - 1 - y;
    if (x + y > W - 1 || (x + y === W - 1 && x > mx)) plan[y * W + x] = plan[my * W + mx];
  }
  return plan;
}
function randRange(rng, a, b) { return Math.floor(a + rng() * (b - a)); }

// Vérifie que les deux bases sont reliées
function planConnected(plan) {
  const W = MAP_W, H = MAP_H;
  const seen = new Uint8Array(W * H);
  const sx = BASES[1].tx + 5, sy = BASES[1].ty + 5;
  const gx = BASES[2].tx - 1, gy = BASES[2].ty - 1;
  const q = [sy * W + sx]; seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % W, y = (i / W) | 0;
    if (x === gx && y === gy) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || plan[j] !== 0) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return false;
}

// Construit la carte finale et crée les ressources
function buildWorld(seed) {
  let plan, s = seed;
  for (let t = 0; t < 20; t++) {
    plan = generatePlan(s);
    if (planConnected(plan)) break;
    s += 101;
  }
  World.block.fill(0);
  World.terrain.fill(0);
  const rng = mulberry32(s + 7);
  const shadeNoise = makeNoise(rng, MAP_W, MAP_H, 5);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x;
    World.shade[i] = shadeNoise(x, y);
    const v = plan[i];
    if (v === 1) { World.terrain[i] = 1; World.block[i] = -1; }
    else if (v === 2) createResource('tree', x, y);
    else if (v === 3) createResource('gold', x, y);
    else if (v === 4) createResource('stone', x, y);
    else if (v === 5) createResource('berry', x, y);
  }
  // Sable autour de l'eau
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x;
    if (World.terrain[i] !== 0) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && World.terrain[ny * MAP_W + nx] === 1) World.terrain[i] = 2;
    }
  }
  renderTerrainCanvas(rng);
}

function renderTerrainCanvas(rng) {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE; c.height = MAP_H * TILE;
  const g = c.getContext('2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x, t = World.terrain[i], s = World.shade[i];
    let col;
    if (t === 0) col = `hsl(${88 + s * 18}, ${42 + s * 12}%, ${30 + s * 10}%)`;
    else if (t === 1) col = `hsl(205, 60%, ${30 + s * 8}%)`;
    else col = `hsl(45, 45%, ${58 + s * 8}%)`;
    g.fillStyle = col;
    g.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
  // Détails : touffes d'herbe, fleurs, vagues
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = World.terrain[y * MAP_W + x];
    const px = x * TILE, py = y * TILE;
    if (t === 0) {
      for (let k = 0; k < 4; k++) {
        const gx = px + rng() * TILE, gy = py + rng() * TILE;
        g.strokeStyle = rng() < 0.5 ? 'rgba(20,60,10,0.35)' : 'rgba(170,210,90,0.25)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + rng() * 3 - 1.5, gy - 3 - rng() * 3); g.stroke();
      }
      if (rng() < 0.03) {
        g.fillStyle = pick(['#f4e04d', '#ffffff', '#e87ad8', '#ff8a5c']);
        g.beginPath(); g.arc(px + rng() * TILE, py + rng() * TILE, 1.6, 0, 7); g.fill();
      }
    } else if (t === 1) {
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1.5;
      if (rng() < 0.35) {
        const wx = px + rng() * 20, wy = py + rng() * TILE;
        g.beginPath(); g.moveTo(wx, wy); g.quadraticCurveTo(wx + 5, wy - 3, wx + 10, wy); g.stroke();
      }
    } else {
      g.fillStyle = 'rgba(120,90,40,0.2)';
      for (let k = 0; k < 3; k++) g.fillRect(px + rng() * TILE, py + rng() * TILE, 1.5, 1.5);
    }
  }
  // Adoucissement des bords d'eau
  g.globalAlpha = 0.25;
  g.filter = 'blur(6px)';
  g.drawImage(c, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  World.terrainCanvas = c;

  // Mini carte (fond)
  const m = document.createElement('canvas');
  m.width = MAP_W; m.height = MAP_H;
  const mg = m.getContext('2d');
  const img = mg.createImageData(MAP_W, MAP_H);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const t = World.terrain[i];
    const c3 = t === 0 ? [70, 120, 45] : t === 1 ? [40, 90, 150] : [190, 170, 110];
    img.data[i * 4] = c3[0]; img.data[i * 4 + 1] = c3[1]; img.data[i * 4 + 2] = c3[2]; img.data[i * 4 + 3] = 255;
  }
  mg.putImageData(img, 0, 0);
  World.miniBase = m;
}
