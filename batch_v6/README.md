# Sites and boundaries edition

Open http://127.0.0.1:47848/ or run `batch_v6/launch.py` with the existing Earth Python environment. `/gallery.html` shows the edition and local samples. The pavement edition remains on 47847, with its source hashes and scenes preserved.

## Scope

This edition adds the first two items from the next-step list: mapped parking/yard/forecourt/courtyard ground and property boundaries. It retains the v5 pavement compiler, road/roof materials, nine 2048-square baked tiles, 192 m playable square, location search and persistent serial jobs. It does not add mapped tree placement, crossings, road markings, cycle tracks, street furniture or parked cars.

Surface geometry comes from closed OSM ways/complete area relations and, when installed, Berlin's historical parking polygons. Parking spaces are ground polygons only: no bay paint or arrangement is inferred. Underground, rooftop, multi-storey and building parking are excluded. A parking point cannot establish a footprint and is not expanded into an invented area.

Parking without a usable surface tag has an explicitly inferred asphalt finish. Yards, courtyards and fuel/car-wash forecourts require a usable explicit surface tag. Industrial land use alone does not justify covering a plot in concrete. Unsupported/unknown surfaces outside parking remain unchanged and are counted in the report. Broad mapped plots are clipped against buildings, carriageways, pavements, water, tree pits and mapped grass/gardens/woodland. New ground overrides coarse raster land cover and inferred courtyard gardens; procedural trunks are excluded from it.

Only mapped wall, fence and hedge lines establish property boundaries. Parcel edges are not generated from building or industrial plot outlines. Height, thickness, finish and colour use mapped values when supported, otherwise recorded defaults. Walls have physical thickness and coping; fences use posts/rails/uprights, with timber slats when mapped; hedges use clustered foliage volumes. Exact fence construction and masonry are approximations, even when a broad material category is mapped. Retaining-wall elevation and unsupported barrier types are not simulated.

Mapped gate/entrance nodes cut openings in connected boundary lines. A gate axis must be established by a boundary line or a highway sharing its OSM node. Unattached gates with unknown orientation are reported and skipped. Gate leaves are depicted open as an **inferred display pose**, not a claim about their actual current state. Gate posts/leaves are decorative. Wall/fence/hedge footprints are used by the existing 2D collision system; car spawning/recovery excludes those footprints. Vehicle physics code is unchanged. The viewer now samples the new site polygons for existing approximate asphalt, concrete/paving, gravel and earth grip families; unknown background ground keeps its prior behaviour.

## Evidence and sources

`pavement_sources.py` now retains site polygons, barrier ways, barrier nodes and their highway-node connections from a bounded OSM API query. Incomplete area relations are marked and not used for site geometry. The edition has an independent cache identity; it does not reuse the v5 cache's reduced feature schema.

Berlin's existing survey database is opened read-only and includes `ck_parkflaeche` parking alongside the v5 pavement layers. Only pavement layers are passed to the inherited pavement compiler. The survey dates from **2014/2015** and can disagree with later street changes. Existing adapters, their configuration and their databases are never modified.

Each ignored `custom/place-*/` retains full normalised source evidence in the legacy-named `pavement-inputs.json`, plus `site-report.json`, `pavement-report.json`, district data, geometry, logs, roof finishes, `boundary-assets.json` and tile hashes. Reports distinguish mapped geometry from inferred dimensions/appearance and list skipped unsupported features. Surface ownership uses exclusive material unions; record areas can overlap within a single material group.

`freeze.json` versions the new renderer and pins its sources, the shared backend and material manifest. Rendering changes require another version/cache identity; saved evidence is never updated to imply an unrun test. Closing the browser does not stop the server. Custom generation keeps the current scene playable and switches only after completion and user selection.

## Commands and verification

From the repository root in PowerShell:

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v6/launch.py
& $earthPython batch_v6/test_sites.py
& $earthPython batch_v6/test_boundary_geometry.py
& $earthPython batch_v6/test_pavements.py
& $earthPython batch_v6/test_pavement_sources.py
& $earthPython batch_v6/test_road_types.py
& $earthPython batch_v3/test_roof_styles.py
& $earthPython batch_v6/audit.py
node batch_v6/verify.cjs
node batch_v6/test_spawn.cjs
node batch_v6/test_ground.cjs
& $earthPython batch_v6/stop.py
```

Geometry tests cover protected areas, unknown surfaces, non-ground parking, material precedence, vegetation exclusion, gate gaps/axes and dimensions. The audit checks all frozen editions, tile hashes/dimensions, ground coverage/overlap and boundary collision footprints. It records raw rounding differences and uses the existing 2 mm ring-quantisation tolerance and 0.03 m² disconnected-island export cutoff. It needs local completed scenes and reports zero scene checks if none exist.

The browser tour checks actual driving, vehicles, pause/recovery, switching, cache/reload and tile/picker failure/retry. Picker lifecycle uses a controlled mocked job; `verify_pending.cjs` separately exercises driving while another actual generation is pending. First builds, cached generation reuse and browser readiness are separate measurements. Desktop verification is not Android or worldwide visual acceptance.

## Attribution

- OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright . Feature references: https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dparking , https://wiki.openstreetmap.org/wiki/Key:barrier , https://wiki.openstreetmap.org/wiki/Tag:man_made%3Dcourtyard . Coverage varies; map tags do not establish current real-world condition.
- Geoportal Berlin, Straßenbefahrung 2014/2015, **dl-de-zero-2.0**, retained local database retrieved 25 October 2026. Source: https://gdi.berlin.de/services/wfs/strassenbefahrung . Material codes: https://gdi.berlin.de/data/strassenbefahrung/docs/Datenformatbeschreibung_Stra%C3%9Fenbefahrung_2014.pdf . Geometry is transformed/clipped and finishes approximated.
- **Powered by Poly Haven**, CC0; https://polyhaven.com/license . Existing material authors, sources and checksums remain in `assets/materials/batch-manifest.json`. Boundary meshes/materials are authored here, with no new downloads or game assets. Overture/upstream geometry, WorldCover, Meta/WRI canopy and RacingVibes physics/artwork retain their previous attribution; see `../batch_v5/README.md` and `../batch_v2/README.md`.

## Development and asset reference

`development-v6.1/` preserves the initial renderer sources. Its retained local jobs failed the Blender import check; those failures are not successful builds. Version 6.2 uses `boundary_geometry.py`, a standard-library-only clipper, so no packages are installed into Blender. `verify_boundary_assets.py` builds/renders all four asset types inside portable Blender; `boundary-kit.blend` is the editable reference and `boundary-kit.png` is its preview. The kit is not evidence of street-specific visual accuracy.

Run `collision_probe.py` after scenes finish, then `node batch_v6/verify_collision.cjs`, to test a clear approach to an actual mapped boundary with a no-wall control. The control removes collisions only in that isolated verification page, which reloads afterwards. `verify_pending.cjs` needs one completed scene and another actual active job.

`ground_probe.py` and `verify_ground.cjs` check the in-viewer grip/HUD at a clear point inside an actual completed site surface.

## Delivered checks

For `sites-v6.2`, 36 Python unit tests and 10 JavaScript spawn/grip checks passed (46 total). The portable Blender asset kit builds and renders all four asset types. Berlin, Haworth and Manchester reached terminal `built` status; all 27 tile hashes/dimensions and all earlier editions' frozen sources were verified. See `unit-verification.json`, `boundary-kit-verification.json` and `audit.json`.

The browser tour passes driving, all four vehicles, pause/recovery, scene switching, reload, cached reuse and controlled tile failure/retry for all three scenes. Picker pending/failure/retry uses a controlled mock job, separately from real background-generation driving in `pending-verification.json`. Actual wall contact has a no-wall control in `collision-verification.json`. `ground-verification.json` confirms that a point inside Haworth's parking ground receives tarmac grip and the mapped-site HUD label. These are technical checks, not proof of geographic accuracy.

The first builds under this renderer took approximately 392 s (Berlin), 170 s (Haworth) and 221 s (Manchester), using existing source-download caches. Boundary object construction makes the Berlin build slower than v5. Cached-generation responses took 0.008–0.020 s; browser scene readiness was 0.35–0.64 s in the tour. These are separate measurements, not cold-download or mobile benchmarks.

Within the playable squares, the new mapped ground covers about 315 m² in Berlin and 1,007 m² in Haworth. Manchester was selected to exercise a mapped hedge; it has no new site-ground area inside this square. The initial `source-coverage.json` is a pre-build survey against retained v5 inputs, not the final sample audit. Final per-scene results are in `audit.json`.

Visual review remains limited: generic unknown ground, coarse land-cover boundaries, approximate road geometry and unsurveyed finishes remain. Berlin is an incremental improvement; Haworth remains limited; Manchester is a targeted hedge integration sample. See `visual-review.json`. No per-scene geometry repair was applied after rendering.

A real stop/relaunch retained all three completed scenes; each rendered all nine cached tiles afterwards, with no page errors. See `restart-verification.json`. Its approximately 60 FPS samples are stationary, settled desktop readings, not a driving benchmark.
