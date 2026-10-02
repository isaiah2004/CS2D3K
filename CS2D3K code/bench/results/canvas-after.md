
### Graph

FPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.

| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Canvas / Form-map

| Scenario | Open | DOM nodes (mounted / total) | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Zoom in range FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|---|
| canvas 200 nodes | 595 ms | 0 / 200 | 1032 (1.5) | 103 (18.2) | 440 (4.1) | 11.5 | 20 MB |
| canvas 1000 nodes | 548 ms | 0 / 1000 | 1174 (1.2) | 104 (18.0) | 559 (2.4) | 11.4 | 18 MB |
| canvas 3000 nodes | 594 ms | 0 / 3000 | 1089 (1.3) | 103 (18.1) | 413 (3.8) | 12.8 | 33 MB |
| form-map 300 cards | 886 ms | 0 / 306 | 964 (1.5) | 724 (1.9) | 638 (2.0) | 17.1 | 21 MB |
| form-map 1000 cards | 763 ms | 0 / 1006 | 960 (1.5) | 703 (1.9) | 696 (2.0) | 15.9 | 26 MB |
| form-map 3000 cards | 797 ms | 0 / 3006 | 666 (1.8) | 702 (2.0) | 601 (2.1) | 18.6 | 44 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 6 ms | 31 ms | 7 ms | 9 ms | 82 ms | 12 ms |
| form-map 1000 cards | 13 ms | 45 ms | 5 ms | 9 ms | 178 ms | 20 ms |
| form-map 3000 cards | 12 ms | 115 ms | 5 ms | 11 ms | 495 ms | 40 ms |
