
### Graph — old Canvas 2D engine (out-graphbase) measured with the current harness

Same machine and harness as graph-after.md (via the harness compatibility shim for the pre-WebGL engine). Synthetic and chapter-level vaults only: the old build indexes at most ~8k notes of a vault (EMFILE bug in readAll), so its verse-level Bible graph is incomplete (57k of 141k links) and not comparable.

FPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.

| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 1k | 1008 | 3995 | canvas2d | 5.8 s | 432 ms | 3.0 s | 5.58 / 6.70 ms | 127 (18.2) / 211 | 122 (10.0) | 10 (386.6) | 34 (193.7) | 44 (27.2) / 6 (478.6) / 83 (14.4) | 341 ms | 71 MB |
| synthetic 5k | 5005 | 19915 | canvas2d | 26.3 s | 591 ms | 6.9 s | 26.55 / 30.00 ms | 89 (22.5) / 30 | 36 (30.7) | 11 (483.3) | 3 (451.0) | 10 (122.9) / 3 (658.0) / 0 (1889.8) | 552 ms | 72 MB |
| synthetic 10k | 10006 | 32778 | canvas2d | 5.7 s | 631 ms | 14.1 s | 38.62 / 41.50 ms | 43 (58.8) / 14 | 25 (43.3) | 18 (76.0) | 31 (85.8) | 6 (240.7) / 7 (206.5) / 16 (102.3) | 627 ms | 85 MB |
| Bible (chapters) | 1260 | 5941 | canvas2d | 6.9 s | 433 ms | 3.0 s | 7.82 / 8.30 ms | 122 (18.3) / 168 | 95 (12.1) | 11 (365.0) | 18 (230.0) | 47 (36.0) / 6 (352.2) / 66 (17.3) | 350 ms | 93 MB |
