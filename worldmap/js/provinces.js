/* =========================================================================
   PROVINCES — the landmass is diced into province cells, and polities are
   unions of those cells, so a frontier is always exactly the outer edge of
   the provinces that make it up.

   Cells come from a jittered grid of seeds turned into a Voronoi diagram by
   half-plane clipping. Raw Voronoi edges are dead straight and read as
   machine-made, so every point is pushed through one shared domain warp
   before it is drawn: because the warp is a function of position alone,
   two neighbours warp their common edge to exactly the same curve and the
   cells still tile without seams.
   ========================================================================= */

const PROVINCE_SPACING = 320;   // world px between province seeds

/* ---------- shared domain warp ---------- */

function warpPoint(x, y) {
  const u = (x * 0.73 + y * 0.68) / 380;
  const v = (x * -0.68 + y * 0.73) / 380;
  const dx = fbm(u, 9001, 0) * 104 + fbm(u * 2.7, 9007, 0) * 36;
  const dy = fbm(v, 9013, 0) * 104 + fbm(v * 2.7, 9019, 0) * 36;
  return [x + dx, y + dy];
}

/* ---------- geometry ---------- */

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) &&
        x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Keep the part of `poly` closer to A than to B (Sutherland-Hodgman against
// the perpendicular bisector of AB).
function clipToBisector(poly, ax, ay, bx, by) {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const nx = bx - ax, ny = by - ay;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = (p[0] - mx) * nx + (p[1] - my) * ny;
    const dq = (q[0] - mx) * nx + (q[1] - my) * ny;
    if (dp <= 0) out.push(p);
    if ((dp <= 0) !== (dq <= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/* ---------- province names ---------- */

const SYLLABLES = {
  hamsu:   ["ka", "tu", "ish", "nab", "ur", "sha", "mar", "zu", "bel", "lil",
            "kish", "tar", "ub", "en", "nim", "sar", "qad", "esh", "anu", "ram"],
  slave:   ["bond", "yoke", "chain", "gall", "thral", "grim", "mar", "hold",
            "fen", "moor", "stock", "brand", "wretch", "coll"],
  napalqu: ["nap", "alq", "tar", "qa", "isu", "wa", "kum", "mu", "ash", "qan",
            "haz", "ur", "tel", "kar", "shu"],
  cygnar:  ["cas", "per", "corv", "enne", "ost", "rand", "fhar", "wick",
            "tann", "ock", "mirr", "ow", "bel", "port", "cadd", "high", "moor"],
  wutari:  ["wu", "tar", "zah", "iri", "amm", "ash", "tek", "ru", "qarn",
            "sab", "kha", "dun", "rif", "sef", "nub"],
  solaria: ["aur", "el", "ium", "sol", "ar", "ia", "hel", "ion", "luc", "era",
            "vent", "cast", "ra", "ost", "vell", "mer"],
  milaminna: ["mil", "am", "inna", "vell", "astra", "and", "ar", "ine",
              "port", "essa", "cant", "ile", "sed", "ra", "tor"],
  black:   ["kal", "thar", "on", "night", "gate", "rav", "ens", "moor",
            "obs", "idia", "sab", "le", "dusk", "mere", "vant", "ash"],
  warring: ["ver", "ruca", "tall", "eth", "or", "im", "cas", "ca", "duv",
            "marr", "stodd", "halv", "yn", "bras", "ghent", "pel"],
  water:   ["fen", "mere", "reed", "watch", "stilt", "home", "mire", "lund",
            "eel", "gate", "hallow", "marsh", "sedge", "tarn", "wick"],
  hermit:  ["vow", "holt", "sil", "ent", "cairn", "grey", "hold", "hush",
            "still", "ward", "vig", "il"],
  ciclopea: ["kykl", "os", "mono", "ptos", "cicl", "opea", "thal", "eia",
             "orb", "ion", "phos"],
  wild:    ["ash", "bar", "cor", "dun", "el", "far", "gorm", "hal", "ith",
            "kel", "lor", "mor", "nan", "orl", "pel", "ras", "sil", "tor",
            "ulm", "ver", "wyn", "zar"]
};

const WILD_SUFFIX = ["moor", "fell", "vale", "reach", "mere", "holt", "wold",
                     "march", "heath", "combe"];

function provinceName(culture, seedNum) {
  const rng = mulberry32(seedNum);
  const pool = SYLLABLES[culture] || SYLLABLES.wild;
  const n = 2 + (rng() < 0.32 ? 1 : 0);
  let s = "";
  for (let i = 0; i < n; i++) s += pool[Math.floor(rng() * pool.length)];
  if (culture === "wild" && rng() < 0.34) {
    s = pool[Math.floor(rng() * pool.length)] +
        WILD_SUFFIX[Math.floor(rng() * WILD_SUFFIX.length)];
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- build ---------- */

function generateProvinces(isWaterFn) {
  const W = WORLD.width, H = WORLD.height;
  const step = PROVINCE_SPACING;
  const rng = mulberry32(31337);

  // 1. seeds on a jittered grid. Seeds that land in water are kept as
  //    "ghosts": never drawn, but they stop coastal cells from ballooning
  //    out across the whole ocean.
  const seeds = [];
  for (let gy = 0; (gy + 0.5) * step < H + step; gy++) {
    for (let gx = 0; (gx + 0.5) * step < W + step; gx++) {
      const x = (gx + 0.5) * step + (rng() - 0.5) * step * 0.8;
      const y = (gy + 0.5) * step + (rng() - 0.5) * step * 0.8;
      seeds.push({ x, y, water: isWaterFn(x, y) });
    }
  }

  // 2. which polity claims each seed (first claim wins)
  for (const s of seeds) {
    s.polity = -1;
    if (s.water) continue;
    for (let i = 0; i < POLITIES.length; i++) {
      if (pointInPoly(s.x, s.y, POLITIES[i].claim)) { s.polity = i; break; }
    }
  }

  // 3. nearest neighbours, used both for clipping and for frontier tests
  const K = 26;
  for (const s of seeds) {
    s.near = seeds
      .filter(o => o !== s)
      .map(o => ({ o, d: (o.x - s.x) ** 2 + (o.y - s.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K)
      .map(e => e.o);
  }

  // 4. cells
  const provinces = [];
  // Settlement names are reserved so no province ends up sharing a name with
  // a town, which reads as a bug rather than as a town naming its province.
  const usedNames = new Set(SETTLEMENTS.map(s => s[3]).filter(Boolean));
  for (const s of seeds) {
    if (s.water) continue;
    let poly = [[-step, -step], [W + step, -step], [W + step, H + step], [-step, H + step]];
    for (const o of s.near) {
      poly = clipToBisector(poly, s.x, s.y, o.x, o.y);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;

    // Each edge of a Voronoi cell lies on the bisector with one neighbour;
    // find it from the midpoint so frontiers can be told from inner borders.
    const edges = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const onFrame =
        (Math.abs(a[0] - b[0]) < 0.01 && (mx <= 0.5 || mx >= W - 0.5)) ||
        (Math.abs(a[1] - b[1]) < 0.01 && (my <= 0.5 || my >= H - 0.5));
      let best = null, bestD = Infinity;
      for (const o of s.near) {
        const d = (o.x - mx) ** 2 + (o.y - my) ** 2;
        if (d < bestD) { bestD = d; best = o; }
      }
      edges.push({ a, b, neighbour: best, onFrame });
    }

    const key = Math.round(s.x) + "," + Math.round(s.y);
    const culture = s.polity < 0 ? "wild" : POLITIES[s.polity].culture;
    let name = PROVINCE_NAMES[key];
    if (!name) {
      // Re-roll until the name is unused; two provinces sharing a name looks
      // like a bug even when the map is otherwise fine.
      const base = (Math.round(s.x) * 73856093) ^ (Math.round(s.y) * 19349663);
      for (let attempt = 0; attempt < 40; attempt++) {
        name = provinceName(culture, base + attempt * 2654435761);
        if (!usedNames.has(name)) break;
      }
    }
    usedNames.add(name);
    provinces.push({
      seed: s,
      polity: s.polity,
      key,
      name,
      poly,
      edges,
      labelAt: warpPoint(s.x, s.y)
    });
  }
  return provinces;
}

/* Walk an edge as a warped curve. Both cells sharing the edge subdivide it
   the same way, so they produce the same curve and leave no seam. */
function warpedEdge(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.round(len / 26));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(warpPoint(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
  }
  return pts;
}

function provincePath(p) {
  const path = new Path2D();
  let started = false;
  for (const e of p.edges) {
    for (const q of warpedEdge(e.a, e.b)) {
      if (!started) { path.moveTo(q[0], q[1]); started = true; }
      else path.lineTo(q[0], q[1]);
    }
  }
  path.closePath();
  return path;
}
