# Bridges and terrain edition

This independent v10 edition adds fixed bridges, explicit road-surface
connectivity, relative terrain height, constrained road profiles and slope
forces to the top-down driving prototype. The previous
[street-details edition](../batch_v9/README.md) remains on port 47851.

Current renderer identity: **bridges-v10.23**. Frozen inputs include the viewer
and isolated driving runtime. Development identities and their evidence remain
under `development-bridges-v10.*`; their results do not substitute for current
acceptance.

Open http://127.0.0.1:47852/ for driving or `/gallery.html` for the examples.
WASD/arrows drive, P pauses, R recovers on the current connected surface.
The existing map picker/search and serial generation queue remain available.
An area becomes playable only after geometry checks, nine 2048-square ground
tiles and every declared transparent bridge pass have been verified.

## Divided carriageway bridge repair (v10.21-v10.23)

One-way OSM ways with an explicit lane count now infer their motor carriageway
width from that count (3.25 m per urban lane; 3.5 m for motorway/trunk lanes), rather than applying a generic two-way
road-class width to each direction. Explicit `width:carriageway` and `width` still
take priority; missing or ambiguous lane counts retain the class fallback.
Separate cycle tracks and pavements do not count as motor lanes. These dimensions
remain inferred, not surveyed.

This fixes Oberbaumbruecke's two separately mapped one-lane carriageways being
inflated to 9 m apiece. Their invented overlap caused an ambiguous bridge-order
error even for nearby selections where the bridge was only in the surrounding
generation context. The carriageways keep their separate topology and supporting
surfaces; genuinely overlapping disconnected decks with equal ordering still
fail. Earlier failed requests remain recorded, and their cached failure does not
apply to this changed generation model. V10.22 also avoids a marginal overlap
between the inferred two-lane widths at Warschauer Bruecke in the wider context.
The existing nearby fallback remains for
actual failures.

V10.23 also applies the established building-overlap handling to simple bridges:
retain the building collision and remove its footprint from the supporting deck,
instead of rejecting the entire area. Oberbaumbruecke's mapped central structure
therefore remains blocked. There is no invented building passage or full-span
driving acceptance through that structure.

`verify_oberbaum.cjs` requires completed current builds at the originally reported
52.500576, 13.440578 selection and at the bridge. It checks the actual generate/drive
flow without mocked job responses or a nearby fallback, ordinary driving,
pause/recovery/reload, and the separate accessible stretches on both sides of the
mapped obstruction, on both carriageways with all four vehicles in both
directions. These are not full bridge traversals. `oberbaum-generation-verification.json` and
`oberbaum-verification.json` record the actual run and its limits.

## Parked vehicles (v10.20)

Mapped individual ground parking spaces, supported narrow single-row parking
areas and evidence-gated roadside parking lanes can contain static parked cars.
Roadside placement still requires explicit carriageway width and parking tags;
cars do not establish permission to park on an otherwise untagged road. The
existing exclusions for crossings, driveways, junctions, pavements, buildings,
reserved lanes and enclosed/layered parking remain. Unknown multi-row layouts,
reserved spaces, ambiguous conditional loading restrictions, steep ground and
bridge/approach footprints are omitted. Full car footprints must fit, with gaps;
the maximum is 80 cars per 192 m scene. About 65% of candidate slots are considered
for occupancy, with further omissions when no vehicle safely fits.

All **151 RacingVibes liveries across 21 vehicle kinds** are snapshotted from its
actual race-sprite registry, with original asset hashes and crop metadata in
`web/parked-assets/manifest.json`. Buggy types DuneraX1 and RavikR each have 0.01
selection weight compared with 1 for every other type (roughly 0.1% combined
before footprint filtering). Variants are uniform within each eligible kind.
Sprites preserve aspect ratio; their physical parking dimensions, occupancy,
vehicle choice and heading are inferred. They are not live or surveyed vehicles.
The RacingVibes checkout and the earlier shared driving snapshot are unchanged.
`import_parked_assets.py <RacingVibes checkout>` reproduces the sprite snapshot;
changing those assets requires another explicit renderer identity.

Parked cars load with the scene, render below bridge passes and have static,
height-filtered collision footprints. Recovery avoids them; driving does not
rebuild the physics world. Scene replacement and failure/retry use the existing
loading lifecycle. Only sprites needed by the selected scene are decoded.

For retained baked scenes, the server computes a cached, read-only occupancy
overlay from their saved OSM and eligible parking geometry. The API labels that
overlay with its own current renderer and the original source renderer/job.
Original job files, source evidence, tiles, hashes and acceptance reports are
preserved. New builds include parked placements in their content identity and
write `parked-cars-report.json`. This overlay does not claim a fresh Blender bake
for an older scene. V10.19's failed Simplonstrasse attempt is retained; v10.20
applies the shared 1 mm precision rule to parking overlays before retrying.

Checks: `test_parked_cars.py` covers occupancy determinism, complete catalog and
asset hashes, rare Buggy selection, footprint fit, exclusions and roadside
clearance. `verify_parked_cars.cjs` exercises a completed mapped build, sprite
loading, ordinary-throttle static contacts with all four driving vehicles,
pause/recovery, scene replacement, reload and failed-artwork retry. Its saved
report records the particular run; it is not worldwide parking acceptance.

## Nearby-area fallback (v10.17; drive-button feedback v10.18)

When a requested area fails generation, the map picker automatically looks for
an already validated real scene within 1.5 km. It chooses the closest actual
scene centre, checks its image hashes and nine tiles, moves the map marker,
loads it, and states the distance from the original selection. The Drive button
closes the menu, resumes play and focuses the canvas. If the area is already
active, it preserves the current car and position rather than reloading it. Synthetic
fixtures and failed, incomplete or damaged scenes are excluded.

If no validated scene is nearby, it samples nearby mapped driving roads in
nearest-first order and tries at most eight candidates, with 64 m spacing.
These are sampled candidates, not an exhaustive search over every possible map
centre. No further candidate starts after twelve minutes; an already running
job may finish. A bounded-search failure asks for another selection instead of
repeating the same failure indefinitely. Current driving remains available.
Changing the selection invalidates stale results, and a pending nearby search
can resume after reload without resetting its attempt count.

Known deterministic failures are reused only while their generation-model
hashes match the current model. Fixing the underlying renderer invalidates that
failure history. Failed jobs and their diagnostics remain untouched; fallback
selection does not relabel old renders as freshly generated output. The existing
accepted scenes keep their original bake identities. This release changes the
selection service and picker, not bridge geometry or vehicle physics.

Verification: 136 Python tests and `verify_nearby.cjs`. The real failed Ostkreuz
request resolves to the accepted area 71.6 m away without a new render. Browser
checks also exercise candidate failure then success, the eight-attempt limit,
continued availability of the old drive, stale-selection handling and reload
resumption. Candidate generation statuses in those browser scenarios are mocked;
no new uncached Blender generation is claimed. Results are in
`nearby-verification.json`. `verify_drive_button.cjs` additionally checks actual
keyboard driving immediately after clicking, no same-scene reload, and failed
scene-load retry. Results are in `drive-button-verification.json`.

## Model and limits

- Terrain has one ground height per XY point. Decks are separate supporting
  surfaces and are never flattened into ground junctions. Source node topology,
  explicit connections and height continuity govern transitions.
- Bridge ways come from OSM. `layer` orders overlapping features; it is not a
  metric height or global floor. Short same-road layered continuations sharing
  bridge endpoints can be inferred approaches, with their source tags retained.
- Deck heights, ordinary approach profiles, parapets and abutments are inferred.
  River decks connect bank profiles; road crossings require 4.6 m modelled
  clearance below a 0.45 m slab. This is not surveyed clearance or certification.
- Elevation reuses the installed Earth DEM reader without landmark-specific
  terrain overrides, installation changes or new dependencies. Its ground
  filtering and Mapterhorn/AWS source selection remain provider-dependent.
  Retained raster hashes, adapter identity, sample grid and processing policy
  accompany each job. Six-metre sampling does not imply six-metre source detail.
- Heights use one relative local reference. Provider datums are not assumed
  interchangeable with OSM `ele`; elevation tags are retained rather than fused.
  Ground-road profiles suppress DEM noise with shared-node and bounded-grade
  fitting. Those roadbed changes and approach embankments are inferred.
- One canonical two-metre triangle grid carries all overlapping ground layers
  and browser contact. A local projection fits constrained road profiles onto
  that grid without picking up artificial bank bumps. This is mesh refinement
  of the sampled terrain, not new two-metre elevation evidence. Water has a flat
  local reference and an opening in the ground base. Vegetation and building
  foundations use coherent, inferred terrain anchors.
- All scenery is anchored to terrain. Ground shading and slope response convey
  hills in the existing orthographic view. This does not add a side-view camera.
- The isolated copied runtime retains horizontal vehicle/gearbox physics.
  Grade forces and height-filtered Planck contacts extend it. Transitions keep
  the same car body and velocity. Vehicle height bounds are conservative
  inferences, independent of sprite width/length.
- Decks and rails render as sparse RGBA patches, composited below a car on the
  bridge or above a car underneath. All nine ground tiles use one sampling atlas.
  Decoded ground/bridge images have a 256 MiB prototype acceptance ceiling;
  total browser/GPU memory is higher. Browser checks separately record process
  working sets/peaks and JS heap; these do not measure peak dedicated GPU memory.
- Connected branches and ordered crossings between multiple fixed decks are
  supported by the connected-deck graph. Full suspension, jumping/falling,
  rollovers, movable bridges, tunnels and multistorey parking remain unsupported. Unsupported
  elevated edges recover to the last safe pose. Ambiguous or invalid bridge
  geometry fails with retained diagnostic reports instead of inventing a junction.
  Width changes at branched joins retain each source segment's width and infer a connecting junction platform. Ambiguous ordering and
  infeasible grade/clearance constraints still reject generation. Building passages remain omitted and blocked by
  ordinary ground building collision; they do not create tunnel driving.
- Areas remain 192 m square. Context is solved beyond the crop; ramps are not
  shortened to fit. Traffic, live lighting and continuous streaming remain out
  of scope. Mapping restrictions/signals are not traffic-law simulation.

## Run and verify

Use the existing environment from the repository root:

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython -m unittest discover -s batch_v10 -p 'test_*.py'
& $earthPython batch_v10/build_examples.py --fixture junctions
& $earthPython batch_v10/build_examples.py --fixture overpass
& $earthPython batch_v10/build_examples.py --fixture hills
& $earthPython batch_v10/build_examples.py --fixture flat
& $earthPython batch_v10/build_examples.py --lat 53.727338 --lon -1.859579 --name "Halifax viaducts"
& $earthPython batch_v10/launch.py
node batch_v10/test_elevation.cjs
node batch_v10/verify_bridges.cjs
node batch_v10/verify_layered.cjs
node batch_v10/verify_layered_occlusion.cjs
node batch_v10/verify_mapped_routes.cjs
node batch_v10/verify_performance.cjs
& $earthPython batch_v10/audit.py
& $earthPython batch_v10/stop.py
```

`test_elevation.cjs` prepares its synthetic inputs under ignored `cache/` using
the existing Earth Python environment (`EARTH_PYTHON` can select that executable).
Synthetic
examples are always labelled, do not represent real places, and are separate
from mapped location generation. The CLI waits for an actual terminal job status.

`freeze_renderer.py --id bridges-v10.N` creates an explicit new renderer identity
and exact retained source snapshot. It refuses to refresh an existing identity.
Renderer, viewer and isolated runtime inputs are hashed. Each completed build
also has a content identity covering its source evidence, terrain and network;
cached reuse retains that build's inputs instead of implying fresh downloads.
Failed builds and older outputs remain in ignored `custom/` directories.

`build_examples.py --all` serially runs the three synthetic fixtures, four
initial bridge selections and the Kreuzberg ground regression, recording actual
terminal statuses and cached reuse in `build-examples-report.json`. A rejected
location is not accepted evidence. `probe_bridges.py` checks a separate frozen
source/network sample only; its report explicitly excludes Blender, driving and
visual acceptance.

## Bridge-model verification retained from v10.14

The current viewer draws active rails before higher deck patches, so lower
railings remain hidden beneath an upper deck. V10.14 reuses unchanged v10.13
rendered images with new job/content identities and repeated output acceptance;
`viewer-upgrade-report.json` records the one-file viewer change. The original
eight v10.13 builds, renderer sources and logs remain available.

### Connected network extension (v10.14; baked model v10.13)

Current acceptance: **all four originally failing Halifax requests build**, and
eight areas (four real requests plus four synthetic fixtures) pass output
acceptance and ordinary browser driving/lifecycle checks. The two views containing
complete elevated routes pass 88 layered vehicle traversals; the synthetic
junction passes another 56. Additional mapped deck/underpass corridors pass 240
traversals. These are 384 test traversals, not 384 distinct roads. All four
vehicles are covered, with no unintended level changes, recoveries or moving-car
body replacements. Flat driving retains zero measured deviation from the copied
runtime baseline, and all four slope-response checks pass.

Fresh v10.14 Edge performance across eight scenes measured 60.09-60.25 mean fps,
16.8-17.0 ms p99 frame times, 417-1617 ms local scene loads and 144.0-200.1 MiB
steady decoded images. Generation and cold source acquisition are excluded from
those load times. The audit passes all ten frozen editions; all fourteen retained
v10 source snapshots also match their original hashes. These are desktop results.
See `layered-acceptance-summary.json` for the consolidated evidence.

The Halifax requests were development and acceptance cases, not an unseen-site
coverage experiment. Source topology, inferred metric heights, conservative
clearance and simplified structures still limit geographic accuracy. Ambiguous
ordering, impossible constraints, unsupported building passages and tunnels can
still be rejected or blocked explicitly.


`layered_network.py` adds a graph solver for branched elevated roads and locally
ordered deck crossings. Source ways split at shared nodes instead of being
arbitrarily concatenated. Shared nodes have one solved height; overlapping
junction portals are flat, and width-derived convex platforms fill the space
between incoming road ribbons. Platforms, metric profiles and structures are
explicitly inferred. Disconnected crossings do not gain graph connections.

A raise-only metric constraint solver propagates grade and clearance requirements
across two-metre profile stations. Deck ordering produces local inequalities,
never `layer * height`. The connected solver bounds decks to 16 percent and ground approaches to
17 percent grade, below the independent 18 percent acceptance ceiling. The
inherited simple-bridge nominal approach parameter applies only to that earlier
profile builder. Ground approach corridors can extend through mapped
context up to 420 m; infeasible constraints, cycles and equal-order ambiguous
crossings remain errors. The model is bounded to the playable 192 m crop.
Outside that crop clearance/continuity audits use the retained solved context
profiles; inside it ground clearance is checked against the actual canonical
terrain mesh. `design_profile` preserves this distinction. Terrain projection
uses additional fitting iterations to suppress sample-scale road bumps.

Junction rails exclude connected deck entrances and guard the inferred platform
edges. Rails follow profile height at one-metre intervals, and Blender batches
those faces per surface. Building-overlap portions remain blocked and are
excluded from the supporting deck with an omission report; no garage floor or
building-passage route is invented. Vehicles use their copied collision outlines
for support, with a 6 cm edge tolerance matching physical contact penetration.
Transitions search only through locally continuous source-node portals.

Deck rendering uses tightly bounded patches within 32 m cells, with explicit
surface identity and lower-to-upper draw ordering. Output acceptance checks all
images, visible-deck coverage and the existing 256 MiB decoded-image ceiling.
Generation now also rechecks frozen inputs at completion, so an in-flight
renderer change cannot silently become accepted output.

`verify_generation_layered.py` reruns the eight acceptance requests serially and
records cached submission separately from fresh rendering. Run it when actual
generation acceptance is needed; it can be expensive without cached builds.

Synthetic `junctions` adds a Y junction, an upper deck crossing two lower decks
and a ground road below. `verify_layered.cjs` checks all four vehicles with
ordinary throttle/steering/reverse inputs after spawn. Its deterministic clock
is distinct from real-time performance checks. Reversing manoeuvres, where used,
are recorded; no pose edits occur after spawn. `layered-generation-verification.json`
records fresh v10.13 terminal statuses for the four original Halifax coordinates
and fixtures. All four previously failing requests built successfully; two crops
contain only bridge fragments near their boundaries, so they do not count as
complete elevated driving corridors. Cropped routes are reported explicitly. Development contact checks with overridden model data are marked
`modelOverride` and do not count as rendered acceptance.


### Retained initial acceptance (v10.7-v10.9)

V10.9 fixes a `MultiPoint` intersection being misreported as overlapping source
lines: every discrete ground-road crossing now contributes clearance checks.
Actual shared centreline segments still fail. Elevated branch nodes are detected
before bridge ways can be arbitrarily concatenated, with an explicit unsupported
layout message and `retryable: false`. The picker hides retry for these failures;
a new map selection remains available, and transient failures still offer retry.

Under v10.9 the four reported Halifax requests were rejected as branching
Burdock Way/North Bridge viaducts beyond the then-current simple-deck model.
The connected-network extension below supersedes that restriction. Previous successful scenes
remain playable while new versions generate. `halifax-verification.json` records
the actual reruns; `error-ui-verification.json` records fresh browser checks of
unsupported versus transient failures. New geometry regressions cover repeated
crossings, true line overlaps and branched elevated junctions. A fresh v10.9
synthetic overpass completed Blender generation and all nine tile/bridge-pass
checks, then passed upper/lower driving, collisions, occlusion and lifecycle
checks with all four vehicles. The freeze audit passed all ten editions.


The v10.14 bridge extension passed 128 Python tests and the JavaScript surface/contact
regressions. The retained v10.8 desktop Edge checks cover all four vehicles, both directions
above and below a synthetic overpass, rail/support collisions, occlusion,
level-preserving recovery, pause, scene changes, reload and missing-image retry.
Flat driving matches the preserved vehicle runtime over 255 physics steps per
vehicle. The eight-percent hill fixture produces the expected acceleration
ordering: uphill, flat, downhill.

London Hornsey Lane, Berlin Schlesische bridge and Fribourg Gottéron have visible
bridge passes and complete mapped-route checks: 56 traversals across four
vehicles and both directions, including lower roads where present. Those tests
use steering/throttle inputs after spawn and check for unintended level changes,
recovery and physics-body replacement. They establish prototype route behavior,
not surveyed geometry or worldwide visual acceptance.

Four separate held-out requests were generated end to end without manual crop
or geometry adjustment using `bridges-v10.7`. Its renderer/model inputs are
identical to v10.8; only visible-bridge counting/default selection changed.
**Zero of four produced a visible bridge in the playable crop.** Coimbra and
Porto built ordinary areas with nine tiles and no bridge pass; Lyon failed on
an unsupported tunnel and Cologne on overlapping bridge/ground source lines.
Coimbra's automatic road snap moved the requested centre 154 m. The current
baseline-road snapping policy and incomplete source matching therefore limit
automatic bridge coverage. A context-only bridge record is not bridge acceptance;
the gallery and driving HUD count visible baked passes.

The initial Edinburgh selection also failed protected-pavement geometry checks,
and the attempted new Kreuzberg build hit a source-topology error. Those failed
attempts remain available with their diagnostics. A fresh read-only browser test
passed all four vehicles on the existing v9 Kreuzberg scene, which is preserved.

The eight retained v10.8 playable areas have revalidated nine-tile outputs,
image hashes/dimensions, terrain-plane alignment and content identity. Builds
upgraded after v10.4 reuse unchanged rendered images through explicit
viewer-only cache records, new job/content identities and repeated acceptance;
they do not claim a fresh Blender render or fresh source download. First-build
times and the complete reuse chain remain in each job. Held-out source reports,
generation reports and current browser reports deliberately retain their own
version identities.

### Evidence and measurements

Evidence: `layered-acceptance-summary.json`, `layered-generation-verification.json`, `layered-route-verification.json`,
`layered-occlusion-verification.json`, `verification.json`, `mapped-route-verification.json`,
`performance-verification.json`, `map-picker-verification.json`,
`heldout-generation-verification.json`, `heldout-bridge-acceptance.json`,
`visual-review.json`,
`pending-verification.json`, `v9-regression-verification.json`,
`viewer-upgrade-report.json` and `audit.json`. Pending-job checks exercised the
retained playable scene during actual generation; picker checks also cover
cached reuse, stale responses, failure/retry, offline tiles and narrow layout.
Performance is measured on this desktop in ordinary real-time Edge driving;
it is not Android acceptance. See the report for per-scene frame/load/memory
measurements and the distinction between steady images and process memory.
The final v10.8 run measured 60.03-60.31 mean fps, 16.8-16.9 ms p99 frame
times, 292-764 ms local cached scene loads and 144.0-185.2 MiB steady decoded
images across eight scenes. Loads exclude generation and cold source acquisition.

## Sources

Inherited Overture / OpenStreetMap, ESA WorldCover, Meta/WRI canopy, historical
Berlin pavement-survey, Poly Haven CC0 and RacingVibes credits remain as in
[v9](../batch_v9/README.md) and its linked editions.

- OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
- Bridge / layer / elevation semantics:
  https://wiki.openstreetmap.org/wiki/Key:bridge ,
  https://wiki.openstreetmap.org/wiki/Key:layer ,
  https://wiki.openstreetmap.org/wiki/Key:ele
- Terrain: Mapterhorn and its upstream open-data providers:
  https://mapterhorn.com/attribution . Berlin terrain is from Geoportal Berlin;
  retain the provider's full linked attribution and applicable licence.
- AWS Terrain Tiles fallback and upstream attribution:
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md

See [the implementation plan](../BRIDGE_SYSTEM_PLAN.md) for design rationale and
the intended progression from synthetic proof through mapped/unseen-site checks.
