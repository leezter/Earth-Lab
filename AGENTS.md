# Working in Earth Lab

## Purpose and current edition

Earth Lab turns map data into bounded, top-down driving scenes using a copied
RacingVibes vehicle/gearbox/Planck physics snapshot. Blender renders the environment
offline; the browser drives a dynamic car over baked tiles. This is a desktop
visual-generation prototype, not a complete world simulator.

Read `README.md` and the relevant edition's README before changing behavior.
`batch_v10/` is the current bridges/terrain edition (localhost port 47852); read its README.
`batch_v9/` preserves the street-details edition (localhost port 47851).
`batch_v8/` preserves the road-geometry/parking edition (localhost port 47850).
`batch_v7/` preserves the road-markings/signals edition (localhost port 47849).
`batch_v6/` preserves the sites/boundaries edition (localhost port 47848).
`batch_v5/` preserves the pavement edition (localhost port 47847).
`batch_v4/` preserves the road-material edition (localhost port 47846).
`batch_v3/` preserves the roof edition (47845), `batch_v2/` the land-cover/canopy
edition (47844), `batch/` the original six-location trial (47843), and `study/`
the fixed Blender street study (47842). The root Canvas district uses 47841.

## Code and data boundaries

- Python servers expose local APIs and serve browser assets. Edition-specific
  `web/` directories contain the viewer and location picker; `web/rv/` holds the
  shared copied vehicle runtime and assets.
- `custom_places.py` manages persistent jobs, caching and serial generation.
  `custom_worker.py` finds a road, fetches data, prepares geometry, runs Blender,
  optimises tiles and checks their hashes. Keep the current scene playable while
  a new job runs; submission is not completion.
- `scene_builder.py`, `landcover.py`, `prepare.py`, `bake.py` and `tiles.py`
  implement generation. Current roof and road modules select appearance from
  mapped attributes with explicit inferred fallbacks.
- `earth_backend.py` bridges to installed Earth adapters under
  `%LOCALAPPDATA%/Programs/BeamNG.Earth.Landmark.Exploration/server` and reuses
  `%LOCALAPPDATA%/beamng-earth/cache`. Do not modify that installation, start
  BeamNG, or change the separate RacingVibes repository as incidental cleanup.

## Preserve reproducibility

- Inspect `git status` and diffs first. Preserve existing user work.
- Check an edition's `freeze.json` before editing renderer code. Files listed in
  `source_hashes` are frozen inputs, including material manifests. Do not format,
  deduplicate or refactor them as routine cleanup: even whitespace changes break
  their hashes. Rendering changes need an explicit new renderer version and
  separate output/cache identity; do not silently refresh hashes to pass checks.
- Preserve earlier editions and development snapshots such as
  `initial-material-study/`, `photographic-material-study/` and
  `junction-material-study/`; their duplication is intentional historical evidence.
- Custom jobs belong in each edition's ignored `custom/` directory. Do not mix
  them into the frozen six-site reports or rewrite saved evidence to imply that
  a new check passed. Keep provenance, logs, tile manifests and playable tiles.
- Avoid bulk deletion of caches, renders, material assets or local tools. Retain
  the editable `road-materials.blend`; new numbered Blender backups are ignored.
  Do not delete existing tracked backups without inspecting their purpose.
  Never commit local server tokens, environments or downloaded Blender binaries.

## Running and checking changes

Run commands from the repository root in PowerShell with the existing Python
environment. The local road-edition shortcut uses the environment below; plain
`python` may select another interpreter without Shapely. The installed Earth
adapter dependencies are required for generation;
portable Blender is expected at `tools/blender-4.5.14-windows-x64/blender.exe`.
Do not introduce a new dependency stack merely to work around a missing local setup.

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v10/launch.py
& $earthPython batch_v10/stop.py
& $earthPython -m unittest discover -s batch_v10 -p 'test_*.py'
& $earthPython batch_v9/launch.py
& $earthPython batch_v9/stop.py
& $earthPython batch_v9/test_streets.py
& $earthPython batch_v9/test_sites.py
& $earthPython batch_v9/test_pavements.py
& $earthPython batch_v9/test_road_types.py
& $earthPython batch_v3/test_roof_styles.py
```

The launch script opens the gallery. Use `/` for driving. Launch/stop scripts are
edition-specific; closing a browser does not stop its server. Confirm the actual
HTTP response and rendered page when changing server or viewer behavior.

Choose verification that exercises the change:

- Run the existing road or roof tests when their behavior is relevant. Do not
  trigger expensive Blender builds for documentation or diagnostic-text edits.
- Check frozen source hashes after cleanup. `python batch_v4/audit.py` additionally
  needs retained v3/v4 custom scenes and writes `batch_v4/audit.json`; it is a
  local evidence tool, not a dependency-free test for a fresh checkout.
- For generation changes, wait for a terminal job status and verify all nine
  output tiles. Distinguish first-build time, cached reuse and browser loading.
- V10 also requires every declared transparent bridge pass, shared ground-plane
  validation, reciprocal surface connections and profile/clearance checks. Keep
  deck/ground contact separate; OSM layer numbers are never heights in metres.
  Check upper/lower routes, slopes, barrier filtering and recovery without a
  moving-car physics-world rebuild. Keep the isolated v10 runtime separate from
  the shared snapshot used by earlier editions.
- For viewer changes, check actual driving, pause, recovery, scene switching,
  cache/reload and failure/retry where affected. Existing browser checks include
  `verify.cjs`, `study/verify.cjs`, `batch/verify.cjs` and `batch_v2/verify.cjs`;
  inspect their ports and dependencies before running against another edition.
- Report checks actually run and their limits. Saved verification JSON is prior
  evidence, not proof of a newly executed test. Desktop success is not Android
  acceptance, and build success does not establish real-world visual accuracy.

## Accuracy and scope

Preserve source attribution and material licences. Keep mapped facts distinct
from inferred roofs, pavement widths, trees, wear and regional defaults. Do not
invent surveyed markings or street details from absent data. Current areas are
192 m square with nine baked 2048-square ground tiles (about 144 MiB decoded).
V10 adds sparse bridge passes, relative terrain and constrained surface driving;
its metric bridge profiles and structures are inferred. Earlier editions remain
flat. V10 supports connected branches and fixed deck crossings with unambiguous mapped
ordering and feasible inferred profiles. Full 3D suspension/falling, ambiguous or
infeasible interchanges, tunnels, traffic,
audio, live lighting and continuous streaming remain outside the implementation.
Do not claim worldwide visual acceptance from a material sheet, a single reviewed
location or source/network probes without rendered and driving acceptance.
