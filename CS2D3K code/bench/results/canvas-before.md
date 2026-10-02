
### Graph

| Scenario | Nodes | Links | Vault ready | Graph open | Settle | Draw avg / p95 | FPS while settling | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Hover FPS (p95 ms) | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

### Canvas / Form-map

| Scenario | Open | DOM nodes | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|
| canvas 200 nodes | 590 ms | 200 | 42 (36.9) | 49 (42.7) | 33.0 | 23 MB |
| canvas 1000 nodes | 1824 ms | 1000 | 7 (188.5) | 15 (192.9) | 20.9 | 39 MB |
| canvas 3000 nodes | 22764 ms | 3000 | 1 (1045.5) | 1 (1434.9) | 18.6 | 62 MB |
| form-map 300 cards | 892 ms | 306 | 53 (35.1) | 113 (27.8) | 7.8 | 37 MB |
| form-map 1000 cards | 1095 ms | 1006 | 23 (80.2) | 14 (494.2) | 9.7 | 64 MB |
| form-map 3000 cards | 2386 ms | 3006 | 4 (1247.3) | 3 (986.8) | 6.3 | 124 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 17 ms | 4 ms | 5 ms | 84 ms | 128 ms | 189 ms |
| form-map 1000 cards | 59 ms | 8 ms | 12 ms | 636 ms | 385 ms | 959 ms |
| form-map 3000 cards | 180 ms | 18 ms | 15 ms | 1519 ms | 1290 ms | 2324 ms |
