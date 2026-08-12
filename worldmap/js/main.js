/* =========================================================================
   MAIN — camera + controls. EU4-style: pan with arrow keys / WASD, with
   the mouse at the screen edges, or by dragging. Scroll wheel zooms,
   Shift sprints. A minimap and league bar show where you are in the world.
   ========================================================================= */

const TILT_DEG = 32;
const TILT_RAD = (TILT_DEG * Math.PI) / 180;
const PERSPECTIVE = 1100;      // must match #viewport perspective in the CSS
const ANCHOR_Y = 0.56;         // must match #tilt top in the CSS
const EDGE_MARGIN = 32;        // px from screen edge that triggers panning
const PAN_SPEED = 1100;        // world px / second at zoom 1
const ZOOM_MIN = 0.5, ZOOM_MAX = 1.7;

const viewport = document.getElementById("viewport");
const tiltEl = document.getElementById("tilt");
const planeEl = document.getElementById("plane");
const mapEl = document.getElementById("map");
const politicalEl = document.getElementById("political");
const miniEl = document.getElementById("minimap");
const barEl = document.getElementById("scalebar");

// starting camera; override with URL params, e.g. ?x=4200&y=1600&z=1
const _q = new URLSearchParams(location.search);
const cam = {
  x: parseFloat(_q.get("x")) || 4200,
  y: parseFloat(_q.get("y")) || 1600,
  zoom: parseFloat(_q.get("z")) || 0.72,
  zoomTarget: parseFloat(_q.get("z")) || 0.72,
  vx: 0, vy: 0
};

const keys = new Set();
let mouseX = -1, mouseY = -1, mouseInWindow = false;
let dragging = false, lastDrag = null;

/* ---------- input ---------- */

window.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "a", "s", "d"].includes(k)) {
    keys.add(k);
    e.preventDefault();
  }
  if (k === "p" && !e.ctrlKey && !e.metaKey) politicalEl.classList.toggle("on");
});
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

window.addEventListener("mousemove", e => {
  mouseX = e.clientX; mouseY = e.clientY; mouseInWindow = true;
});
document.addEventListener("mouseleave", () => { mouseInWindow = false; });

viewport.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  dragging = true;
  lastDrag = [e.clientX, e.clientY];
  viewport.classList.add("dragging");
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointermove", e => {
  if (!dragging || !lastDrag) return;
  const dx = e.clientX - lastDrag[0], dy = e.clientY - lastDrag[1];
  lastDrag = [e.clientX, e.clientY];
  cam.x -= dx / cam.zoom;
  cam.y -= dy / (cam.zoom * Math.cos(TILT_RAD));
  cam.vx = cam.vy = 0;
});
const endDrag = () => { dragging = false; lastDrag = null; viewport.classList.remove("dragging"); };
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);

window.addEventListener("wheel", e => {
  e.preventDefault();
  cam.zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
    cam.zoomTarget * Math.exp(-e.deltaY * 0.0011)));
}, { passive: false });

window.addEventListener("contextmenu", e => e.preventDefault());

/* ---------- projection ----------
   A world point (wx, wy) relative to the camera sits on the tilted plane at
   (u, v) = (wx - cam.x, wy - cam.y). CSS applies rotateX then a perspective
   projection, which works out to:
       screenX = anchorX + z*u*p,  screenY = anchorY + z*v*cos(t)*p
   with p = d / (d - z*v*sin(t)). Inverting that gives the world point under
   any screen pixel, which is what the minimap footprint needs.        */

function screenToWorld(sx, sy) {
  const anchorX = window.innerWidth / 2;
  const anchorY = window.innerHeight * ANCHOR_Y;
  const dy = sy - anchorY;
  const denom = cam.zoom * (PERSPECTIVE * Math.cos(TILT_RAD) + dy * Math.sin(TILT_RAD));
  // beyond the horizon the projection flips; clamp to a far-away row instead
  if (denom <= 1) return null;
  const v = (dy * PERSPECTIVE) / denom;
  const p = PERSPECTIVE / (PERSPECTIVE - cam.zoom * v * Math.sin(TILT_RAD));
  const u = (sx - anchorX) / (cam.zoom * p);
  return [cam.x + u, cam.y + v];
}

/* ---------- camera loop ---------- */

function inputDirection() {
  let dx = 0, dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;

  // EU4-style edge panning
  if (mouseInWindow && !dragging && mouseX >= 0) {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (mouseX < EDGE_MARGIN) dx -= 1 - mouseX / EDGE_MARGIN;
    else if (mouseX > vw - EDGE_MARGIN) dx += 1 - (vw - mouseX) / EDGE_MARGIN;
    if (mouseY < EDGE_MARGIN) dy -= 1 - mouseY / EDGE_MARGIN;
    else if (mouseY > vh - EDGE_MARGIN) dy += 1 - (vh - mouseY) / EDGE_MARGIN;
  }
  const m = Math.hypot(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }
  return [dx, dy];
}

function clampCamera() {
  const hw = window.innerWidth / 2 / cam.zoom;
  const hh = window.innerHeight / 2 / (cam.zoom * Math.cos(TILT_RAD));
  cam.x = Math.min(WORLD.width - hw * 0.4, Math.max(hw * 0.4, cam.x));
  cam.y = Math.min(WORLD.height - hh * 0.25, Math.max(hh * 0.4, cam.y));
}

let lastT = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  const [dx, dy] = inputDirection();
  const sprint = keys.has("shift") ? 2.4 : 1;
  const speed = (PAN_SPEED / cam.zoom) * sprint;
  const smooth = Math.min(1, dt * 9);
  cam.vx += (dx * speed - cam.vx) * smooth;
  cam.vy += (dy * speed * 1.25 - cam.vy) * smooth;
  cam.x += cam.vx * dt;
  cam.y += cam.vy * dt;

  cam.zoom += (cam.zoomTarget - cam.zoom) * Math.min(1, dt * 10);
  clampCamera();

  tiltEl.style.transform = `rotateX(${TILT_DEG}deg) scale(${cam.zoom})`;
  planeEl.style.transform = `translate3d(${-cam.x}px, ${-cam.y}px, 0)`;

  drawMinimap();
  drawScaleBar();
  requestAnimationFrame(frame);
}

// Shift is tracked separately so it never blocks the browser's own shortcuts
window.addEventListener("keydown", e => { if (e.shiftKey) keys.add("shift"); });
window.addEventListener("keyup", e => { if (!e.shiftKey) keys.delete("shift"); });

/* ---------- minimap ---------- */

const MINI_W = 240;
const MINI_H = Math.round(MINI_W * WORLD.height / WORLD.width);
let miniBase = null;

function buildMinimap(source) {
  miniEl.width = MINI_W;
  miniEl.height = MINI_H;
  miniBase = document.createElement("canvas");
  miniBase.width = MINI_W;
  miniBase.height = MINI_H;
  miniBase.getContext("2d").drawImage(source, 0, 0, MINI_W, MINI_H);
  miniEl.parentElement.classList.add("ready");
  // Paint it once straight away: the animation loop is what normally keeps it
  // up to date, and rAF does not run at all while the tab is in the
  // background, which would otherwise leave an empty box.
  drawMinimap();
}

function drawMinimap() {
  if (!miniBase) return;
  const c = miniEl.getContext("2d");
  c.clearRect(0, 0, MINI_W, MINI_H);
  c.drawImage(miniBase, 0, 0);

  const w = window.innerWidth, h = window.innerHeight;
  const corners = [
    screenToWorld(0, 0), screenToWorld(w, 0),
    screenToWorld(w, h), screenToWorld(0, h)
  ];
  if (corners.some(p => !p)) return;
  const sx = MINI_W / WORLD.width, sy = MINI_H / WORLD.height;
  c.beginPath();
  corners.forEach(([x, y], i) => {
    const px = x * sx, py = y * sy;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  });
  c.closePath();
  c.fillStyle = "rgba(255, 236, 190, 0.16)";
  c.fill();
  c.strokeStyle = "rgba(58, 32, 10, 0.9)";
  c.lineWidth = 1.5;
  c.stroke();
}

/* ---------- league bar ---------- */

let lastBarKey = "";
function drawScaleBar() {
  // exact only along the anchor row, where the perspective factor is 1
  const choices = [10, 20, 50, 100, 200, 500, 1000];
  let leagues = choices[0];
  for (const n of choices) {
    if (n * PX_PER_LEAGUE * cam.zoom <= 190) leagues = n; else break;
  }
  const px = Math.round(leagues * PX_PER_LEAGUE * cam.zoom);
  const key = leagues + ":" + px;
  if (key === lastBarKey) return;
  lastBarKey = key;
  barEl.style.setProperty("--bar", px + "px");
  barEl.querySelector("span").textContent = leagues + " leagues";
}

/* ---------- boot ---------- */

function makeGrain() {
  const n = document.createElement("canvas");
  n.width = n.height = 128;
  const nc = n.getContext("2d");
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
  document.getElementById("grain").style.backgroundImage = `url(${n.toDataURL()})`;
}

async function boot() {
  makeGrain();
  const loader = document.getElementById("loading");
  const loadText = document.getElementById("loading-text");
  const loadFill = document.getElementById("loading-fill");

  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('80px "Uncial Antiqua"'),
        document.fonts.load('italic 40px "IM Fell English"')
      ]),
      new Promise(r => setTimeout(r, 3000))
    ]);
  } catch (e) { /* draw with fallback fonts */ }

  await renderMap(mapEl, politicalEl, (label, pct) => {
    if (label) loadText.textContent = label + "…";
    loadFill.style.width = Math.round(pct * 100) + "%";
  });

  buildMinimap(mapEl);
  if (_q.get("political") === "1") politicalEl.classList.add("on");
  clampCamera();
  loader.classList.add("done");
  setTimeout(() => loader.remove(), 900);
  requestAnimationFrame(frame);
  setTimeout(() => document.getElementById("help").classList.add("dim"), 9000);
}

boot();
