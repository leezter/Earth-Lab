# Street details edition

Open http://127.0.0.1:47851/ or run `batch_v9/launch.py` with the existing Earth Python environment. The previous v8.4 geometry edition remains on port 47850. This independent edition preserves its boundary-constrained triangulation, actual mesh-coverage gates, tile atlas and copied driving integration.

## Cycle and bus lanes

Supported `cycleway:left/right/both=lane` and generic lane tags create reserved bands inside the carriageway, respecting parking-lane space and explicit side overrides. Track/separate/shared-busway tags do not invent a second on-road cycle lane. Widths use mapped values or labelled defaults; insufficient remaining travel width is skipped. OSM way direction and the inherited regional driving-side approximation guide orientation, including reverse one-way tags.

Bus/PSV `:lanes` arrays support one-way streets and explicit forward/backward counts on two-way streets. Only `designated` entries create a bus lane. Count mismatches, implausible widths and ambiguous directional layouts are skipped. Explicit side-specific legacy busways are also supported; a generic legacy busway is used only on unambiguous one-way roads.

Generic white cycle symbols, BUS lettering and boundary lines have inferred physical presence/layout. Junction and mapped control/crossing areas suppress paint. Longitudinal dividers and turn arrows are clipped outside reserved lanes. `lane_markings=no` suppresses inferred paint. Surface/colour layers are added only when supported by lane surface/colour tags; otherwise the inherited road finish stays visible. Derived lane overlays use the existing millimetre export precision to avoid near-coincident geometry failures. Conditional access is retained in source tags but not animated or enforced. Bus-bay layouts, protected lane separators and every possible lane-tag scheme are outside this edition.

## Refuges and crossing approaches

Mapped `area:highway=traffic_island` outlines have priority. Island footways and `crossing:island=yes` nodes can create bounded inferred refuge outlines; `separate`, absent island tags and unsuitable narrow roads do not invent one. Existing pavement materials are retained where already covered. Refuge space is removed from the driving footprint, added to pedestrian surfaces and given kerb edges.

Lowered/flush/no-kerb tags create approach patches where they can be associated with a road edge and pedestrian space. A crossing-centre kerb tag can imply both edge locations; those locations, dimensions and slopes are inferred. Explicit tactile presence adds a generic buff studded warning pad behind the approach. Crossing presence alone creates neither ramps nor tactile paving. Furniture is kept away from ramps and tactile pads. These ramp heights are baked visual geometry; vehicle physics remains flat and does not simulate accessibility or suspension.

## Furniture

Ground-level mapped bollards, bicycle parking stands, bus stops/platforms, public-transport shelters, benches and waste baskets use authored Blender prefabs. A bus stop alone does not invent a shelter; `shelter=yes` or a separately mapped shelter is needed. One representative bicycle stand is placed rather than converting capacity into an invented rack layout. Unsupported rack types, indoor/layered objects, carriageway obstructions (except mapped bollards), building/boundary conflicts and unsuitable pedestrian placements are skipped. Stop poles, area representative points, inferred shelter offsets, dimensions, headings and prefab material/style are approximate. Furniture footprints join the existing static scenery collision layer. No traffic vehicles or pedestrians are spawned.

## Reproducibility and checks

`mobility-v9.4` has separate frozen inputs, output IDs and cache. Earlier editions and their generated scenes remain untouched. Jobs retain the existing source/provenance, geometry, mesh-coverage reports, material reports and nine hashed tiles, plus `mobility-report.json`, `access-report.json`, `furniture-report.json` and `furniture-assets.json`. Source-probe folders are diagnostics, not accepted builds.

90 Python tests pass before scene builds, including lane direction/count/parking reservation, mapped-colour/paint containment, actual v8 road-hole regression fixtures, refuge/ramp/tactile evidence, parser retention, furniture placement and collision-footprint cases. `street-access-kit.blend` and `street-access-kit.png` are an editable Blender construction reference. Its successful build/render checks prefab construction and symbols, not geographic accuracy. Generation acceptance and the audit retain actual surface/roof mesh coverage gates.

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v9/launch.py
& $earthPython -m unittest discover -s batch_v9 -p 'test_*.py'
& $earthPython batch_v9/audit.py
node batch_v9/verify.cjs
node batch_v9/verify_signals.cjs
node batch_v9/verify_driving.cjs
node batch_v9/verify_tile_seams.cjs
& $earthPython batch_v9/stop.py
```

After generating `mobility-symbols.json` from the authored symbol functions, the reference kit can be rebuilt with the pinned Blender using `--background --factory-startup --python-exit-code 1 --python batch_v9/verify_mobility_assets.py`.

## Sources and limits

OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright . Lane/access tag references: https://wiki.openstreetmap.org/wiki/Bus_lanes , https://wiki.openstreetmap.org/wiki/Key:cycleway:lane , https://wiki.openstreetmap.org/wiki/Key:crossing:island , https://wiki.openstreetmap.org/wiki/Key:kerb , https://wiki.openstreetmap.org/wiki/Key:tactile_paving . Inherited Overture, WorldCover, Meta/WRI canopy, historical Berlin survey (2014/2015, dl-de-zero-2.0), Poly Haven CC0 material and copied RacingVibes runtime credits remain in [v8](../batch_v8/README.md) and its linked earlier editions. No new texture downloads, dependency stack or installed-adapter changes.

Mapping is incomplete. Historical survey footprints can conflict with present-day lane tags; clipping/skip reports expose unsupported cases. Four targeted locations and a model kit do not establish worldwide visual acceptance, Android acceptance or surveyed lane/furniture accuracy. Signal phases remain illustrative; driving restrictions are not enforced.

`development-v9.1/` retains the first source identity and the audit failure. Its first completed scene failed because mapped refuge geometry overlapped protected tree-pit holes outside the playable centre. Pending jobs were superseded. Version 9.2 preserves those holes, aligns ramp material ownership with exported pavement polygons, and runs spatial/material checks before Blender. No v9.1 build is claimed as accepted.

Pavement/ramp ownership uses one shared millimetre grid before export; protected tree-pit holes and the canonical pedestrian footprint constrain the new patches. Spatial/material validation runs before roof/flat-mesh preparation and Blender, with the independent completed-scene audit retained afterwards.

`development-v9.2/` retains the corrected spatial renderer and its successful checks. Final visual review found touching BUS letter strokes; v9.3 separates the three glyph components while keeping the word within supported bus-lane widths. The current renderer has a new output identity.

## Fresh v9.3 delivered checks

All five jobs reached `built`: Kreuzberg, Schlesische Straße, London/Trafalgar Square, Broadway, and an additional mapped bus-stop shelter near Cockspur Street. The shelter example was selected from retained mapping evidence and generated by the same frozen renderer without per-scene geometry changes. Kreuzberg remains in the dropdown.

90 Python tests pass, together with JavaScript signal/spawn/ground checks. The independent audit verifies 45 tile hashes/dimensions, 262 flat meshes, 382 roof meshes, material containment, protected tree pits, access exclusions and all eight earlier frozen editions. Mesh discrepancies remain at floating-point noise levels (`audit.json`). All six furniture prefabs and the ramp/refuge/tactile/symbol references build and render in the editable Blender kit. The BUS test checks three separate letter components, a 0.1075 m minimum gap and 2.0375 m word width within the supported minimum 2.2 m bus lane (`bus-marking-verification.json`).

The five-location Edge tour passes actual keyboard driving, all four vehicles, pause/recovery, switching, reload/cache, missing-tile retry and place search. Picker pending/failure/retry uses a mocked job in that tour. `pending-verification.json` separately records actual driving on a retained v9.2 scene while a v9.3 replacement was rendering, without submitting another job. Copied RacingVibes trajectories match for all four vehicles on the controlled fixture, followed by actual-scene collision/driving/pause/recovery/reload checks (`driving-verification.log`). Signal lifecycle and the exact-pixel tile-atlas test pass.

After a real stop/relaunch, all five v9.3 scenes load nine tiles again, old location links select their current replacement and all six gallery images load (`restart-verification.json`). The server remains available on port 47851. These are local cached-source builds, not cold worldwide download timings or Android acceptance.

Start with Schlesische Straße for cycle lanes, Broadway for BUS markings, Trafalgar Square for crossing approaches, Kreuzberg for furniture, or the separate London shelter sample. The gallery includes actual examples and the authored model kit. Missing or ambiguous evidence remains omitted or explicitly inferred. Current survey-source and corner-layout limitations remain. `visual-review.json` records the targeted review.

## World map location picker

The driving page at http://127.0.0.1:47851/ includes a collapsible world map. Pan and zoom to a street, click to select a point, then press **Generate 192 m area**. Keyboard users can focus the map, pan with arrow keys, zoom with +/−, and press **Select map centre**. Search results and latitude, longitude input also place the selection on the map. **World view** returns to the global overview.

The marker and approximate 192 m outline show the requested location; the existing worker snaps the centre to a nearby driving road. Generation supports latitudes within ±84 degrees and needs usable mapped roads and source data. It runs in the existing serial job queue, keeps the current scene playable, exposes failures for retry, and offers **Drive generated area** only after the job is built. Selecting another point does not cancel an already submitted job.

Leaflet 1.9.4 is bundled under `web/vendor/leaflet/` with its BSD licence. Visible map tiles are requested directly from OpenStreetMap, with attribution and normal browser caching; internet is required for the basemap. Search/coordinate entry remains available if tiles fail. Tile usage policy: https://operations.osmfoundation.org/policies/tiles/ . This picker does not change the frozen renderer or generated scene identity.

## Enclosed parking fix (v9.4)

The v9.3 parking compiler could interpret a mapped multi-storey car park as a ground parking surface when its source lacked explicit layer/location tags. The independent publication check then correctly rejected the entire location. This happened for the Leeds map selection at 53.797419, -1.543827: the surrounding source query includes Q-Park Criterion Place (OSM way 155224833, tagged `parking=multi-storey`, `building=yes`). Retrying the same v9.3 job cannot repair that classification.

Version 9.4 applies the existing site-surface eligibility rules to parking polygons before producing surface or paint geometry. Enclosed and non-ground parking is omitted, with source IDs, tags and reasons in `parking-report.json` (`omitted` and `skipped`). Ordinary surface parking is retained. The independent rejection check remains unchanged; this does not add underground driving or multi-storey parking simulation. Mapped building geometry continues through the existing building pipeline.

`development-v9.3/` preserves the previous freeze, changed source and prior reports. Existing jobs and tiles retain their original identities; resubmitting a failed location creates a v9.4 job. The 93-test Python suite includes enclosed parking kinds, building tags, non-ground tags, mixed surface/enclosed cases, paint exclusion and retained publication rejection.

The exact Leeds selection now reaches `built` as `place-68589f850de63256` in 225 seconds using retained map sources. It keeps the original road snap (about 97 m). The independent audit verifies all nine 2048-square tiles, meshes/materials and all eight earlier edition freezes (`audit.json`). A fresh Edge check confirms the old failed link resolves to the replacement, map submission reuses the completed build, all nine tiles load, and driving/pause/recovery/reload work without page errors (`parking-fix-verification.json`). This is one local regression build, not worldwide visual acceptance. Prior v9.3 reports remain in `development-v9.3/`.
