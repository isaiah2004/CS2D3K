
### Graph

| Scenario | Nodes | Links | Vault ready | Graph open | Settle | Draw avg / p95 | Sim FPS | Pan FPS (p95 ms) | Zoom FPS | Hover FPS | Update | Heap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| synthetic 1k | 1001 | 3981 | 2.0 s | 474 ms | 3.0 s | 0.64 / 0.90 ms | 104 | 253 (18.6) | 28 | 4 | 308 ms | 49 MB |
| synthetic 5k | 5000 | 19906 | 10.0 s | 693 ms | 13.2 s | 4.49 / 6.80 ms | 43 | 70 (31.4) | 20 | 19 | 351 ms | 39 MB |
| synthetic 10k | 10000 | 32801 | 13.2 s | 893 ms | 25.9 s | 9.47 / 14.50 ms | 22 | 34 (64.9) | 31 | 27 | 538 ms | 177 MB |
| Bible (chapters) | 1255 | 5931 | 3.9 s | 502 ms | 3.0 s | 0.57 / 0.90 ms | 120 | 199 (19.0) | 23 | 1 | 289 ms | 74 MB |
| Bible (verses + 78k xrefs) | 32357 | 57518 | 49.1 s | 36286 ms | 99.4 s | 22.33 / 27.90 ms | 6 | 12 (172.8) | 12 | 12 | 893 ms | 206 MB |

### Canvas / Form-map

| Scenario | Open | DOM nodes | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Drag ms/move | Heap |
|---|---|---|---|---|---|---|
| canvas 200 nodes | 609 ms | 200 | 25 (77.1) | 28 (78.3) | 59.2 | 22 MB |
| canvas 1000 nodes | 2593 ms | 1000 | 6 (447.7) | 3 (532.1) | 17.0 | 41 MB |
| canvas 3000 nodes | 35794 ms | 3000 | 2 (958.5) | 1 (1269.0) | 29.0 | 63 MB |
| form-map 300 cards | 860 ms | 306 | 18 (108.8) | 15 (166.4) | 8.3 | 36 MB |
| form-map 1000 cards | 1056 ms | 1006 | 6 (968.1) | 3 (931.7) | 6.6 | 78 MB |
| form-map 3000 cards | 2630 ms | 3006 | 1 (4120.2) | 1 (1861.0) | 15.9 | 179 MB |

| Form-map lens switch | Board | Table | Doc | Map | Board (warm) | Map (warm) |
|---|---|---|---|---|---|---|
| form-map 300 cards | 29 ms | 6 ms | 12 ms | 154 ms | 131 ms | 248 ms |
| form-map 1000 cards | 65 ms | 142 ms | 10 ms | 406 ms | 371 ms | 647 ms |
| form-map 3000 cards | 81 ms | 14 ms | 14 ms | 659 ms | 1095 ms | 2440 ms |
