// ============================================================
//  Recherche de chemin A* (8 directions, sans couper les coins)
// ============================================================
const PF = (() => {
  const N = MAP_W * MAP_H;
  const g = new Float32Array(N);
  const parent = new Int32Array(N);
  const stamp = new Uint32Array(N);
  const closed = new Uint32Array(N);
  let gen = 0;
  // tas binaire
  let heap = [], heapF = [];
  function push(i, f) {
    heap.push(i); heapF.push(f);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= heapF[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      [heapF[p], heapF[k]] = [heapF[k], heapF[p]];
      k = p;
    }
  }
  function pop() {
    const top = heap[0];
    const li = heap.pop(), lf = heapF.pop();
    if (heap.length) {
      heap[0] = li; heapF[0] = lf;
      let k = 0;
      const n = heap.length;
      while (true) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < n && heapF[l] < heapF[m]) m = l;
        if (r < n && heapF[r] < heapF[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [heapF[m], heapF[k]] = [heapF[k], heapF[m]];
        k = m;
      }
    }
    return top;
  }
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  function find(sx, sy, isGoal, hx, hy, maxNodes = 5000) {
    gen++;
    heap = []; heapF = [];
    const start = sy * MAP_W + sx;
    const h = (x, y) => { const dx = Math.abs(x - hx), dy = Math.abs(y - hy); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
    g[start] = 0; parent[start] = -1; stamp[start] = gen;
    push(start, h(sx, sy));
    let best = start, bestH = h(sx, sy), expanded = 0, found = -1;
    while (heap.length) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
      if (isGoal(cx, cy)) { found = cur; break; }
      const hh = h(cx, cy);
      if (hh < bestH) { bestH = hh; best = cur; }
      if (++expanded > maxNodes) break;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0], dy = DIRS[d][1];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (World.block[ni] !== 0) continue;
        if (dx && dy && (World.block[cy * MAP_W + nx] !== 0 || World.block[ny * MAP_W + cx] !== 0)) continue;
        if (closed[ni] === gen) continue;
        const ng = g[cur] + DIRS[d][2];
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen; g[ni] = ng; parent[ni] = cur;
          push(ni, ng + h(nx, ny) * 1.02);
        }
      }
    }
    const end = found >= 0 ? found : best;
    const path = [];
    let c = end;
    while (c !== -1 && c !== start) { path.push({ x: c % MAP_W, y: (c / MAP_W) | 0 }); c = parent[c]; }
    path.reverse();
    return { path, reached: found >= 0 };
  }

  // Case libre la plus proche
  function nearestFree(tx, ty, maxR = 12) {
    if (isFree(tx, ty)) return { x: tx, y: ty };
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (isFree(x, y)) { const d = Math.hypot(x - tx, y - ty); if (d < bd) { bd = d; best = { x, y }; } }
      }
      if (best) return best;
    }
    return null;
  }

  // Ligne de vue pour lisser le chemin
  function los(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (!walkablePx(x - 5, y - 5) || !walkablePx(x + 5, y - 5) || !walkablePx(x - 5, y + 5) || !walkablePx(x + 5, y + 5)) return false;
    }
    return true;
  }

  return { find, nearestFree, los };
})();
