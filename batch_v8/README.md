# Road geometry and parking edition

Open http://127.0.0.1:47850/ or run `batch_v8/launch.py` with the existing Earth Python environment. Version 7 remains at port 47849. The current uncommitted v7 driving fixes are copied into this edition; the v7 files are unchanged by this work.

## Geometry

Closely aligned OSM ways with explicit `width:carriageway` or `width` refine baseline widths. Ambiguous competing widths are skipped. Buffers and corner radii remain inferred. Historical Berlin `cm_fahrbahn` carriageway polygons replace ribbons inside the observed survey street space, keeping survey pavement and parking areas out of the carriageway. Available ground-level OSM `area:highway` polygons contribute actual outlines outside that historical survey domain. No polygons are extrapolated to other junctions. Buildings remain excluded. Material coverage from the baseline is retained inside the new footprints; survey codes or asphalt fill uncovered extensions with explicit inferred fallbacks.

Road material coverage, pavement clipping, kerbs and paint use the resulting footprint. Browser ground contact uses generated road polygons rather than only centreline widths. Copied RacingVibes physics and the v7 driving fixes remain in use.

## Parking

Modern `parking:left/right/both` and legacy `parking:lane:*` identify presence and orientation. Lane parking stays inside explicit carriageway widths; insufficient remaining travel width and missing carriageway widths are skipped. Side direction follows OSM way direction in the south-positive scene frame. Junctions, crossings/control paint, buildings, pavements and driveway approaches exclude parking.

Separately mapped parking areas and individual spaces have priority over inferred lane strips. Street-side parking relies on mapped area geometry; no strip is extended into an unmapped yard or pavement. Surface families follow tags, with asphalt as an inferred fallback. `no`, `separate`, on-kerb and unsupported positions do not create inferred lanes.

Markings require explicit `markings=yes` or side-specific parking marking evidence. This establishes some marking, not necessarily a white painted boundary: white lines and repeated bay sizes/layouts are illustrative approximations. Marked narrow single-row polygons support parallel, perpendicular and diagonal layouts. Large/multi-row areas are skipped rather than guessing aisles; individual mapped spaces can still be outlined. Unmarked parking retains its surface without invented bay paint. Restrictions are retained in source tags but not simulated. No parked vehicles, traffic AI or new street furniture are added.

## Reproducibility and checks

`geometry-v8.4` has its own frozen source hashes, cache and ignored `custom/` jobs. Earlier editions are preserved. `development-v8.1/` retains the initial source identity; its three jobs failed before generation because the generic module name collided with an installed adapter. These are not successful renders.

Each successful job retains map/survey inputs, `geometry-report.json`, `parking-report.json`, inherited pavement/site/street reports, logs and nine hashed 2048-square tiles. Rendering does not establish real-world visual accuracy. Berlin survey data dates from 2014/2015.

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v8/launch.py
& $earthPython -m unittest discover -s batch_v8 -p 'test_*.py'
& $earthPython batch_v8/audit.py
node batch_v8/test_signals.cjs
node batch_v8/test_spawn.cjs
node batch_v8/test_ground.cjs
node batch_v8/verify.cjs
node batch_v8/verify_driving.cjs
& $earthPython batch_v8/stop.py
```

## Sources

OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright . Parking tag interpretation: https://wiki.openstreetmap.org/wiki/Street_parking . Historical Berlin survey, dl-de-zero-2.0: https://gdi.berlin.de/services/wfs/strassenbefahrung . Inherited Overture, WorldCover, Meta/WRI canopy, Poly Haven CC0 material and copied vehicle/runtime attribution remains in [v7](../batch_v7/README.md) and its linked earlier editions. No new material downloads or dependency stack.

`development-v8.2/` retains the initial rendered geometry/parking implementation. Visual comparison found that historical geometry also replaced mapped sett with asphalt; v8.3 separates footprint evidence from retained baseline surface coverage. Superseded builds and logs remain under custom/.

Generation acceptance rejects any rendered parking record identified as underground, multistorey, rooftop or enclosed, even if its location/level tags were omitted. These unsupported scenes fail with a diagnostic rather than publishing ground-level parking incorrectly. The acceptance check does not alter frozen geometry or material output.

## Historical v8.3 checks and their limits

59 Python tests and the JavaScript signal/spawn/ground checks pass. All three `geometry-v8.3` jobs reached `built`: Kreuzberg, London/Trafalgar Square and New York/Broadway. The audit verifies all 27 tile hashes/dimensions, polygon/material containment and all seven earlier frozen renderer identities. `audit.json` and `unit-verification.json` contain the fresh results.

The browser tour passes driving with all four vehicles, pause/recovery, scene switching, reload/cache, controlled missing-tile failure/retry, picker pending/failure/retry and real New York place search. Picker pending/failure is mocked in that tour; a separate actual Kreuzberg keyboard drive ran while London was generating. The driving regression compares all four vehicles with the read-only RacingVibes reference (zero trajectory mismatch on its controlled fixture), then exercises actual driving, collision, pause, recovery and reload. See `verification.json`, `driving-verification.log` and `signal-verification.json`. After a real stop/relaunch, all three scenes loaded nine tiles again (`restart-verification.json`). No Android or worldwide visual acceptance is claimed.

`comparison.json` reports matching-origin measurements against retained v7 scenes. Kreuzberg has about 232.5 square metres of changed road footprint, 683.6 square metres of parking surfaces and 7.4 square metres of bay paint in the playable area. Pavement coverage is essentially retained. London and Broadway road footprints are unchanged where new geometric evidence is insufficient. Broadway has about 1300 square metres of mapped parking surface without bay paint. These parking surface areas include areas already rendered by the sites edition; they are not all new hardstanding. Exact OSM source snapshots differ, so comparisons do not isolate the renderer alone.

The gallery includes a Kreuzberg before/after view. `visual-review.json` records the visual review and retained limitations, including inherited gaps in the London result. These are targeted integration samples, not complete reconstructions of present-day streets.

## v8.4 mesh repair

The v8.3 visual review wrongly accepted large triangular gaps in London and Broadway. The earlier audit checked source polygons/material ownership but did not check the rendered triangle meshes. Its passing results do not establish correct rendered coverage. `development-v8.3/` preserves that renderer and its evidence; its custom outputs remain retained.

The cause was unconstrained Delaunay triangulation followed by discarding triangles crossing concave boundaries. v8.4 uses boundary-constrained tessellation for every flat surface, and clips/retriangulates sampled roof triangles instead of dropping them. Road, pavement, ground, parking, paint, roof outlines and courtyard holes are checked against actual mesh-face coverage. Preparation rejects missing or outside mesh area beyond a small floating-point tolerance. The audit independently recomputes these checks from saved mesh faces.

No geometry source, surface family, road width or traffic-marking inference is changed by this fix. Completed older scenes remain playable while replacement jobs build; saved links to retained builds continue to work. The dropdown switches to the current renderer once that location is built.

## Fresh v8.4 verification

All three replacements reached `built` using the same surface footprints as v8.3. The retained-snapshot comparison (`mesh-repair-verification.json`) measures missing asphalt dropping from 1272.713 square metres to zero in London, and from 1434.824 square metres to zero on Broadway, inside the playable area. Missing pavement/ground/material triangles are repaired by the same tessellation change. These are mesh-coverage measurements, not new mapped geometry or real-world accuracy claims.

The independent audit checks 141 flat surface meshes, 211 roof meshes and all 27 tile hashes/dimensions. Maximum missing/outside mesh areas are below 1e-10 square metres (floating-point noise). Preparation also enforces coverage before Blender runs. 67 Python tests pass, including actual London/Broadway footprint regression fixtures and concave/hole/roof/coverage-failure cases. Earlier renderer source hashes and the preserved v8.3 source snapshot also verify.

The viewer now stitches nine 2048-square tiles into one 6144-square atlas at exact pixel positions instead of stretching individual tiles. Decoded tile images are released after composition; the steady-state raster storage remains about 144 MiB, with an extra atlas allocation during composition. The fractional-zoom pixel test matches a continuous reference raster exactly and verifies disposal (`tile-seam-verification.json`).

Fresh browser checks pass all three locations, all four vehicles, driving/pause/recovery, reload/cache, live place search, missing-tile retry, picker pending/failure/retry, scene switching, signal phases and the copied RacingVibes trajectory regression. Picker pending/failure is mocked in the browser tour. After a real server restart, all three scenes reload nine tiles. Old v8.3 location links select their v8.4 replacement; the heading shows GEOMETRY V8.4. See `verification.json`, `signal-verification.json`, `driving-verification.log` and `restart-verification.json`.

The gallery presents matched London and Broadway before/after images. The original screenshots supplied by the user were not edited. `visual-review.json` records the new review; the former acceptance of the visible gaps is explicitly superseded.

Additional checks:

```powershell
& $earthPython batch_v8/verify_mesh_repair.py
node batch_v8/verify_tile_seams.cjs
```

Boundary-constrained triangulation uses the existing local Shapely 2.2 / GEOS 3.14 environment, without adding dependencies: https://shapely.readthedocs.io/en/stable/reference/shapely.constrained_delaunay_triangles.html .
