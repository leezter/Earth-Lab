# Land cover and canopy: version 2

Open **Review land cover v2.lnk** in the repository folder. The separate viewer uses http://127.0.0.1:47844/gallery.html . Version 1 remains available on port 47843. The gallery compares matching camera views from the two versions.

This version reruns all six requested locations using one frozen generator. It keeps the previous 192 m square, Blender Cycles bake, 32 pixels/metre, photographic material library, daylight and RacingVibes vehicle/gearbox/Planck snapshot. It adds raster-guided ground classification and vegetation. No individual scene receives a repair after rendering.

## Choose another location

The driving page now also has a place search. Select an exact result, click **Generate 192 m area**, and watch the generation phases. Coordinates are an optional alternative to search. Generation runs one area at a time in the background, with up to four active/queued requests, while the current area remains playable. When ready, click **Drive generated area**. Completed custom areas also appear in the location selector and survive browser/server restarts.

Custom areas use the unchanged frozen v2 renderer and automatically snap to a mapped driving road within 1.5 km. They are stored separately under `batch_v2/custom/`, with status, input, logs and verified tiles; they never alter the six-location report. Repeating the same requested coordinates and renderer version reuses completed tiles. Failed requests can be retried. Generation needs at least 3 GB free space; large intermediate PNGs are discarded after success, while playable textures are retained. New areas are not automatically visually approved, and mapping coverage may vary or fail. Areas remain bounded rather than continuously streaming.

## Data and inference

- ESA WorldCover 2021 v200 supplies 10 m land-cover classes. A 5 m sampling grid is used for geometry preparation; this does not improve the source resolution. Neighbouring cells are read to avoid missing data at cell boundaries.
- Meta/WRI canopy-height model `v2-ml3` guides tree presence and approximate height where available. Procedural tree positions, crown shapes, species and shrubs are not surveyed. Missing heights use a recorded fallback; trees with modelled height below 3 m are excluded.
- Ground classes select existing materials for forest, grass, crops, bare ground and shrubs. Classification boundaries are gently smoothed. Buildings, roads, pavements and water override these coarse masks. Raster water is a fallback only when vector water is absent.
- Raster heights are sampled at procedural candidates and bounded to 3–35 m. This is a visual approximation, not a reconstruction of individual trees. Roofs, fittings, untagged heights and regional architectural defaults remain inferred as before.

The new pipeline does not add hills, bridge layers, traffic, audio, live night lighting or continuous streaming. The 192 m area recovers the car at its edge. Camera zoom is bounded to the baked area. Trees are baked beneath the dynamic car sprite; they do not cast dynamic shadows on it. Nine decoded 2048-square textures use about 144 MiB before other browser overhead. Mobile performance is untested.

## Reproduction and evidence

Use the existing Earth Python environment with `python batch_v2/run.py`. Blender is expected at `tools/blender-4.5.14-windows-x64/blender.exe`. First-time generation includes downloading data, geometry preparation, rendering, denoising and tiling; completed scenes reuse baked tiles. These are different costs and should not be confused with browser scene loading.

`freeze.json` records source hashes before generation. `report.json` stores actual centres, counts, timings, coverage and failures. `runs/<id>/` retains the input, geometry, bake metadata and tile hashes. `audit.py` verifies frozen sources, material checksums and generated tiles. `verify.cjs` checks all six in the same browser selector, actual driving, pause/recovery, a simulated tile failure/retry, and captures two screenshots per location. `visual-review.json` separately records visual assessment. Technical success does not establish real-world visual accuracy.

The overlap audit normalises tiny self-intersections introduced by millimetre-rounded export coordinates, solely in its in-memory analysis. These exist in the unchanged version-1 road/pavement polygons too. Each repaired polygon must change area by less than 0.01 square metres; counts and total area changes are recorded in `audit.json`. No input file, mesh, texture or collision geometry is rewritten by this audit.

After completion, `comparison.py` exports `Review.html` for offline review and a web gallery. The renderer's frozen inputs must not be changed and then resumed; a changed pipeline needs an explicitly new version and another complete run. The viewer, audit and review tools can be maintained separately from the frozen renderer.

Completed version-2 result: **6/6 builds and driving checks**, 54 verified tiles, 12 new automatic screenshots, and unchanged frozen-source hashes. All six playable samples had complete land-cover and canopy coverage. Scene-ready times in the desktop browser tour were 0.30–0.67 seconds; full first-time builds were 136–430 seconds (median 161 seconds). Optimised tiles total 70.7 MB. The review compares 24 images including version 1. No individual scene edits were made.

Visual review: three candidates (Berlin, Granada and the restored forest) and three limited scenes (Haworth, industrial harbour and dry countryside). Haworth still has generic yards/ground. The dry scene has conspicuous raster boundaries and a uniform grass appearance. Blended boundaries and regional/seasonal material selection are the next visual priorities; this version is not accepted as consistent worldwide quality.

`launch.py` starts only this viewer, and `stop.py` stops only port 47844. Neither starts or modifies BeamNG or the main RacingVibes repository. Old versions remain available.

## Sources and attribution

Land cover: Zanaga et al. (2022), **ESA WorldCover 10 m 2021 v200**, CC BY 4.0; https://doi.org/10.5281/zenodo.7254221 and https://esa-worldcover.org/en/data-access . Converted into smoothed ground masks and sampled statistics.

Canopy: **High Resolution Canopy Height Maps by Meta and World Resources Institute**, CC BY 4.0; https://registry.opendata.aws/dataforgood-fb-forests/ and https://github.com/facebookresearch/HighResCanopyHeight . Accessed 30 October 2026. The local adapter uses the `forests/v2/global/dinov3_global_chm_v2_ml3/chm/` product. Values are sampled and bounded for generated vegetation. Source imagery is Maxar; the registry's source-imagery notice remains applicable.

Map geometry: Overture Maps and upstream OpenStreetMap contributors, Microsoft, TomTom and other providers; https://docs.overturemaps.org/attribution/ and https://www.openstreetmap.org/copyright . Material assets: **Powered by Poly Haven**, CC0, https://polyhaven.com/license . Exact source URLs, authors, dimensions and checksums are retained in `assets/materials/batch-manifest.json`. Vehicles and physics: user's RacingVibes project. Renderer: Blender Cycles. No BeamNG game materials are redistributed.
