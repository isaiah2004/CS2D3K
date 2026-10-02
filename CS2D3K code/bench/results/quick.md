
### Graph

| Scenario | Nodes | Links | Vault ready | Graph open | Settle | Draw avg / p95 | Sim FPS | Pan FPS (p95 ms) | Zoom FPS | Hover FPS | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 1k | 1000 | 3979 | 3.7 s | 438 ms | 2.3 s | 0.59 / 0.70 ms | 143 | 269 (18.5) | 56 | 5 | 2633 ms | 63 MB |

### Canvas / Form-map

| Scenario | Open | DOM nodes | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|
| canvas 200 nodes | 553 ms | 200 | 33 (62.7) | 31 (69.3) | 17.2 | 21 MB |
| form-map 300 cards | 860 ms | 306 | 18 (106.6) | 7 (257.7) | 14.1 | 36 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 18 ms | 6 ms | 5 ms | 85 ms | 138 ms | 247 ms |
