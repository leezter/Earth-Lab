# Pavement edition

Open http://127.0.0.1:47847/ or run `batch_v5/launch.py` with the existing Earth Python environment. The gallery is `/gallery.html`. Search for a place or enter latitude, longitude, generate its 192 m area, and drive when the job reaches `built`. Earlier editions remain on their own ports; v4 is 47846.

## What changed

- Pavements are compiled independently for each geographic side of a directed street. Explicit `no`, `none`, `left`, `right`, `both` and `separate` are honoured, including side overrides. Side-specific widths, surfaces and colours take precedence over shared sidewalk attributes. Metres and feet are accepted; malformed widths use a labelled fallback.
- A bounded read of the OSM map API supplies pavement details absent from the installed road adapter. Separately mapped pedestrian lines retain their own position and width. Pedestrian area polygons, including multipolygon holes, take precedence over centreline-derived carriageway geometry. No raised pavement is fabricated along an OSM crossing line. Steps remain a flat baseline approximation.
- When the installed Berlin street-survey database is available, actual pavement polygons preserve varying widths, junction corners and adjacent material bands. Mapped driveway footprints receive a lowered surface with a kerb gap; mapped tree-pit footprints remain open soil. Exact kerb/ramp profiles remain approximate. The source is **Straßenbefahrung 2014/2015**, not a current street inspection.
- Walking-scale slab, small-sett and mosaic finishes supplement the v4 material families. Survey dimensions distinguish 50 mm mosaic, 90 mm small setts and 350 mm concrete slabs. Larger slabs and unspecified OSM unit sizes use approximations. Palette, wear, lighting and stone appearance are inferred unless an OSM colour is present; a material code is not a measured colour.
- Material ownership is exclusive. Pavement polygons override inferred carriageway width where they conflict; other ribbons are clipped against carriageways, buildings and mapped tree pits. Kerbs are limited to road edges adjacent to pavement, with gaps at survey driveways. These are baked visuals, with no new kerb collision or elevation physics.

This edition focuses on pavement presence, location, width and finish. It does not implement crossings, tactile paving, parking layouts, street furniture, terrain, bridges or new building geometry. Outside polygon coverage, widths and junction shapes remain approximations. Street-centreline offsets do not become surveyed kerb boundaries.

## Sources, fallback and reproducibility

`pavement_sources.py` opens the existing Berlin database with SQLite `mode=ro&immutable=1`; it never modifies installed Earth adapters, data or configuration. It discovers the existing `streets-data-paths.json`, or accepts `EARTH_LAB_PAVEMENT_SURVEY`. The database must have complete schema 2 data in EPSG:25833. Absence is recorded and falls back to OSM / adapter evidence.

The OSM query covers approximately 840 m square and retains its response in this edition's ignored `cache/osm/`. Failures are recorded and do not imply that pavements are absent. Adapter tags and conservative urban defaults are the final fallback. Cached snapshots are intentionally reused; completed areas are not refreshed from live mapping on every launch. OSM supplies original way direction, avoiding left/right reversal when an Overture segment has another direction.

Each ignored `custom/place-*/` retains `pavement-inputs.json`, `pavement-report.json`, `district-data.json`, prepared geometry, logs and nine tile hashes. Input snapshots retain OSM versions/timestamps and queried survey polygons/material codes. Provenance records retrieval time, failures, original OSM response hash and queried survey-feature hash. Per-record areas can overlap within one material group; totals use the exclusive union.

`freeze.json` hashes renderer inputs, the root backend and existing material manifest. Changes need a new version/cache identity. Earlier reports and studies remain untouched. `development-v5.1/` retains the first pavement renderer and its preview evidence; v5.2 reduces slab contrast and handles OSM ways extending beyond the query area. These are development iterations, not unseen-location acceptance tests. Custom IDs reuse completed renders for the same rounded coordinates and renderer hashes. Changing local source availability does not automatically refresh an already built area.

The current scene remains playable during generation. First builds include data, geometry, Blender and tile optimisation; cached reuse and browser loading are separate costs. Outputs remain nine 2048-square WebP tiles at 32 pixels/metre, about 144 MiB decoded before browser overhead.

## Running and verification

From the repository root in PowerShell:

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v5/launch.py
& $earthPython batch_v5/test_pavements.py
& $earthPython batch_v5/test_pavement_sources.py
& $earthPython batch_v5/test_road_types.py
& $earthPython batch_v3/test_roof_styles.py
& $earthPython batch_v5/audit.py
node batch_v5/verify.cjs
& $earthPython batch_v5/stop.py
```

Geometry fixtures check orientation, side overrides, units, separate mapping, multipolygon holes, material coverage, survey precedence and driveway/tree-pit behaviour. `audit.py` verifies hashes and completed local scenes; without scenes it reports zero completed-scene checks. `verify.cjs` requires existing Playwright and a running v5 server. It exercises driving, pause, recovery, vehicles, switching, reload, tile failure/retry and generation cache reuse. The audit records raw area differences and checks the exporter's 2 mm ring-rounding tolerance and 0.03 m² disconnected-island cutoff explicitly. `verify_pending.cjs` separately checks driving while another real generation job is active; run it while one area is built and another is queued/rendering. These checks do not establish worldwide visual accuracy or Android acceptance.

## Attribution

- Geoportal Berlin, **Straßenbefahrung 2014/2015**, retrieved by the existing database on 25 October 2026, **Datenlizenz Deutschland – Zero – Version 2.0**. Source: https://gdi.berlin.de/services/wfs/strassenbefahrung . Material-code reference: https://gdi.berlin.de/data/strassenbefahrung/docs/Datenformatbeschreibung_Stra%C3%9Fenbefahrung_2014.pdf . Polygons are transformed, clipped and converted to approximate Blender finishes.
- OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright . Tag references: https://wiki.openstreetmap.org/wiki/Key:sidewalk and https://wiki.openstreetmap.org/wiki/Key:area:highway . Completeness varies.
- Road/building geometry retains Overture and upstream attribution. WorldCover and Meta/WRI canopy retain the sources/licences in `../batch_v2/README.md`.
- **Powered by Poly Haven**, CC0: https://polyhaven.com/license . Existing photographic detail, authors, URLs and checksums remain in `assets/materials/batch-manifest.json`. New paving shaders are authored here. Vehicles/physics are the copied RacingVibes snapshot; no BeamNG game assets are used.

## Delivered local checks

For `pavements-v5.2`, 22 unit tests passed (10 geometry, 3 source/cache, 4 road and 5 existing roof checks). Kreuzberg and Haworth reached terminal `built` status; all 18 tile hashes and dimensions were checked. Previous v1–v4 frozen inputs remain unchanged. See `audit.json`.

Both scenes passed the real desktop browser tour: driving, four vehicles, pause/recovery, scene switching, reload, cached reuse and a controlled missing-tile failure/retry. Picker pending/failure/retry used a mocked job response, separately from `pending-verification.json`, which records real driving while another actual v5.2 job rendered. Completed scenes and rendered tiles survived a server stop/relaunch. See `verification.json` and `restart-verification.json`.

The final builds took about 172 s and 160 s with existing source-download caches; these are not cold-download benchmarks. Browser scene readiness was 0.54–0.64 s; completed-generation reuse requests took 0.011–0.013 s in this check. These are distinct measurements.

Visual review is limited: Berlin is a candidate improvement in pavement coverage/readability; Haworth remains limited by inferred widths and generic surrounding ground. See `visual-review.json`. No worldwide, photographic or Android acceptance is claimed.
