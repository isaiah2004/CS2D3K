# Performance

All numbers are from `node bench/run.mjs` on the production build, on a Windows laptop with an RTX 4050.
The app runs in **benchmark mode** (`CS2D3K_BENCH=1`), which turns off vsync and Chromium's frame-rate cap. FPS therefore
shows real headroom rather than the monitor's 60/144 Hz. **FPS** is frames the browser actually presented per second;
**(p95)** is the 95th-percentile frame interval in ms. At 300 fps a frame takes 3.3 ms; at 60 fps it takes 16.7 ms.
Raw data: `bench/results/baseline.*` (before) and `bench/results/final.*` (after). Per-area runs:
`graph-after`, `canvas-before`, `canvas-after`.

## Can the graph render the Bible at a smooth 60 fps? Yes, with about 30–50× headroom

The Bible vault has the real structure: 66 books, 1,189 chapters and **31,102 verses as notes**, each linked to its
chapter and its neighbours. There are two cross-reference densities: ≈78k, and **≈340k**, which is the size of public
cross-reference datasets such as OpenBible.info.

| Bible vault | Nodes | Links | Pan | Zoom | Hover | While the layout settles (pan / zoom / hover) | Graph open | Layout settles |
|---|---|---|---|---|---|---|---|---|
| verses + 78k cross-refs | 32,362 | 141,066 | **2,972 fps (0.6 ms)** | **2,271 (0.8)** | **1,495 (1.2)** | 2,310 / 739 / 1,305 | 0.66 s | 6.0 s |
| verses + 340k cross-refs | 32,361 | 399,755 | **4,140 fps (0.5 ms)** | **2,682 (0.8)** | **1,148 (1.6)** | 1,159 / 471 / 966 | 0.84 s | 7.1 s |
| before (verses, old engine) | 32,357 | 57,518* | 12 fps (173 ms) | 12 | 12 | — | 36 s† | 99 s |

\* The old vault loader silently dropped ~75% of the files at this size (now fixed), so the old engine drew an
incomplete graph and was *still* at 12 fps.
† Partly a measurement artefact of the old harness. The real first frame was ~2 s.

## Under 10,000 notes, is it 300 fps or more? Yes, about 2,000–3,000 fps

| Scenario | Nodes / links | Pan before → after | Zoom before → after | Hover before → after | Draw + GPU per frame |
|---|---|---|---|---|---|
| 1k notes | 1k / 4k | 253 → **2,984** | 28 → **2,483** | 4 → **2,339** | 0.28 ms |
| 5k notes | 5k / 20k | 70 → **3,169** | 20 → **2,025** | 19 → **2,183** | 0.73 ms |
| 10k notes | 10k / 40k | 34 → **3,159** | 31 → **71‡ (p95 1.9 ms)** | 27 → **871** | 1.17 ms |
| Bible chapters | 1.3k / 6k | 199 → **3,146** | 23 → **2,348** | 1 → **2,490** | 1.00 ms |

‡ In this run, the 10k zoom sample hit a multi-second stall inside the GPU process (D3D11 command execution), which
pulled down the 3-second average. 95% of frames still finished in ≤1.9 ms, which works out to more than 500 fps. An immediate rerun
of the same case measured 337 fps (p95 1.5 ms). These stalls only show up in long uncapped runs on this machine; with vsync on they
are not visible.

Other graph timings: the graph opens in 0.44–0.5 s, the layout settles in 1.3–3.5 s (it was 26 s at 10k), and a new
link appears in the graph 270–360 ms after you type it.

## Canvas and form-map

| Scenario | Open | Pan before → after | Zoom before → after (in range) | Map lens switch (warm) |
|---|---|---|---|---|
| canvas 200 | 0.6 → 0.4 s | 25 → **1,761 (0.9 ms)** | 28 → **872** | — |
| canvas 1,000 | 2.6 → **0.4 s** | 6 → **1,932 (0.8)** | 3 → **893** | — |
| canvas 3,000 | **35.8 → 0.5 s** | 2 → **1,810 (0.9)** | 1 → **853** | — |
| form-map 300 | 0.9 → 0.8 s | 18 → **1,216 (1.3)** | 15 → **726** | 248 → **8 ms** |
| form-map 1,000 | 1.1 → 0.7 s | 6 → **1,166 (1.5)** | 3 → **735** | 647 → **18 ms** |
| form-map 3,000 | 2.6 → 0.8 s | 1 → **1,122 (1.4)** | 1 → **730** | 2,440 → **40 ms** |

Measured separately: panning at 0.8 zoom, where full cards are mounted, runs at 130–185 fps (p95 ≤ 16 ms) at 1k–3k
cards. The "zoom" column of the original sweep (about 103 fps) spends half its frames clamped at the zoom limits, where
nothing changes. The in-range sweep is the meaningful number.

## What was slow, and what changed

Profiling (`bench/profile.mjs`, CPU profiles and DevTools timeline traces) showed that **none of the slowness was
JavaScript**. It was the browser's GPU raster:
- The graph's Canvas 2D API recorded tens of thousands of path and text drawing operations per frame. The GPU process
  replayed them while the main thread waited (`RasterDecoderImpl`, `CommandBufferProxyImpl::WaitForToken`).
- Canvas and form-map repainted and re-rasterised every card on every pan.

**Graph** (`src/renderer/src/views/graph/`)
- **WebGL2 renderer.** Nodes, links and arrows are antialiased instanced quads. Positions are uploaded once per
  simulation tick, and hover and dimming are shader uniforms. There is a cached link layer for graphs with 60k+ links,
  and a Canvas 2D fallback.
- **Label texture atlas.** Each label is rasterised once and drawn as a textured quad, with the halo and colour applied
  in the shader. At most 600 labels are drawn, prioritised by hover neighbourhood, then focus, then degree.
- **Simulation in a Web Worker.** It is a typed-array port of d3-force's model, 4–5× faster and verified against d3 in
  unit tests. It starts from a multilevel initial layout, so the 32k-node Bible settles in about 6 s instead of 99 s, and
  the main thread is never blocked.
- **Spatial-grid hit testing, no per-frame allocations, and nothing drawn unless something changed.**

**Canvas and form-map** (`src/renderer/src/views/canvas/`, `views/formmap/`)
- **Viewport culling with a spatial grid.** Only cards in view plus a margin are mounted. Re-culling happens when the
  camera moves past half the margin or settles, never on every frame.
- **Compositor-only camera.** The world transform is applied imperatively, so React never re-renders all cards per
  frame, and the root's position on screen is cached instead of being re-measured on every event.
- **Level of detail.**
  - At or above 0.5 zoom: full cards, mounted progressively, nearest first.
  - Zoomed out, up to 100 cards in view: lightweight placeholders.
  - Zoomed out, more cards: a single world-space canvas draws the cards and edges, re-rendered only when content
    changes or a zoom settles.
- **Code cells** show static highlighted code; CodeMirror mounts only when you focus one.
- **Form-map.**
  - The Map lens stays mounted across lens switches.
  - The minimap draws on a `<canvas>` and is throttled.
  - Card actions come from a stable context, so dragging one card no longer re-renders all of them.
  - Coach checks and the why-trace went from O(N²)/O(N³) to linear. They ran on every drag move, and at 3,000 cards one
    check alone took about 450 million steps.

**Vault loading** (`src/main/`)
- **Bug fixed: `readAll` silently dropped ~75% of a 32k-note vault.** It opened every file at once and hit the open-file
  limit. It now reads 64 files at a time.
- **Bug fixed: the file watcher blocked the main process for 15–44 s.** Chokidar created one native watcher per file.
  It is replaced on Windows and macOS by a single recursive `fs.watch` with the same events.
- The Bible vault (32k notes, 141k links) is now **ready in about 4.8 s** with a warm OS file cache. That breaks down as
  0.4 s for the window, 1.3 s to list files and 4.3 s to index links. **A cold first open measured 40–50 s on this
  machine**, because Windows Defender scans every one of the 32k files the first time it is read; see suggestion 1.

## Recommended next optimizations and enhancements

1. **Persistent metadata cache.** Store parsed links, tags and headings in `.cs2d3k/cache` keyed by path, mtime and
   size. Startup would then only `stat` files and re-parse the ones that changed. This removes the cold-start cost on
   huge vaults (expected about 2 s for the Bible, cold or warm) and is the single biggest remaining win.
2. **Faster layout for huge graphs.** Split the many-body force across 2–3 workers or move it to WASM (SIMD), roughly
   halving the Bible's 6–7 s settle. Optionally save the settled layout per vault so re-opening the graph is instant.
3. **Label collision avoidance.** Labels can still overlap in dense areas. A screen-space greedy placement on the label
   grid would fix that.
4. **Render the graph from an `OffscreenCanvas` in the worker,** so jank anywhere else in the app can never touch graph
   frames.
5. **Huge graphs at deep zoom.** Skip links whose endpoints are both far off screen, which helps with 300k+ links.
6. **Canvas:** make edges drawn on the zoomed-out canvas layer clickable via geometric hit tests, and keep the Board lens
   mounted the way the Map lens now is (its warm switch is 417 ms at 3,000 cards).
7. **Run the perf budgets in CI.** `npm run test:perf` already runs in `.github/workflows/test.yml` on pushes. Consider a
   self-hosted runner with a GPU, so the graph budgets measure real GPU work.

## Reproduce

```bash
npm run build
node bench/run.mjs                       # everything (Bible vaults are generated once into bench/.cache)
node bench/run.mjs --only graph --case 10k
node bench/profile.mjs graph-zoom --trace # where does the time go?
npm run test:perf                        # the perf budgets that guard regressions
```
