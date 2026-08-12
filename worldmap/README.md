# Campaign World Map

An interactive, EU4-style map for the homebrew TTRPG setting. Pure HTML/CSS/JS —
no build step, no dependencies. The whole world is drawn procedurally onto one
big canvas in a hand-drawn "Tolkien map on parchment" style, then shown through
a tilted 3D camera with tilt-shift blur, vignette and film grain.

## Controls

| Action | Input |
|---|---|
| Pan | Arrow keys / WASD, mouse at the screen edges (EU4-style), or click-drag |
| Sprint | Hold Shift while panning |
| Zoom | Scroll wheel |
| Political map | **P** — fades a colour wash over each polity's provinces |

Add `&political=1` to the URL to open straight into the political view.

A minimap (bottom right) shows the viewport as a trapezoid over the whole
continent, and a league bar (bottom left) gives the scale. You can link to a
specific spot with URL parameters: `?x=4200&y=1600&z=0.9` (world coordinates
plus zoom).

## Run locally

```bash
python -m http.server 8123
```

then open <http://localhost:8123>. Any static file server works — ports 8080
and 8090 are avoided on purpose.

## Editing the world

Everything about the world lives in **`js/mapdata.js`**, all in world
coordinates on a 8192 × 5120 parchment ((0,0) = north-west corner, 1 league =
5 world pixels, so the continent is ~1600 leagues across):

- `SEAS` — each has a `coast` line and any `close` points needed to seal the
  polygon off the edge of the map. The coast is displaced by fractal noise at
  draw time, so a dozen points become a shoreline full of coves and headlands.
- `ISLANDS`, `LAKES` — ellipse seeds, crinkled the same way
- `SHOW_RIVERS` / `RIVERS` — **rivers are off by default.** Drawn in blue they
  read as the guide lines from the original sketch rather than as part of the
  drawing, so the map ships without them. Flip `SHOW_RIVERS` to `true` to put
  them back: they now draw in the same sepia ink as the coastline, and the
  two river-name labels (tagged `river: true`) reappear with them. A long
  meander is added at draw time, so a handful of waypoints is enough; don't
  route two of them within ~200px of each other or they will cross.
- `POLITIES` — each has a `claim` outline, a `tint` and a name-`culture`.
  These outlines are the blue lines from the original sketch, used as the
  territory guides they were meant to be rather than drawn as rivers.
  List small polities before large ones: where two claims overlap, the
  earlier one wins.
- `PROVINCE_NAMES` — optional `"x,y" -> name` overrides for individual
  provinces, keyed on the seed coordinates.
- `RANGES` — mountain range spines. Peaks are scattered along and across them
  and drawn back-to-front so they overlap into massifs. Each one is built
  from faceted, jittered silhouettes with a lit west face, a snow cap, a
  hatched east flank and a cast shadow, so no two are alike. `spacing` and
  the size ranges in `paintMountains` control how dense and how big they get.
- `HILLS` — hill-country clusters, drawn as unfilled pen bumps
- `DESERTS`, `MARSHES`, `FORESTS` — terrain patches
- `HAMLET_ZONES` — clusters of unnamed cottages, for lived-in texture
- `BORDER_RINGS` — wobbly dashed political borders
- `SETTLEMENTS` — `[x, y, tier, name, side]`; tier 0 = city (keep), 1 = town,
  2 = village. An empty name draws the marker with no label.
- `LABELS` — region, geographic and sea names (Uncial Antiqua for names, IM
  Fell English for the small italic sublabels), with per-label size/rotation
- `COMPASS`, `SHIPS` — decorations

## Provinces

`js/provinces.js` dices the whole landmass into province cells and gives each
one a generated name in its polity's style. Polities are unions of provinces,
so a frontier is always exactly the outer edge of the provinces that make it
up and can never drift out of step with them.

Cells are a Voronoi diagram over a jittered grid of seeds, built by half-plane
clipping. Raw Voronoi edges are dead straight and read as machine-made, so
every point is pushed through one shared domain warp before it is drawn —
because the warp is a function of position alone, two neighbours warp their
common edge to exactly the same curve and the cells still tile without seams.
Seeds that land in water are kept as invisible "ghosts" so coastal cells stay
compact instead of ballooning across the ocean, and all province drawing is
clipped to the land so lines stop dead at the shore.

Inner province borders are drawn thin; frontiers between different polities
are drawn heavier. Change `PROVINCE_SPACING` to make provinces bigger or
smaller.

## Labels

Region names are placed by hand and always win; settlement names then take the
first side that doesn't collide with anything already placed, and province
names fill whatever gaps are left. A name with nowhere to go is dropped so
only its marker shows. That means you can add places freely without
hand-tuning label positions.

The renderer (`js/render.js`) and camera (`js/main.js`) rarely need touching.
Rendering is deterministic (seeded RNG), so the map looks identical every load;
it draws in ~0.5s behind a loading screen.

## Deploying

**Render (static site):** New → Static Site → pick this repo, set
*Root Directory* to `worldmap`, leave the build command empty, and set
*Publish Directory* to `.` — done.

**GitHub Pages:** Pages serves only from the repo root or `/docs`, so either
copy/rename this folder to `docs/` and enable Pages → deploy from branch, or
use an Actions workflow with `worldmap` as the upload path.

Fonts load from Google Fonts; offline it falls back to a plain serif.
