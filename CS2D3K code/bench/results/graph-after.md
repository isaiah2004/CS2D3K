
### Graph

FPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.

| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 1k | 1007 | 3993 | webgl2 | 1.0 s | 469 ms | 3.0 s | 0.50 / 0.70 ms | 671 (17.3) / 191 | 2237 (0.7) | 1488 (1.1) | 1428 (1.1) | 1822 (0.8) / 1578 (1.1) / 1523 (1.2) | 285 ms | 22 MB |
| synthetic 5k | 5004 | 19913 | webgl2 | 15.0 s | 514 ms | 3.0 s | 1.03 / 1.50 ms | 1537 (0.8) / 49 | 2740 (0.6) | 1323 (1.6) | 991 (1.6) | 1145 (1.4) / 1071 (2.1) / 1232 (1.6) | 319 ms | 34 MB |
| synthetic 10k | 10005 | 40029 | webgl2 | 30.4 s | 549 ms | 3.5 s | 1.19 / 1.30 ms | 1509 (0.5) / 5 | 3434 (0.4) | 89 (1.9) | 888 (1.0) | 1688 (0.7) / 617 (2.8) / 1132 (1.9) | 361 ms | 95 MB |
| Bible (chapters) | 1259 | 5939 | webgl2 | 3.7 s | 477 ms | 3.0 s | 0.73 / 0.90 ms | 783 (17.2) / 213 | 1948 (0.8) | 1714 (1.0) | 1502 (1.0) | 1535 (1.0) / 1560 (1.0) / 1474 (1.3) | 284 ms | 21 MB |
| Bible (verses + 78k xrefs) | 32361 | 141064 | webgl2 | 64.9 s | 677 ms | 6.2 s | 5.79 / 13.10 ms | 2881 (0.6) / 12 | 2759 (0.6) | 2312 (0.8) | 1553 (1.2) | 2356 (0.6) / 483 (2.9) / 1643 (1.4) | 549 ms | 129 MB |
| Bible (verses + 340k xrefs) | 32360 | 399753 | webgl2 | 6.1 s | 829 ms | 7.5 s | 15.16 / 16.50 ms | 3314 (0.5) / 9 | 2633 (0.6) | 2785 (0.7) | 1251 (1.2) | 1588 (1.0) / 455 (2.8) / 928 (2.0) | 828 ms | 202 MB |

### Canvas / Form-map

| Scenario | Open | DOM nodes (mounted / total) | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Zoom in range FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|---|
