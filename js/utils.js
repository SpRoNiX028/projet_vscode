// ============================================================
//  Utilitaires
// ============================================================
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Bruit de valeur simple (pour les forêts / nuances de terrain)
function makeNoise(rng, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1];
    const c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
}

function canAfford(p, cost) {
  for (const k in cost) if (p.res[k] < cost[k]) return false;
  return true;
}
function pay(p, cost) { for (const k in cost) p.res[k] -= cost[k]; }
function refund(p, cost, frac = 1) { for (const k in cost) p.res[k] += Math.floor(cost[k] * frac); }
function missingRes(p, cost) {
  for (const k in cost) if (p.res[k] < cost[k]) return k;
  return null;
}
function costHtml(cost) {
  return Object.keys(cost).map(k => `<span class="cost">${RES_ICON[k]} ${cost[k]}</span>`).join(' ');
}

function shadeColor(hex, amt) {
  let c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) + amt, g = ((c >> 8) & 255) + amt, b = (c & 255) + amt;
  r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function formatTime(s) {
  s = Math.floor(s);
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}
