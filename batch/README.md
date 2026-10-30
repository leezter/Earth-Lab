# Six settings: frozen generation experiment

Open **Review six settings.lnk**, or http://127.0.0.1:47843/gallery.html while the batch viewer is running. Each completed scene has a Drive link; the player selector switches between baked locations. Earlier builds on 47841 and 47842 are preserved.

This is a test of the same generator across six settings, not worldwide production coverage. Requested locations are in `sites.json`. Each point is automatically snapped to the nearest mapped driving road within 1.5 km, using the same rule for all six; requested and actual coordinates and snap distances are recorded. Each area remains a fixed 192 m square with a bounded camera and recovery at its edge. It is not continuous city streaming.

## Frozen pipeline

`run.py` writes `freeze.json` before data generation or rendering. Its SHA256 hashes cover the scene compiler, geometry preparation, Blender bake, tile conversion, runner, six requested locations and material manifest. The runner checks those hashes before each site and after completion. A changed source aborts the run rather than silently applying new rules to later scenes.

There are no site-ID-specific material or geometry branches. Mapped surface/roof tags take precedence where supported. Missing details use building size/type and coarse geographic fallbacks for British, Mediterranean and temperate settings. These boxes are style guesses, not a climate classification or an architectural survey. The original renderer's one-in-four random clay-roof choice is replaced with this rule chain. Large or industrial buildings receive a low-pitch roof inference and corrugated-metal fallback; this can still misclassify large civic buildings.

All scenes use Blender Cycles, 6144 square pixels, 192 m extent, 48 samples and the same daylight. There are nine 2048-square WebP tiles per scene. Generation, baking, tiling and browser verification timings are separate. Reopening a completed area uses cached tiles; first-time generation is not instantaneous. No manual repair of an individual output is part of this experiment.

## Materials and geometry

Eleven configured CC0 Poly Haven sets: asphalt, slate, clay tiles, concrete paving, cobbles, grass/ground cover, dry mud, forest floor, gravel, corrugated iron, dry rocky ground. `assets/materials/batch-manifest.json` records source URLs, authors, physical dimensions and checksums. The listed library is the configured inventory, not proof that every material appears in every image. Water has a separate generated surface material rather than the old asphalt substitute. Dirt and gravel likewise no longer fall back to asphalt.

Roads and building footprints come from Overture and available OpenStreetMap tags. Pavement inference now checks nearby building coverage, rather than giving isolated rural roads Berlin-width pavements. Mapped forest polygons influence ground selection and denser procedural vegetation. Courtyard greenery and individual trees remain inferred. Sparse or missing land-use information can leave natural areas underpopulated. Hills, bridge/tunnel layers, live night lighting, traffic and audio remain outside this experiment.

Roof profiles, fittings and untagged heights are inferred. Render quality does not establish correct local architecture. No landmark-specific meshes are included. The same RacingVibes vehicle/gearbox/Planck snapshot remains in use, with the previous scale and timing limitations.

## Results and review

- `report.json`: build status, errors, actual centres, contexts, timings, counts, texture sizes and final source-hash check.
- `runs/<id>/`: input data, prepared geometry, build logs, bake report and tile hashes. Failed attempts are preserved rather than hidden.
- `browser-verification.json`: actual movement, pause, recovery, matching scene coordinates, nine decoded tiles, no aerial requests, missing-tile error and retry checks.
- `web/reviews/`: two automatic in-game screenshots per built location, at matching overview/close zoom settings.
- `visual-review.json`: separate human-readable visual assessment, written after all outputs are generated. Candidate, limited and rejected ratings do not alter the renderer or the scenes.

Completed result: 6/6 technical builds, 6/6 driving checks after a shared viewer spawn-clearance improvement, and 12 automatic screenshots. Visual review: 2 candidates, 3 limited, 1 rejected. Initial browser results are retained in `browser-verification-initial.json`; the general runtime fix is described in `viewer-runtime-revision.json`. It changes no baked scenes and contains no site-specific exceptions. The render pipeline remains frozen. See `summary.json` for timings and totals.

The forest rejection has a concrete diagnosis: the current vector-land-use path produces no forest mask there, while the existing raster adapter detects tree cover over roughly 70% of the same 192 m sample. `forest-source-investigation.json` records this independent check; it was not fed back into this frozen run. A new version should incorporate land cover/canopy information and rerun every location, rather than patch the forest alone.

The screenshots allow review of consistency and obvious visual defects. They do not prove correspondence to current street photographs, correct individual roof materials, historical accuracy, or production mobile performance. The visual acceptance decision remains distinct from technical build success.

Run with the existing Earth Python environment: `python batch/run.py`. Blender is expected at `tools/blender-4.5.14-windows-x64/blender.exe`. The run reuses existing Earth downloads and does not start or modify BeamNG. To rebuild after changing generator code, explicitly archive the old experiment and create a new freeze/version; do not overwrite the frozen evidence. `node batch/verify.cjs` runs the browser tour after all builds finish. `batch/launch.py` opens the gallery; `batch/stop.py` stops only the viewer on 47843, not a running bake job or the older builds.

## Credits

Powered by Poly Haven. Material assets are CC0: https://polyhaven.com/license . Exact source/author/checksum information is retained in the batch manifest. Geometry: Overture Maps and upstream OpenStreetMap contributors, Microsoft, TomTom and other sources. https://www.openstreetmap.org/copyright ; https://docs.overturemaps.org/attribution/ . Vehicles and physics: user's RacingVibes project. Renderer: Blender Cycles. No BeamNG game materials are redistributed.
