
### Graph

FPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.

| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 1k | 1010 | 3998 | webgl2 | 1.1 s | 437 ms | 3.0 s | 0.28 / 0.40 ms | 897 (2.3) / 219 | 2984 (0.5) | 2483 (0.6) | 2339 (0.7) | 2573 (0.6) / 2414 (0.7) / 2615 (0.6) | 274 ms | 19 MB |
| synthetic 5k | 5006 | 19917 | webgl2 | 3.4 s | 468 ms | 3.0 s | 0.73 / 1.00 ms | 1240 (0.7) / 62 | 3169 (0.4) | 2025 (0.5) | 2183 (0.6) | 2253 (0.4) / 3011 (0.7) / 2639 (0.8) | 305 ms | 67 MB |
| synthetic 10k | 10008 | 40035 | webgl2 | 1.9 s | 495 ms | 3.0 s | 1.17 / 1.30 ms | 1648 (0.5) / 46 | 3159 (0.4) | 71 (1.9) | 871 (0.8) | 1356 (0.6) / 753 (2.0) / 1732 (1.1) | 361 ms | 96 MB |
| Bible (chapters) | 1261 | 5943 | webgl2 | 1.4 s | 454 ms | 3.0 s | 1.00 / 1.30 ms | 741 (17.4) / 211 | 3146 (0.5) | 2348 (0.6) | 2490 (0.6) | 2761 (0.5) / 2225 (0.7) / 2355 (0.7) | 289 ms | 30 MB |
| Bible (verses + 78k xrefs) | 32362 | 141066 | webgl2 | 50.1 s | 656 ms | 6.0 s | 6.39 / 9.20 ms | 3376 (0.5) / 13 | 2972 (0.6) | 2271 (0.8) | 1495 (1.2) | 2310 (0.6) / 739 (2.4) / 1305 (1.4) | 589 ms | 218 MB |
| Bible (verses + 340k xrefs) | 32361 | 399755 | webgl2 | 40.3 s | 836 ms | 7.1 s | 13.83 / 19.70 ms | 2981 (0.6) / 11 | 4140 (0.5) | 2682 (0.8) | 1148 (1.6) | 1159 (1.4) / 471 (2.7) / 966 (1.9) | 803 ms | 278 MB |

### Canvas / Form-map

| Scenario | Open | DOM nodes (mounted / total) | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Zoom in range FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|---|
| canvas 200 nodes | 443 ms | 0 / 200 | 1761 (0.9) | 102 (18.7) | 872 (1.8) | 10.8 | 19 MB |
| canvas 1000 nodes | 446 ms | 0 / 1000 | 1932 (0.8) | 103 (18.7) | 893 (1.8) | 10.3 | 18 MB |
| canvas 3000 nodes | 524 ms | 0 / 3000 | 1810 (0.9) | 103 (18.8) | 853 (1.8) | 12.3 | 34 MB |
| form-map 300 cards | 772 ms | 0 / 306 | 1216 (1.3) | 863 (1.6) | 726 (1.8) | 11.5 | 21 MB |
| form-map 1000 cards | 712 ms | 0 / 1006 | 1166 (1.5) | 841 (1.7) | 735 (1.7) | 11.7 | 35 MB |
| form-map 3000 cards | 757 ms | 0 / 3006 | 1122 (1.4) | 851 (1.7) | 730 (1.8) | 13.2 | 55 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 12 ms | 25 ms | 7 ms | 17 ms | 57 ms | 8 ms |
| form-map 1000 cards | 11 ms | 28 ms | 4 ms | 7 ms | 124 ms | 18 ms |
| form-map 3000 cards | 12 ms | 88 ms | 4 ms | 9 ms | 417 ms | 40 ms |
