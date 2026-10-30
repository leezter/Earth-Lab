# 3D-baked street study

Open **Play 3D-baked street.lnk**, or http://127.0.0.1:47842 while the local server is running. **Review.html** compares the previous Canvas renderer and this build at matching camera settings. The previous build stays on port 47841.

This is a **fixed 192 × 192 metre Kreuzberg sample**, centred near Wrangelstraße. Its purpose is visual acceptance of 3D-rendered assets at driving zoom, before extending the system. Search is hidden and URL coordinates cannot move the baked scene. Camera movement stays inside the bake; approaching the playable boundary returns the vehicle to the start.

## Actual rendering

Blender 4.5.14 LTS / Cycles, GPU, 48 samples with denoising. Mapped building footprints and street polygons are built as geometry, not photographs. Roof triangulation preserves courtyard holes; inferred roof height is a distance-to-edge hip profile, not an architectural roof survey. Kerbs have height; roofs have gutters, mesh chimneys and rooflight fittings. Trees use branch curves and individual leaf polygons, with deterministic procedural placement inherited from the district study.

Six photographic CC0 material sets from Poly Haven supply colour, OpenGL normal and roughness maps at 2K. They include asphalt, cobbles, concrete paving, slate, clay roof tiles and ground cover. UVs use asset dimensions in metres. Material scale and inferred surface choices remain approximations; detailed photographic materials do not establish the actual appearance of each mapped property. Lighting, shadows, indirect shading and material response are **baked**. They do not change with time of day in this build.

The final 6144-square bake covers 192 m, giving **32 pixels/metre**, versus 8 pixels/metre in the preceding cached Canvas world. It is split into nine 2048-square WebP tiles, about 11 MB transferred. The combined decoded image memory is approximately 144 MiB before browser/GPU overhead. This is a desktop test, not Android memory/performance acceptance. Closer zooms can still exceed the bake's resolution.

Four original RacingVibes cars, gearbox, Planck physics, geographic scale and nearby building collision are reused without modifying the game. The car remains dynamic over the baked environment. Trees and roof fittings are not new colliders. The vehicle's simple existing shadow does not dynamically receive the baked building shadows. No audio, live lighting, terrain elevation, bridge layers, traffic, full-city bake or global streaming is added.

## Build and evidence

From repository root, with the existing Earth Python environment:

1. `study/prepare.py` triangulates `study/district-data.json` into `study/geometry.json`, including exact boundary vertices so roof corners do not leak.
2. Run the pinned portable Blender with `--background --factory-startup --python study/bake.py`. `-- --preview` builds a 2048-square draft. The script loads assets via `assets/materials/manifest.json` and writes `study/street.blend`, the full render and `bake-report.json`.
3. `study/tiles.py` converts the final render into the playable tiles and records their hashes in `study/baked/manifest.json`.
4. `study/study_server.py` serves the separate build. It needs the original project's `web/rv` physics/assets and `earth_backend.py` dependencies. `study/launch.py` starts it idempotently and opens a browser. `study/stop.py` stops only port 47842.

Portable Blender is under ignored `tools/blender-4.5.14-windows-x64/`; official source https://download.blender.org/release/Blender4.5/ . The downloaded ZIP was SHA256-checked against Blender's published checksum. Blender binaries, work `.blend` files and full-resolution intermediate renders are not versioned; optimized playable tiles are retained. The tools occupy more disk than the game tiles.

`study/verify.cjs` checks actual movement, pause, recovery, all four vehicles, a controlled wall collision, nine tile requests and no `/api/image` requests in desktop Edge. It captures matching previous/new screenshots. `verification.json` and `bake-report.json` record the results. These checks do not establish universal map correctness or native mobile acceptance.

## Credits

**Powered by Poly Haven.** Asset licence: CC0, https://polyhaven.com/license . Exact sources, authors, dimensions, download URLs and checksums are retained in `assets/materials/manifest.json`. Asset names: `asphalt_02`, `roof_slates_02`, `clay_roof_tiles_02`, `concrete_pavement`, `cobblestone_floor_03`, `aerial_grass_rock`.

Map data: Overture Maps and upstream OpenStreetMap contributors, Microsoft, TomTom and other sources. https://www.openstreetmap.org/copyright ; https://docs.overturemaps.org/attribution/ . Vehicle artwork and physics: user's RacingVibes project. No BeamNG material files or game assets were copied into this build.
