# RacingVibes rendered district study

Latest road markings/signals edition: **Play Earth Lab - streets update.lnk**, or http://127.0.0.1:47849/ . Lane/control evidence drives paint and roadside hardware, with labelled inferred layouts and optional illustrative signal indicators. See [batch_v7/README.md](batch_v7/README.md).

Latest sites and boundaries edition: **Play Earth Lab - sites update.lnk**, or http://127.0.0.1:47848/ . Mapped parking/yard surfaces and property boundaries retain the pavement improvements in an independent renderer/cache. See [batch_v6/README.md](batch_v6/README.md).

Latest pavement edition: **Play Earth Lab - pavement update.lnk**, or http://127.0.0.1:47847/ . Side-specific pavements, mapped widths/surfaces and historical Berlin survey polygons use a separate renderer and cache. See [batch_v5/README.md](batch_v5/README.md).

Latest road-material edition: **Play Earth Lab - road update.lnk**, or http://127.0.0.1:47846/ . Place search and generation use separate road surface families and retain the roof improvements. See [batch_v4/README.md](batch_v4/README.md).

Previous roof-variety edition: **Play Earth Lab - roof update.lnk**, or http://127.0.0.1:47845/ . It supports place search and generation with mapped roof attributes and deterministic regional fallback finishes. See [batch_v3/README.md](batch_v3/README.md). Older versions are preserved.

Launch **Play rendered Kreuzberg.lnk**. The new build runs at http://127.0.0.1:47841 . The original photographic prototype on port 47840 and the RacingVibes game are preserved.

This is an 840 m square visual study centred on Kreuzberg. It keeps the four vehicle sprites, original vehicle/gearbox/Planck physics snapshot, driving controls and collision hulls from Earth Lab. WASD/arrows drive, S brakes then reverses, R recovers, P pauses. Touch controls are included. The study returns the vehicle to the start when it approaches its boundary; continuous city streaming is intentionally deferred until the visual approach is accepted. Other searched locations can be generated, but this revision was visually reviewed in Berlin only.

## What changed

- The rendered view makes **no aerial-image requests**. Sharp geometry and generated repeatable materials replace enlarged photographed ground and roofs.
- Mapped building footprints, including courtyard holes, have roof fills, inset parapets, roof materials aligned to their longest edge, restrained roof shading, fittings and shadows. Mapped roof attributes are used where available; missing colours, roof appearance and all fittings are procedural. These are not surveyed replicas of individual roofs.
- Roads are buffered to mapped widths where available, otherwise class estimates, and united into connected polygons before kerb edging. Pavements are clipped around carriageways and building footprints. Missing urban pavement widths are inferred. Asphalt, cobbles and paving have distinct close-up detail. Junction geometry is a prototype, not a surveyed kerb model; crossings are not invented.
- Mapped green/water polygons and inferred enclosed courtyard gardens get generated ground materials. Trees are deterministic decorative placements in these areas, not individually mapped trees. Shared shadow direction visually ties buildings, trees and cars together.
- Building footprint collision uses the original game's active scenery-collision system. No collisions are added for decorative trees/fittings. Existing 2D limitations remain: no terrain elevation, bridge layers, audio, traffic or night simulation in this study.

## Rendering and performance

128 m world tiles at 1024 square pixels; materials are composed offscreen and cached. At most one tile is constructed per animation frame, with neighbour preloading and a 20–24 tile cache. Cache misses can still cause a short construction hitch. This is desktop browser verification, not Android acceptance. The copied vehicle engine keeps its original 30-unit internal physics conversion; map/art scale is 10 drawing units per metre, as in Earth Lab. Speed is measured geographically.

Map metadata is read through the existing Earth Lab backend adapters, which reuse the installed Earth data readers and shared downloaded cache. This revision has no separate aerial download cache. The shared reader bridge is included as `earth_backend.py`; the installed Earth adapters and Python environment are still required. Closing the browser leaves the local server running; **Stop rendered district.cmd** stops only this revision.

## Evidence and sources

**Review.html** has matching baseline and rendered screenshots. `verification.json` records real driving/pause/recovery and confirms no `/api/image` requests; `scene-summary.json` describes the geometry and accuracy boundary. No changes were made to the main RacingVibes repository or baseline source files.

Map sources: Overture Maps and upstream OpenStreetMap contributors, Microsoft and TomTom. OpenStreetMap licence/attribution: https://www.openstreetmap.org/copyright . Overture attribution: https://docs.overturemaps.org/attribution/ . Geometry processing uses Shapely. Material artwork is deterministic Canvas generation; vehicle artwork and physics are copied from the user's RacingVibes project. Existing reader/source licensing remains applicable. Baseline comparison images retain their original imagery attribution.

## New: 3D-baked street study

The separate study on port **47842** uses Blender Cycles, photographic CC0 materials and a 32-pixel/metre bake. See [study/README.md](study/README.md) and [study/Review.html](study/Review.html). The original Canvas build remains unchanged on port 47841.

## Six-setting generation trial

The separate viewer on port **47843** compares six locations generated by one frozen pipeline. See [batch/README.md](batch/README.md), `batch/report.json` and `batch/freeze.json`. Completed scenes have automatic driving screenshots and a location selector; previous builds remain available.

## Land cover and canopy trial

Version 2 runs separately on **47844**, using raster land cover and canopy heights across the same six locations. See [batch_v2/README.md](batch_v2/README.md) and the before/after gallery at http://127.0.0.1:47844/gallery.html . Version 1 is preserved for comparison.
