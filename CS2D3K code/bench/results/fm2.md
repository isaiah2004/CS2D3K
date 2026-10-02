
### Graph

FPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.

| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Canvas / Form-map

| Scenario | Open | DOM nodes (mounted / total) | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Zoom in range FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|---|
| form-map 300 cards | 698 ms | 0 / 306 | 1074 (1.4) | 774 (1.8) | 668 (1.9) | 11.2 | 24 MB |
| form-map 1000 cards | 705 ms | 0 / 1006 | 1082 (1.5) | 688 (2.1) | 621 (2.1) | 12.5 | 32 MB |
| form-map 3000 cards | 772 ms | 0 / 3006 | 1017 (1.4) | 741 (1.9) | 651 (2.0) | 15.9 | 54 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 7 ms | 5 ms | 39 ms | 10 ms | 73 ms | 10 ms |
| form-map 1000 cards | 7 ms | 29 ms | 4 ms | 6 ms | 195 ms | 24 ms |
| form-map 3000 cards | 8 ms | 30 ms | 4 ms | 10 ms | 171 ms | 27 ms |
