/* =========================================================================
   RENDER — draws the whole world onto one big canvas, hand-drawn style.
   Everything is procedural: parchment, fractal coastlines, mountains,
   hills, forests, settlements.  Seeded, so the map is identical each load.
   ========================================================================= */

const RENDER_SCALE = 1;

// Deterministic RNG so the map looks identical every load
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INK = "rgba(43, 27, 12,";       // sepia ink
const PALE = "rgba(228, 202, 152,";   // pale ink for dark water

/* ---------- 1D value noise, for fractal coastlines ---------- */

function hash1(i, seed) {
  let h = Math.imul((i | 0) ^ seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smoothstep = t => t * t * (3 - 2 * t);

function valueNoise(x, seed, period) {
  const i = Math.floor(x), f = x - i;
  const wrap = n => (period ? ((n % period) + period) % period : n);
  const a = hash1(wrap(i), seed), b = hash1(wrap(i + 1), seed);
  return a + (b - a) * smoothstep(f);
}

function fbm(x, seed, period) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += (valueNoise(x * freq, seed + o * 1013, period * freq) - 0.5) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/* ---------- path helpers ---------- */

function smoothPath(pts, closed) {
  const p = new Path2D();
  appendSmooth(p, pts, true, closed);
  if (closed) p.closePath();
  return p;
}

function appendSmooth(p, pts, move, closed) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (pts.length < 3) {
    if (move) p.moveTo(pts[0][0], pts[0][1]); else p.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  if (closed) {
    const m = mid(pts[pts.length - 1], pts[0]);
    if (move) p.moveTo(m[0], m[1]); else p.lineTo(m[0], m[1]);
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length];
      const m2 = mid(pts[i], next);
      p.quadraticCurveTo(pts[i][0], pts[i][1], m2[0], m2[1]);
    }
  } else {
    if (move) p.moveTo(pts[0][0], pts[0][1]); else p.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const m2 = mid(pts[i], pts[i + 1]);
      p.quadraticCurveTo(pts[i][0], pts[i][1], m2[0], m2[1]);
    }
    p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  }
}

// Catmull-Rom resample of a polyline into many small steps
function resample(pts, res) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
          p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < res; s++) {
      const t = s / res, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/* Push a polyline's points sideways by fractal noise: a handful of authored
   points becomes a shoreline full of headlands, coves and inlets.
   Open lines are tapered at both ends so they stay pinned in place.   */
function crinkle(pts, amp, seed, closed, wavelength = 260) {
  const src = closed ? pts.concat([pts[0]]) : pts;
  const fine = resample(src, 26);
  const n = fine.length;
  const s = [0];
  let L = 0;
  for (let i = 1; i < n; i++) {
    L += Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1]);
    s.push(L);
  }
  const period = closed ? Math.max(4, Math.round(L / wavelength)) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = fine[Math.max(0, i - 1)], next = fine[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0], ty = next[1] - prev[1];
    const m = Math.hypot(tx, ty) || 1;
    tx /= m; ty /= m;
    const t = closed ? (s[i] / L) * period : s[i] / wavelength;
    let d = fbm(t, seed, period) * amp;
    if (!closed) d *= Math.sin(Math.PI * (s[i] / L));
    out.push([fine[i][0] - ty * d, fine[i][1] + tx * d]);
  }
  if (closed) out.pop();
  return out;
}

function wobbleRing(cx, cy, rx, ry, seed, n = 30, wob = 0.14) {
  const rng = mulberry32(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const kx = 1 + (rng() - 0.5) * wob * 2;
    const ky = 1 + (rng() - 0.5) * wob * 2;
    pts.push([cx + Math.cos(a) * rx * kx, cy + Math.sin(a) * ry * ky]);
  }
  return pts;
}

/* Returns the sea outline plus its bounding box, so the big fills inside the
   clip region only touch the pixels the sea actually covers. */
function seaShape(sea) {
  const coast = crinkle(sea.coast, sea.amp, sea.seed, false);
  const p = new Path2D();
  appendSmooth(p, coast, true, false);
  for (const q of sea.close) p.lineTo(q[0], q[1]);
  p.closePath();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of coast.concat(sea.close)) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { path: p, box: [x0, y0, x1 - x0, y1 - y0] };
}

/* ---------- water mask, so nothing procedural lands in the sea ---------- */

function buildWaterMask(paths, W, H, cell) {
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const off = document.createElement("canvas");
  off.width = cols; off.height = rows;
  const oc = off.getContext("2d", { willReadFrequently: true });
  oc.scale(cols / W, rows / H);
  oc.fillStyle = "#fff";
  for (const p of paths) oc.fill(p);
  const d = oc.getImageData(0, 0, cols, rows).data;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) mask[i] = d[i * 4 + 3] > 60 ? 1 : 0;
  return { mask, cols, rows, cellW: W / cols, cellH: H / rows };
}

function isWater(m, x, y) {
  const i = Math.floor(x / m.cellW), j = Math.floor(y / m.cellH);
  if (i < 0 || j < 0 || i >= m.cols || j >= m.rows) return true; // off-map
  return m.mask[j * m.cols + i] === 1;
}

// true if the point or anything within `r` of it is water
function nearWater(m, x, y, r) {
  return isWater(m, x, y) || isWater(m, x + r, y) || isWater(m, x - r, y) ||
         isWater(m, x, y + r) || isWater(m, x, y - r);
}

/* ---------- terrain pieces ---------- */

// Walk a polyline by parameter, so the snowline and hatching can follow
// whatever jagged silhouette a given peak happened to be dealt.
function samplePoly(pts, t) {
  const f = Math.max(0, Math.min(1, t)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const u = f - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
          pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
}

/* A ridge from `from` to `to` broken into `n` faceted steps, each kicked
   sideways so the outline comes out craggy rather than as a clean cone.
   `side` is +1/-1 for which way the crags bulge; `shoulder` optionally
   lifts one step into a secondary summit. */
function craggyEdge(from, to, n, amp, side, rng, shoulder) {
  const pts = [from];
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * side, ny = (dx / l) * side;
  const at = shoulder ? 1 + Math.floor(rng() * (n - 1)) : -1;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    let x = from[0] + dx * t, y = from[1] + dy * t;
    const k = (0.12 + rng() * 0.85) * amp;
    x += nx * k; y += ny * k;
    if (i === at) y -= l * (0.1 + rng() * 0.16);   // secondary summit
    pts.push([x, y]);
  }
  pts.push(to);
  return pts;
}

/* One mountain. Light falls from the upper left, so the western flank is a
   pale lit face, the eastern flank is dark and packed with fall-line
   hatching, and a soft shadow is thrown across the ground to the east —
   which is what makes it read as standing up off the parchment instead of
   lying flat on it. Every proportion is jittered, so no two are alike. */
function drawPeak(c, x, y, s, rng) {
  // Broad rather than spiky: real range drawings sit wide on their base.
  const h = s * (0.9 + rng() * 0.7);
  const ap = [x + (rng() - 0.5) * s * 0.5, y - h];
  const lw = s * (1.0 + rng() * 0.55);
  const rw = s * (1.0 + rng() * 0.55);
  const bl = [ap[0] - lw, y + s * 0.05];
  const br = [ap[0] + rw, y - s * 0.04];
  // foot of the summit ridge, running down toward the viewer
  const foot = [ap[0] + s * (0.05 + rng() * 0.3), y + s * 0.1];

  // Faceted silhouettes. The east side gets an extra facet and a decent
  // chance of a shoulder summit, so massifs grow several tops.
  const left = craggyEdge(ap, bl, 3 + Math.floor(rng() * 2), lw * 0.32, -1, rng, rng() < 0.35);
  const right = craggyEdge(ap, br, 3 + Math.floor(rng() * 3), rw * 0.32, 1, rng, rng() < 0.55);
  const ridge = craggyEdge(ap, foot, 3, s * 0.15, 1, rng, false);

  const trace = (p, pts, move) => {
    if (move) p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  };

  // ---- cast shadow thrown east across the ground ----
  c.save();
  c.translate(br[0] - s * 0.1, y + s * 0.08);
  c.rotate(0.16);
  c.scale(1, 0.3);
  const sg = c.createRadialGradient(0, 0, 0, 0, 0, s * 1.7);
  sg.addColorStop(0, "rgba(44, 27, 10, 0.32)");
  sg.addColorStop(0.55, "rgba(44, 27, 10, 0.14)");
  sg.addColorStop(1, "rgba(44, 27, 10, 0)");
  c.fillStyle = sg;
  c.beginPath();
  c.arc(0, 0, s * 1.7, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // ---- body: opaque, so peaks behind are properly occluded ----
  const body = new Path2D();
  trace(body, left, true);
  body.lineTo(br[0], br[1]);
  for (let i = right.length - 2; i >= 0; i--) body.lineTo(right[i][0], right[i][1]);
  body.closePath();
  c.fillStyle = "#c6a06d";
  c.fill(body);

  // ---- lit west face ----
  const lit = new Path2D();
  trace(lit, left, true);
  lit.lineTo(foot[0], foot[1]);
  for (let i = ridge.length - 2; i >= 0; i--) lit.lineTo(ridge[i][0], ridge[i][1]);
  lit.closePath();
  const lg = c.createLinearGradient(ap[0], ap[1], bl[0], y + h * 0.15);
  lg.addColorStop(0, "#e7d3a9");
  lg.addColorStop(0.5, "#d5b689");
  lg.addColorStop(1, "#b08c5e");
  c.fillStyle = lg;
  c.fill(lit);

  // ---- snow, laid over both faces before the shadow goes on ----
  const snowT = 0.42 + rng() * 0.24;
  const snowL = samplePoly(left, snowT);
  const snowR = samplePoly(right, snowT * (0.8 + rng() * 0.5));
  const snow = new Path2D();
  snow.moveTo(snowL[0], snowL[1]);
  for (let i = left.length - 2; i >= 0; i--) {
    if (i / (left.length - 1) < snowT) snow.lineTo(left[i][0], left[i][1]);
  }
  snow.lineTo(ap[0], ap[1]);
  for (let i = 1; i < right.length; i++) {
    if (i / (right.length - 1) < snowT) snow.lineTo(right[i][0], right[i][1]);
  }
  snow.lineTo(snowR[0], snowR[1]);
  // ragged snowline back across the face
  const steps = 3 + Math.floor(rng() * 3);
  for (let i = steps - 1; i >= 1; i--) {
    const t = i / steps;
    const bx = snowL[0] + (snowR[0] - snowL[0]) * t;
    const by = snowL[1] + (snowR[1] - snowL[1]) * t;
    snow.lineTo(bx + (rng() - 0.5) * s * 0.14, by - (rng() - 0.25) * s * 0.3);
  }
  snow.closePath();
  c.save();
  c.clip(body);
  c.fillStyle = "#fdf8ec";
  c.fill(snow);
  c.restore();

  // ---- shadowed east face: light wash, then the hatching does the work ----
  const dark = new Path2D();
  trace(dark, ridge, true);
  dark.lineTo(br[0], br[1]);
  for (let i = right.length - 2; i >= 0; i--) dark.lineTo(right[i][0], right[i][1]);
  dark.closePath();
  c.save();
  c.clip(dark);
  c.fillStyle = "rgba(78, 52, 22, 0.26)";
  c.fill(dark);

  // Fine and dense: the tone should come from how tightly the strokes are
  // packed, not from a few fat ones, or the flank reads as bold stripes.
  const dx = br[0] - ap[0], dy = y - ap[1];
  const dl = Math.hypot(dx, dy) || 1;
  const ux = dx / dl, uy = dy / dl;          // downhill
  const px = -uy, py = ux;                   // across the slope
  const span = h + rw;
  const gap = Math.max(1.0, s * 0.045);
  c.strokeStyle = "rgba(38, 22, 5, 0.66)";
  c.lineWidth = Math.max(0.45, s * 0.018);
  c.lineCap = "round";
  for (let k = -span / gap; k < span / gap; k++) {
    const ox = ap[0] + px * k * gap, oy = ap[1] + py * k * gap;
    const wob = (rng() - 0.5) * s * 0.12;
    c.beginPath();
    c.moveTo(ox - ux * span * 0.25, oy - uy * span * 0.25);
    c.quadraticCurveTo(ox + ux * span * 0.4 + px * wob, oy + uy * span * 0.4 + py * wob,
                       ox + ux * span * 1.25, oy + uy * span * 1.25);
    c.stroke();
  }
  c.restore();

  // ---- ink ----
  c.lineJoin = "round";
  c.lineCap = "round";
  c.strokeStyle = INK + "0.92)";
  c.lineWidth = Math.min(2.2, Math.max(0.8, s * 0.035));
  c.beginPath();
  c.moveTo(bl[0], bl[1]);
  for (let i = left.length - 2; i >= 0; i--) c.lineTo(left[i][0], left[i][1]);
  for (let i = 1; i < right.length; i++) c.lineTo(right[i][0], right[i][1]);
  c.stroke();
  c.strokeStyle = INK + "0.5)";
  c.lineWidth = Math.min(1.5, Math.max(0.6, s * 0.025));
  c.beginPath();
  c.moveTo(ridge[0][0], ridge[0][1]);
  for (let i = 1; i < ridge.length; i++) c.lineTo(ridge[i][0], ridge[i][1]);
  c.stroke();

  // gullies down the lit face, to break up the clean slope
  const spurs = 1 + Math.floor(rng() * 2);
  c.strokeStyle = INK + "0.3)";
  c.lineWidth = Math.max(0.6, s * 0.026);
  for (let i = 0; i < spurs; i++) {
    const t = 0.35 + rng() * 0.45;
    const a = samplePoly(left, t);
    const b = samplePoly(ridge, Math.min(0.95, t * 0.75 + 0.15));
    c.beginPath();
    c.moveTo(a[0], a[1]);
    c.quadraticCurveTo((a[0] + b[0]) / 2 + s * 0.06, (a[1] + b[1]) / 2 - s * 0.14,
                       b[0], b[1]);
    c.stroke();
  }
}

// Left unfilled, so hill country reads as pen texture rather than a field
// of pale domes sitting on top of the parchment.
function drawHill(c, x, y, s, rng) {
  c.strokeStyle = INK + "0.55)";
  c.lineWidth = 1.2;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(x - s, y);
  c.quadraticCurveTo(x - s * 0.55, y - s * 0.95, x, y - s * 0.92);
  c.quadraticCurveTo(x + s * 0.6, y - s * 0.9, x + s, y);
  c.stroke();
  if (rng() < 0.6) {
    c.strokeStyle = INK + "0.3)";
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(x - s * 0.45, y - s * 0.4);
    c.quadraticCurveTo(x - s * 0.7, y - s * 0.2, x - s * 0.72, y - s * 0.02);
    c.stroke();
  }
}

function drawOak(c, x, y, s, rng) {
  c.strokeStyle = INK + "0.85)";
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - s * 0.45); c.stroke();
  c.beginPath();
  c.arc(x, y - s * 0.78, s * 0.38, 0, Math.PI * 2);
  c.arc(x - s * 0.29, y - s * 0.56, s * 0.27, 0, Math.PI * 2);
  c.arc(x + s * 0.29, y - s * 0.56, s * 0.27, 0, Math.PI * 2);
  c.fillStyle = "rgba(66, 48, 24, 0.9)";
  c.fill();
  c.lineWidth = 0.8;
  c.stroke();
}

function drawPine(c, x, y, s) {
  c.beginPath();
  c.moveTo(x, y - s * 1.15);
  c.lineTo(x - s * 0.30, y - s * 0.55);
  c.lineTo(x - s * 0.14, y - s * 0.58);
  c.lineTo(x - s * 0.44, y);
  c.lineTo(x + s * 0.44, y);
  c.lineTo(x + s * 0.14, y - s * 0.58);
  c.lineTo(x + s * 0.30, y - s * 0.55);
  c.closePath();
  c.fillStyle = "rgba(56, 42, 20, 0.92)";
  c.fill();
  c.strokeStyle = INK + "0.7)";
  c.lineWidth = 0.8;
  c.stroke();
}

function drawMarshTuft(c, x, y, rng) {
  c.strokeStyle = INK + "0.5)";
  c.lineWidth = 1.2;
  const w = 8 + rng() * 7;
  c.beginPath();
  c.moveTo(x - w, y); c.lineTo(x + w, y);
  c.moveTo(x - w * 1.5, y + 6); c.lineTo(x + w * 1.5, y + 6);
  c.moveTo(x - w * 0.8, y + 12); c.lineTo(x + w * 0.8, y + 12);
  c.stroke();
  c.lineWidth = 1;
  c.beginPath();
  for (let i = -1; i <= 1; i++) {
    c.moveTo(x + i * 5, y);
    c.lineTo(x + i * 6.5, y - 8 - rng() * 6);
  }
  c.stroke();
}

function drawDune(c, x, y, r, alpha) {
  c.strokeStyle = INK + alpha + ")";
  c.lineWidth = 1.1;
  c.beginPath();
  c.ellipse(x, y, r * 1.9, r * 0.6, 0, Math.PI, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.ellipse(x + r * 2.6, y + r * 0.4, r * 1.1, r * 0.35, 0, Math.PI, Math.PI * 2);
  c.stroke();
}

function drawKeep(c, x, y, s) {
  c.save();
  c.beginPath();
  c.ellipse(x, y + 2, s * 1.5, s * 0.35, 0, 0, Math.PI * 2);
  c.fillStyle = "rgba(30, 17, 6, 0.18)";
  c.fill();
  c.fillStyle = "#38220f";
  c.strokeStyle = "rgba(24, 13, 4, 1)";
  c.lineWidth = 1.2;
  c.fillRect(x - s, y - s * 0.55, s * 2, s * 0.55);
  c.strokeRect(x - s, y - s * 0.55, s * 2, s * 0.55);
  c.fillRect(x - s * 1.15, y - s * 1.0, s * 0.6, s);
  c.strokeRect(x - s * 1.15, y - s * 1.0, s * 0.6, s);
  c.fillRect(x + s * 0.55, y - s * 1.0, s * 0.6, s);
  c.strokeRect(x + s * 0.55, y - s * 1.0, s * 0.6, s);
  c.fillRect(x - s * 0.32, y - s * 1.4, s * 0.64, s * 1.4);
  c.strokeRect(x - s * 0.32, y - s * 1.4, s * 0.64, s * 1.4);
  c.beginPath();
  c.moveTo(x, y - s * 1.4); c.lineTo(x, y - s * 1.85);
  c.lineTo(x + s * 0.45, y - s * 1.72); c.lineTo(x, y - s * 1.6);
  c.fillStyle = "#5a1e10";
  c.fill();
  c.stroke();
  c.restore();
}

// A town or village: a little clutch of roofs, as on an old map
function drawHouses(c, x, y, n, s, rng) {
  c.fillStyle = "rgba(38, 23, 9, 0.95)";
  for (let i = 0; i < n; i++) {
    const hx = x + (rng() - 0.5) * s * 3.2;
    const hy = y + (rng() - 0.5) * s * 1.6;
    const w = s * (0.8 + rng() * 0.5), h = s * (0.7 + rng() * 0.4);
    c.fillRect(hx - w / 2, hy - h, w, h);
    c.beginPath();
    c.moveTo(hx - w * 0.62, hy - h);
    c.lineTo(hx, hy - h - s * 0.55);
    c.lineTo(hx + w * 0.62, hy - h);
    c.closePath();
    c.fill();
  }
}

function drawCompass(c, x, y, s) {
  c.save();
  c.strokeStyle = PALE + "0.75)";
  c.fillStyle = PALE + "0.85)";
  c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, s * 0.5, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(x, y, s * 0.4, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const len = i % 2 === 0 ? s : s * 0.55;
    const w = i % 2 === 0 ? s * 0.14 : s * 0.09;
    const dx = Math.sin(a), dy = -Math.cos(a);
    c.beginPath();
    c.moveTo(x + dx * len, y + dy * len);
    c.lineTo(x - dy * w, y + dx * w);
    c.lineTo(x, y);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(x + dx * len, y + dy * len);
    c.lineTo(x + dy * w, y - dx * w);
    c.lineTo(x, y);
    c.closePath();
    c.fillStyle = "rgba(20, 12, 6, 0.75)";
    c.fill();
    c.fillStyle = PALE + "0.85)";
  }
  c.font = `${Math.round(s * 0.34)}px "Uncial Antiqua", serif`;
  c.textAlign = "center";
  c.fillText("N", x, y - s - 10);
  c.restore();
}

function drawShip(c, x, y, s, flip) {
  c.save();
  c.translate(x, y);
  if (flip) c.scale(-1, 1);
  c.strokeStyle = PALE + "0.85)";
  c.fillStyle = PALE + "0.2)";
  c.lineWidth = 1.8;
  c.beginPath();
  c.moveTo(-s, 0);
  c.quadraticCurveTo(0, s * 0.55, s, 0);
  c.lineTo(s * 0.75, s * 0.1);
  c.quadraticCurveTo(0, s * 0.62, -s * 0.75, s * 0.1);
  c.closePath();
  c.fill(); c.stroke();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -s * 1.15); c.stroke();
  c.beginPath();
  c.moveTo(0, -s * 1.1);
  c.quadraticCurveTo(s * 0.75, -s * 0.7, s * 0.1, -s * 0.15);
  c.closePath();
  c.fill(); c.stroke();
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(-s * 1.7, s * 0.45); c.quadraticCurveTo(-s * 1.3, s * 0.25, -s * 0.9, s * 0.45);
  c.moveTo(s * 0.9, s * 0.5); c.quadraticCurveTo(s * 1.3, s * 0.3, s * 1.7, s * 0.5);
  c.stroke();
  c.restore();
}

/* ---------- main stages ---------- */

function noiseTile(size, lo, span, seed) {
  const n = document.createElement("canvas");
  n.width = n.height = size;
  const nc = n.getContext("2d");
  const img = nc.createImageData(size, size);
  const rng = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = lo + rng() * span;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  return n;
}

function paintParchment(c, W, H) {
  // The stains are all soft, low-frequency gradients, so they are painted on a
  // small offscreen canvas and blown up — visually the same, ~25x cheaper.
  const SW = 1024, SH = Math.round(SW * H / W);
  const off = document.createElement("canvas");
  off.width = SW; off.height = SH;
  const o = off.getContext("2d");

  const g = o.createLinearGradient(0, 0, SW * 0.3, SH);
  g.addColorStop(0, "#d8b784");
  g.addColorStop(0.5, "#cfa972");
  g.addColorStop(1, "#c29a61");
  o.fillStyle = g;
  o.fillRect(0, 0, SW, SH);

  const rng = mulberry32(777);
  o.globalCompositeOperation = "multiply";
  for (let i = 0; i < 700; i++) {
    const x = rng() * SW, y = rng() * SH, r = (60 + rng() * 420) * SW / W;
    const a = 0.03 + rng() * 0.07;
    const rg = o.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(120, 86, 44, ${a})`);
    rg.addColorStop(1, "rgba(120, 86, 44, 0)");
    o.fillStyle = rg;
    o.fillRect(x - r, y - r, r * 2, r * 2);
  }
  o.globalCompositeOperation = "screen";
  for (let i = 0; i < 300; i++) {
    const x = rng() * SW, y = rng() * SH, r = (80 + rng() * 320) * SW / W;
    const a = 0.015 + rng() * 0.035;
    const rg = o.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(255, 240, 205, ${a})`);
    rg.addColorStop(1, "rgba(255, 240, 205, 0)");
    o.fillStyle = rg;
    o.fillRect(x - r, y - r, r * 2, r * 2);
  }

  c.drawImage(off, 0, 0, W, H);

  // paper tooth, baked in at full resolution
  c.save();
  c.globalCompositeOperation = "overlay";
  c.globalAlpha = 0.3;
  c.fillStyle = c.createPattern(noiseTile(256, 118, 20, 20260808), "repeat");
  c.fillRect(0, 0, W, H);
  c.restore();
}

function paintSeas(c, seas) {
  for (const { path, box } of seas) {
    c.save();
    c.clip(path);
    c.fillStyle = "#291d11";
    c.fillRect(box[0], box[1], box[2], box[3]);
    c.strokeStyle = "rgba(222, 190, 140, 0.06)";
    for (const w of [90, 190]) {
      c.lineWidth = w;
      c.stroke(path);
    }
    c.shadowColor = "rgba(235, 206, 152, 0.9)";
    c.shadowBlur = 60;
    c.strokeStyle = "#e9cc96";
    c.lineWidth = 7;
    c.stroke(path);
    c.shadowBlur = 0;
    c.restore();
  }
  c.strokeStyle = INK + "0.95)";
  c.lineWidth = 3.5;
  c.lineJoin = "round";
  for (const { path } of seas) c.stroke(path);
}

function paintRipples(c, water) {
  const rng = mulberry32(4242);
  c.strokeStyle = "rgba(214, 186, 138, 0.11)";
  c.lineWidth = 1.5;
  let placed = 0, tries = 0;
  while (placed < 900 && tries < 20000) {
    tries++;
    const x = rng() * WORLD.width, y = rng() * WORLD.height;
    if (!isWater(water, x, y) || !isWater(water, x - 55, y) || !isWater(water, x + 55, y)) continue;
    placed++;
    const len = 25 + rng() * 45;
    c.beginPath();
    c.moveTo(x - len, y);
    c.quadraticCurveTo(x - len / 2, y - 4, x, y);
    c.quadraticCurveTo(x + len / 2, y + 4, x + len, y);
    c.stroke();
  }
}

function islandPath([cx, cy, rx, ry, rot, seed]) {
  const a = (rot * Math.PI) / 180;
  const base = wobbleRing(cx, cy, rx, ry, seed, 14, 0.2).map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a),
            cy + dx * Math.sin(a) + dy * Math.cos(a)];
  });
  return smoothPath(crinkle(base, Math.min(rx, ry) * 0.3, seed * 7 + 1, true), true);
}

function paintIslands(c) {
  for (const isl of ISLANDS) {
    const path = islandPath(isl);
    c.save();
    c.shadowColor = "rgba(226, 197, 148, 0.5)";
    c.shadowBlur = 16;
    c.fillStyle = "#c8a673";
    c.fill(path);
    c.restore();
    c.strokeStyle = INK + "0.95)";
    c.lineWidth = 2.4;
    c.stroke(path);
  }
}

function lakePath([cx, cy, rx, ry, seed]) {
  const base = wobbleRing(cx, cy, rx, ry, seed, 12, 0.22);
  return smoothPath(crinkle(base, Math.min(rx, ry) * 0.28, seed * 13 + 5, true), true);
}

function paintLakes(c) {
  const rng = mulberry32(1357);
  for (const lake of LAKES) {
    const [cx, cy, rx, ry] = lake;
    const path = lakePath(lake);
    c.save();
    // pale halo on the shore, as on the seas, so lakes read as water
    c.shadowColor = "rgba(240, 214, 164, 0.95)";
    c.shadowBlur = 26;
    c.fillStyle = "#4a3a26";
    c.fill(path);
    c.restore();
    c.save();
    c.clip(path);
    // shallows: a soft light band just inside the shore
    c.strokeStyle = "rgba(226, 197, 148, 0.20)";
    c.lineWidth = 34;
    c.stroke(path);
    c.strokeStyle = "rgba(226, 197, 148, 0.16)";
    c.lineWidth = 14;
    c.stroke(path);
    // a few ripples so it does not read as a flat blot
    c.strokeStyle = "rgba(226, 197, 148, 0.22)";
    c.lineWidth = 1.4;
    for (let i = 0; i < 5; i++) {
      const x = cx + (rng() - 0.5) * rx * 1.1;
      const y = cy + (rng() - 0.5) * ry * 1.1;
      const len = rx * (0.16 + rng() * 0.16);
      c.beginPath();
      c.moveTo(x - len, y);
      c.quadraticCurveTo(x - len / 2, y - 3, x, y);
      c.quadraticCurveTo(x + len / 2, y + 3, x + len, y);
      c.stroke();
    }
    c.restore();
    c.strokeStyle = INK + "0.9)";
    c.lineWidth = 2;
    c.stroke(path);
  }
}

function paintRivers(c) {
  // Widen from source to mouth in a handful of chunks rather than per-point,
  // which keeps the stroke count in the hundreds instead of the tens of
  // thousands. Round caps hide the joins.
  const CHUNKS = 14;
  // Sepia, like the coastline. Blue reads as a marker line drawn over the
  // map rather than as part of the drawing.
  c.strokeStyle = "rgba(56, 40, 20, 0.72)";
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const river of RIVERS) {
    // Long meanders on top of the authored course, or a river with few
    // waypoints comes out looking ruled with a straight-edge. fbm averages
    // its octaves, so `amp` here buys roughly a third of its value in
    // actual sideways travel: 320 gives 25-105px of wander per river.
    const pts = crinkle(resample(river, 6), 320, river[0][0] | 0, false, 700);
    const n = pts.length;
    for (let k = 0; k < CHUNKS; k++) {
      const a = Math.floor((k * (n - 1)) / CHUNKS);
      const b = Math.floor(((k + 1) * (n - 1)) / CHUNKS);
      if (b <= a) continue;
      c.lineWidth = 1.6 + ((k + 0.5) / CHUNKS) * 3.2;
      c.beginPath();
      c.moveTo(pts[a][0], pts[a][1]);
      for (let i = a + 1; i <= b; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    }
  }
}

function paintDeserts(c) {
  const rng = mulberry32(999);
  for (const [cx, cy, rx, ry, kind] of DESERTS) {
    if (kind === "black") {
      c.save();
      c.translate(cx, cy);
      c.scale(1, ry / rx);
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, rx);
      rg.addColorStop(0, "rgba(58, 40, 20, 0.26)");
      rg.addColorStop(0.75, "rgba(58, 40, 20, 0.10)");
      rg.addColorStop(1, "rgba(58, 40, 20, 0)");
      c.fillStyle = rg;
      c.fillRect(-rx, -rx, rx * 2, rx * 2);
      c.restore();
      c.fillStyle = INK + "0.4)";
      for (let i = 0; i < 1400; i++) {
        const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
        const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
        c.beginPath();
        c.arc(x, y, 0.8 + rng() * 1.4, 0, Math.PI * 2);
        c.fill();
      }
    }
    const n = kind === "black" ? 190 : 340;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
      drawDune(c, x, y, 5 + rng() * 7, kind === "black" ? "0.45" : "0.30");
    }
  }
}

function paintMarshes(c) {
  const rng = mulberry32(555);
  for (const [cx, cy, rx, ry] of MARSHES) {
    for (let i = 0; i < 220; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      drawMarshTuft(c, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, rng);
    }
  }
}

function paintForests(c, water) {
  const rng = mulberry32(313);
  for (const [cx, cy, r, count] of FORESTS) {
    const trees = [];
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      const x = cx + Math.cos(a) * r * d, y = cy + Math.sin(a) * r * d * 0.7;
      if (nearWater(water, x, y, 26)) continue;
      trees.push([x, y, 9 + rng() * 6, rng() < 0.45]);
    }
    trees.sort((p, q) => p[1] - q[1]);
    for (const [x, y, s, pine] of trees) {
      if (pine) drawPine(c, x, y, s);
      else drawOak(c, x, y, s, rng);
    }
  }
}

function paintHills(c, water) {
  const rng = mulberry32(8191);
  for (const [cx, cy, rx, ry, count] of HILLS) {
    const bumps = [];
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
      if (nearWater(water, x, y, 34)) continue;
      bumps.push([x, y, 11 + rng() * 9]);
    }
    bumps.sort((p, q) => p[1] - q[1]);
    for (const [x, y, s] of bumps) drawHill(c, x, y, s, rng);
  }
}

function paintMountains(c, water) {
  const rng = mulberry32(171);
  const peaks = [];
  for (const range of RANGES) {
    const pts = crinkle(resample(range, 16), 14, range[0][1] | 0, false);
    let len = 0;
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const spacing = 36;   // tight, so a range reads as one massif
    let travelled = 0, nextAt = spacing * 0.4;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      const seg = Math.hypot(dx, dy) || 1;
      travelled += seg;
      if (travelled < nextAt) continue;
      nextAt += spacing * (0.7 + rng() * 0.6);
      const t = travelled / len;
      const envelope = 0.6 + 0.55 * Math.sin(Math.PI * Math.min(1, t));
      const [x, y] = pts[i];
      const nx = -dy / seg, ny = dx / seg;
      // now and then a summit that towers over its neighbours
      const hero = rng() < 0.16 ? 1.45 : 1;
      peaks.push([x + (rng() - 0.5) * 26, y + (rng() - 0.5) * 18,
                  (30 + rng() * 38) * envelope * hero]);
      if (rng() < 0.9) {
        const d = 44 + rng() * 46;
        peaks.push([x + nx * d + (rng() - 0.5) * 28, y + ny * d + (rng() - 0.5) * 18,
                    (20 + rng() * 26) * envelope]);
      }
      if (rng() < 0.75) {
        const d = -(44 + rng() * 46);
        peaks.push([x + nx * d + (rng() - 0.5) * 28, y + ny * d + (rng() - 0.5) * 18,
                    (17 + rng() * 24) * envelope]);
      }
      if (rng() < 0.45) {
        const d = (rng() < 0.5 ? 1 : -1) * (100 + rng() * 60);
        peaks.push([x + nx * d + (rng() - 0.5) * 30, y + ny * d + (rng() - 0.5) * 20,
                    (14 + rng() * 18) * envelope]);
      }
    }
  }
  peaks.sort((a, b) => a[1] - b[1]); // paint back to front
  for (const [x, y, s] of peaks) {
    if (nearWater(water, x, y, s * 1.2 + 12)) continue;
    drawPeak(c, x, y, s, rng);
  }
}

function paintHamlets(c, water) {
  const rng = mulberry32(60606);
  for (const [cx, cy, r, count] of HAMLET_ZONES) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng());
      const x = cx + Math.cos(a) * r * d, y = cy + Math.sin(a) * r * d * 0.75;
      if (nearWater(water, x, y, 34)) continue;
      drawHouses(c, x, y, 1 + Math.floor(rng() * 2), 4.5, rng);
    }
  }
}

/* The whole landmass minus the seas, as one even-odd path. Clipping to it
   makes every province line stop dead at the shore. */
function landClipPath(seas, W, H) {
  const p = new Path2D();
  p.rect(0, 0, W, H);
  for (const s of seas) p.addPath(s.path);
  return p;
}

// Each shared edge is drawn once, by whichever of the two cells has the
// smaller seed, so lines do not double up and darken.
function ownsEdge(seed, nb) {
  return seed.x < nb.x || (seed.x === nb.x && seed.y < nb.y);
}

function paintProvinces(c, provinces, land) {
  const inner = new Path2D();
  const frontier = new Path2D();
  for (const p of provinces) {
    for (const e of p.edges) {
      if (e.onFrame) continue;
      const nb = e.neighbour;
      if (nb.water) continue;                 // that is the coastline
      if (!ownsEdge(p.seed, nb)) continue;
      const target = nb.polity === p.polity ? inner : frontier;
      const pts = warpedEdge(e.a, e.b);
      target.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) target.lineTo(pts[i][0], pts[i][1]);
    }
  }
  c.save();
  c.clip(land, "evenodd");
  c.lineJoin = "round";
  c.lineCap = "round";
  c.strokeStyle = "rgba(78, 52, 24, 0.30)";
  c.lineWidth = 1.5;
  c.stroke(inner);
  c.strokeStyle = "rgba(58, 34, 12, 0.62)";
  c.lineWidth = 3.4;
  c.stroke(frontier);
  c.restore();
}

/* Faint colour wash for the political overlay: one path per polity, filled
   in a single pass so abutting cells do not double-blend along their seams. */
function paintPolitical(c, provinces, land) {
  const byPolity = new Map();
  for (const p of provinces) {
    if (p.polity < 0) continue;
    if (!byPolity.has(p.polity)) byPolity.set(p.polity, new Path2D());
    byPolity.get(p.polity).addPath(provincePath(p));
  }
  c.save();
  c.clip(land, "evenodd");
  c.globalAlpha = 0.34;
  for (const [i, path] of byPolity) {
    c.fillStyle = POLITIES[i].tint;
    c.fill(path);
  }
  c.restore();
}

// style: "uncial" (place names), "italic" (sub-labels), "serif" (provinces)
function setFont(c, size, style) {
  if (style === "italic") c.font = `italic ${size}px "IM Fell English", Georgia, serif`;
  else if (style === "serif") c.font = `${size}px "IM Fell English", Georgia, serif`;
  else c.font = `${size}px "Uncial Antiqua", Georgia, serif`;
  const track = style === "uncial" ? 0.13 : style === "serif" ? 0.1 : 0.06;
  try { c.letterSpacing = `${Math.round(size * track)}px`; } catch (e) {}
}

function haloText(c, text, x, y, size, style, kind) {
  setFont(c, size, style);
  c.lineJoin = "round";
  if (kind === "sea") {
    c.strokeStyle = "rgba(18, 12, 6, 0.55)";
    c.lineWidth = size * 0.12;
    c.strokeText(text, x, y);
    c.fillStyle = PALE + "0.85)";
  } else if (kind === "province") {
    c.strokeStyle = "rgba(216, 188, 140, 0.6)";
    c.lineWidth = size * 0.2;
    c.strokeText(text, x, y);
    c.fillStyle = "rgba(62, 42, 20, 0.78)";
  } else {
    c.strokeStyle = "rgba(218, 190, 142, 0.75)";
    c.lineWidth = size * 0.17;
    c.strokeText(text, x, y);
    c.fillStyle = INK + "0.92)";
  }
  c.fillText(text, x, y);
}

/* ---------- label placement -------------------------------------------
   Region names are placed by hand and always win. Settlement names then
   take the first side that does not collide with anything already placed;
   a name with nowhere to go is dropped and only its marker is drawn. That
   keeps the map legible however densely the data is edited.          */

const overlaps = (a, b) =>
  !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);

function textRect(c, text, x, y, size, style, align, rotDeg) {
  setFont(c, size, style);
  const w = c.measureText(text).width;
  const h = size * 0.86;
  let x0 = x;
  if (align === "center") x0 = x - w / 2;
  else if (align === "right") x0 = x - w;
  if (!rotDeg) return [x0, y - h / 2, x0 + w, y + h / 2];
  const r = (rotDeg * Math.PI) / 180;
  const hw = Math.abs(w / 2 * Math.cos(r)) + Math.abs(h / 2 * Math.sin(r));
  const hh = Math.abs(w / 2 * Math.sin(r)) + Math.abs(h / 2 * Math.cos(r));
  const cx = x0 + w / 2;
  return [cx - hw, y - hh, cx + hw, y + hh];
}

const TIER = [
  { icon: 15, size: 34 },   // 0 city
  { icon: 6.5, size: 26 },  // 1 town
  { icon: 5, size: 21 }     // 2 village
];

function paintMarkers(c) {
  const rng = mulberry32(24680);
  for (const [x, y, tier] of SETTLEMENTS) {
    if (tier === 0) drawKeep(c, x, y, TIER[0].icon);
    else drawHouses(c, x, y, tier === 1 ? 5 : 3, tier === 1 ? 6 : 5, rng);
  }
}

const PROVINCE_LABEL_SIZE = 23;

function paintNames(c, provinces) {
  c.textBaseline = "middle";
  const taken = [];

  // 1. reserve the region names (drawn last, so they sit on top)
  const regions = [];
  for (const lb of LABELS) {
    if (lb.river && !SHOW_RIVERS) continue;   // don't name a river we didn't draw
    const heights = lb.lines.map(l => l.s * 1.12);
    const total = heights.reduce((a, b) => a + b, 0);
    let dy = -total / 2;
    for (let i = 0; i < lb.lines.length; i++) {
      const line = lb.lines[i];
      dy += heights[i] / 2;
      const style = line.i ? "italic" : "uncial";
      const r = textRect(c, line.t, lb.x, lb.y + dy, line.s, style, "center", lb.rot);
      taken.push(r);
      regions.push({ lb, line, dy, style });
      dy += heights[i] / 2;
    }
  }

  // 2. settlement names, biggest places first so they get the good spots
  const order = SETTLEMENTS
    .map((s, i) => ({ s, i }))
    .filter(o => o.s[3])
    .sort((a, b) => a.s[2] - b.s[2] || a.i - b.i);

  for (const { s } of order) {
    const [x, y, tier, name, side] = s;
    const t = TIER[tier];
    const gap = t.icon * 1.9 + 6;
    const sides = [side || "r", "r", "l", "t", "b"];
    let placed = null;
    for (const sd of sides) {
      let tx = x, ty = y, align = "left";
      if (sd === "l") { tx = x - gap; align = "right"; }
      else if (sd === "t") { ty = y - t.icon * 2.2 - t.size * 0.6; align = "center"; }
      else if (sd === "b") { ty = y + t.icon * 1.2 + t.size * 0.7; align = "center"; }
      else tx = x + gap;
      const r = textRect(c, name, tx, ty, t.size, "uncial", align, 0);
      if (taken.some(o => overlaps(r, o))) continue;
      placed = { tx, ty, align, r };
      break;
    }
    if (!placed) continue;          // no room: marker only
    taken.push(placed.r);
    c.textAlign = placed.align;
    haloText(c, name, placed.tx, placed.ty, t.size, "uncial", "land");
  }

  // 3. province names, lowest priority of all
  c.textAlign = "center";
  const S = PROVINCE_LABEL_SIZE;
  for (const p of provinces) {
    const [x, y] = p.labelAt;
    const r = textRect(c, p.name, x, y, S, "serif", "center", 0);
    if (taken.some(o => overlaps(r, o))) continue;
    taken.push(r);
    haloText(c, p.name, x, y, S, "serif", "province");
  }

  // 4. region names on top
  for (const { lb, line, dy, style } of regions) {
    c.save();
    c.translate(lb.x, lb.y);
    c.rotate((lb.rot * Math.PI) / 180);
    c.textAlign = "center";
    haloText(c, line.t, 0, dy, line.s, style, lb.sea ? "sea" : "land");
    c.restore();
  }
}

function paintFinish(c, W, H) {
  // burnt map edges, confined to the outer rim
  c.save();
  c.globalCompositeOperation = "multiply";
  const R = Math.hypot(W, H) / 2;
  const v = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
  v.addColorStop(0, "rgba(255, 255, 255, 1)");
  v.addColorStop(0.78, "rgba(255, 255, 255, 1)");
  v.addColorStop(0.92, "rgba(214, 186, 142, 1)");
  v.addColorStop(1, "rgba(140, 98, 50, 1)");
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
  c.restore();
}

/* ---------- entry point ---------- */

/* Yield to the browser so the loading screen can repaint between stages.
   Races rAF against a timer: rAF alone never fires while the tab is in the
   background, which would leave the map stuck half-drawn. */
const nextFrame = () => new Promise(r => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(go);
  setTimeout(go, 40);
});

const POLITICAL_SCALE = 0.5;   // the wash is soft, so half resolution is plenty

async function renderMap(canvas, politicalCanvas, onProgress) {
  const W = WORLD.width, H = WORLD.height;
  canvas.width = Math.round(W * RENDER_SCALE);
  canvas.height = Math.round(H * RENDER_SCALE);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const c = canvas.getContext("2d");
  c.scale(RENDER_SCALE, RENDER_SCALE);

  politicalCanvas.width = Math.round(W * POLITICAL_SCALE);
  politicalCanvas.height = Math.round(H * POLITICAL_SCALE);
  politicalCanvas.style.width = W + "px";
  politicalCanvas.style.height = H + "px";
  const pc = politicalCanvas.getContext("2d");
  pc.scale(POLITICAL_SCALE, POLITICAL_SCALE);

  const seas = SEAS.map(seaShape);
  const waterPaths = seas.map(s => s.path).concat(LAKES.map(lakePath));
  const water = buildWaterMask(waterPaths, W, H, 16);
  const land = landClipPath(seas, W, H);
  let provinces = [];

  const stages = [
    ["Preparing the vellum", () => paintParchment(c, W, H)],
    ["Charting the wastes", () => paintDeserts(c)],
    ["Pouring out the seas", () => paintSeas(c, seas)],
    ["Scattering the isles", () => { paintRipples(c, water); paintIslands(c); }],
    ["Surveying the provinces", () => {
      provinces = generateProvinces((x, y) => isWater(water, x, y));
      paintProvinces(c, provinces, land);
      paintPolitical(pc, provinces, land);
    }],
    ["Tracing the waters", () => { if (SHOW_RIVERS) paintRivers(c); paintLakes(c); }],
    ["Draining the fens", () => paintMarshes(c)],
    ["Raising the hills", () => paintHills(c, water)],
    ["Planting the forests", () => paintForests(c, water)],
    ["Raising the mountains", () => paintMountains(c, water)],
    ["Settling the folk", () => paintHamlets(c, water)],
    ["Building the holds", () => {
      paintMarkers(c);
      drawCompass(c, COMPASS[0], COMPASS[1], COMPASS[2]);
      for (const [x, y, s, flip] of SHIPS) drawShip(c, x, y, s, flip);
    }],
    ["Lettering the names", () => paintNames(c, provinces)],
    ["Ageing the parchment", () => paintFinish(c, W, H)]
  ];

  const timings = [];
  for (let i = 0; i < stages.length; i++) {
    if (onProgress) onProgress(stages[i][0], i / stages.length);
    await nextFrame();
    const t0 = performance.now();
    stages[i][1]();
    timings.push(stages[i][0] + ": " + Math.round(performance.now() - t0) + "ms");
  }
  window.__renderTimings = timings;
  if (onProgress) onProgress("", 1);
}
