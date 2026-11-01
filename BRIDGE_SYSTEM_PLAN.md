# Bridge and elevation system plan

Status: initial fixed-bridge implementation delivered, 1 November 2026, in
[batch_v10](batch_v10/README.md), port 47852. The design below records the
original plan; the edition README documents implemented behavior, current
verification and remaining coverage limits. A subsequent connected-network extension
adds branched junctions and ordered stacked fixed decks; see the current edition
README for its constraints and acceptance evidence.

Yes: Earth Lab can support bridges, roads at different heights and hills while
retaining its top-down presentation. The recommended first implementation is
2.5D: existing horizontal vehicle physics plus explicit supporting surfaces,
height profiles, slope forces and height-aware collision/visibility. Full 3D
rigid-body physics is a separate, substantially larger project.

A bridge does not always require an artificial hill: a deck can connect banks
already at the appropriate height. Generate approach ramps only where the road
profile and surrounding terrain require them.

## Constraints verified before implementation (v9)

- [Current edition](batch_v9/README.md): `mobility-v9.4`, port 47851, bounded
  192 m scenes and nine 2048-square baked tiles. Earlier editions are preserved.
- `batch_v9/scene_builder.py` buffers and unions carriageways into one 2D driving
  footprint. Crossings lose their separation in that representation.
- `earth_backend.py` retains an OSM layer attribute as `level`; it is neither a
  physical elevation nor a complete bridge/topology model.
- `batch_v9/pavement_sources.py` retains OSM way node IDs and tags, but its
  relevance filter omits some bridge/support features and elevation-only nodes.
  Relation membership also needs richer identity/topology retention.
- `batch_v9/prepare.py` makes mostly flat surface meshes. Existing kerb ramps
  have baked visual heights; these do not affect vehicle physics.
- `batch_v9/web/app.js`, `driving.js` and `spawn.js` use XY contact, scenery
  collision and recovery. Static collisions are installed by rebuilding the
  Planck world at spawn; that must not happen during a bridge transition.
- `batch_v9/web/baked.js` draws one opaque atlas below the car. It cannot show a
  car underneath a bridge correctly.
- `batch_v9/batch_server.py` serves `/rv/` from the shared `web/rv/` snapshot.
  Changing that runtime directly would affect earlier editions.

## Architecture decisions

1. Create `batch_v10/` from the current edition, with proposed renderer identity
   `bridges-v10.1`, independent jobs/cache/freeze and port 47852 after checking
   availability. Preserve v9 and every earlier freeze. Give v10 an isolated
   runtime copy or extension point before changing shared physics behaviour.
2. Separate ground terrain from road surfaces. Ground has one height per XY
   point; a bridge deck is an additional surface at the same XY coordinates.
   One terrain heightmap alone cannot represent an overpass.
3. Build connectivity from source topology and compatible surface endpoints.
   Two lines crossing on screen do not automatically form a junction. Do not
   assign a global floor to all roads with the same OSM layer number.
4. The car keeps an active supporting surface and local height. It changes
   surfaces only through valid connections, using continuity and hysteresis.
   Nearest XY road or closest height alone must never select its level.
5. Use the same generated surface geometry/profile for Blender, vehicle contact,
   collision and validation. Keep metres, map drawing units and Planck units
   explicit, and preserve existing simulation timing in the initial integration.

## Implementation sequence and completion gates

### 1. Prove stacked driving on a small synthetic fixture

Before map ingestion or expensive scene builds, create a flat lower road, an
upper deck, two approaches, deck barriers and ground-level supports.

Prototype surface selection, collision filtering in the bundled Planck version,
and separate ground/deck drawing. Inspect available force/contact APIs before
choosing an adapter; if necessary, change only v10's isolated runtime copy.
Set collision decisions before a simulation step or through a supported contact
filter, without destroying/rebuilding the world during contact callbacks.

Gate: drive above and below the same XY crossing in both directions; hit the
appropriate barriers/supports; keep position, velocity and steering continuous
at transitions; pause/recover correctly on both levels. Repeat with all four
vehicles. Record a fresh browser capture and deterministic trajectories.

### 2. Retain bridge evidence and compile a surface network

Add proposed `bridge_sources.py` and `surface_network.py`. Extend only v10's
parser to retain bridge ways/outlines/relations/supports, shared node identity,
road attributes and relevant node elevation evidence. Retain `bridge`, `layer`,
`tunnel`, `covered`, `embankment`, `cutting`, `ele`, `incline`, width, surface,
access and bridge structure/support tags where present.

Use OSM bridge ways as the authoritative bridge topology where available. Match
Overture/baseline roads explicitly, report ambiguous matches and prevent duplicate
ground ribbons beneath the same elevated road. Keep ground survey footprints
from overwriting elevated geometry. Interpret non-ground tags consistently
across roads, pavements, sites, lane paint, signals and furniture.

Export surfaces with stable IDs, source IDs, polygon/mesh, longitudinal profile,
material, allowed connections and mapped/inferred provenance. Export obstacles
with vertical bounds and surface associations. Keep ordering evidence separate
from metric elevation evidence.

Gate: an at-grade shared-node junction connects; a grade-separated crossing does
not; bridge endpoints connect to the correct approaches. Missing/contradictory
evidence produces explicit omissions or rejection, never an invented flat
junction. Tunnel tags are retained for ordering, with tunnel driving deferred.

### 3. Add terrain and solve continuous road/deck profiles

Add proposed `terrain_sources.py`, `terrain.py` and `bridge_geometry.py`.
First inspect the installed adapters read-only for usable elevation access and
existing dependencies. Select and pin a provider only after checking coverage,
licensing, datum, accuracy, download access and availability in this environment.
Prefer a suitable bare-earth DTM where available. A global DSM is only a coarse
fallback: buildings/trees must not become road hills.

Store source raster identity, resolution, nodata, vertical datum, conversions,
attribution and processing policy. Normalize elevations into one local metre
coordinate system. OSM `ele` and a selected raster may use different datums;
do not combine them as interchangeable heights. Any unresolved relative offset
must be explicit and must not imply surveyed clearance.

Derive smooth ground-road profiles from terrain and compatible mapped evidence.
Solve deck heights separately, with continuous endpoint heights/grades and
clearance constraints where another road passes below. Do not read the terrain
height under a bridge as its deck height, or multiply `layer` by a fixed height.
Missing deck heights may use a deterministic, labelled inferred design only
when it satisfies the constraints; retain its assumptions in the report.

Make grade, curvature, clearance and step tolerances explicit versioned settings.
Use fixture-based tolerances first, then calibrate against source quality and
vehicle behaviour; these are prototype acceptance rules, not engineering
certification. Clearance uses deck underside and conservative vehicle-height
bounds, which must be supplied or explicitly inferred rather than derived from
the existing sprites' width/length.

Fetch bounded context beyond the playable crop to solve approaches. For example,
a 6 m rise at 6% grade requires about 100 m of horizontal approach on each side;
both ramps and a span may exceed a 192 m scene. Do not squeeze ramps to fit.
Keep the playable area bounded; reject incomplete unsafe transitions or choose
a sample with usable approaches. Larger scenes are a separate scope decision.

Gate: no height jumps, impossible inferred grades, deck/terrain intersections or
unresolved crossing clearance. Missing terrain can use a reported flat-ground
fallback for eligible scenes; reject scenes whose bridge validity depends on
unavailable elevation. Report modelled hills separately from inferred ramps.

### 4. Generate and bake height-aware scenery

Update v10's `scene_builder.py`, `prepare.py`, `bake.py` and `tiles.py` around the
surface model. Compile roads/material ownership per connected compatible
surface instead of unioning all carriageways together. Make decks, approach
embankments/cuttings and suitable generic parapets/supports. Structure style,
dimensions and unobserved supports remain inferred; do not claim replicas.

Anchor building bases, walls, roofs, pavements, kerbs, vegetation, boundaries
and street furniture to their supporting terrain/surface. Keep water levels
coherent and bridge approaches out of water. Validate meshes in XYZ as well as
retaining the existing XY coverage/material gates.

Bake the normal nine ground tiles with bridge decks hidden from the camera but
their appropriate ground shadows retained. Add sparse transparent deck/occluder
patches with world bounds, height/surface metadata and hashes. Start with simple
non-overlapping decks; explicitly reject unsupported overlapping structures.
Draw the car below or above each deck patch according to its active surface,
then draw appropriate rails/overhead structure. Under a solid deck the car is
occluded; an optional outline can aid navigation without revealing the lower
road as if it were above the bridge.

Gate: correct occlusion and alignment on both routes, continuous ramps and no
tile seams. Decode only required patches and release them on scene disposal;
do not allocate another full 144 MiB atlas for every level. Measure actual peak
memory, load time and frame times against the existing desktop baseline before
setting a release budget. Top-down hills are conveyed primarily by shading and
driving response; dramatic side views require a later camera/rendering change.

### 5. Integrate elevation into normal driving

Add proposed `web/elevation.js` and `web/bridge-collision.js`; update v10's
`app.js`, `driving.js`, `ground.js` and `spawn.js`.

Resolve centre/corner contact on the active connected surface, including ground
off-road contact. Calculate height and slope continuously across profile
segments. Apply a grade acceleration projected along the surface in the
isolated physics integration; calibrate its units/timestep against zero-slope
baseline trajectories. Uphill slows acceleration; downhill assists motion.
Recompute any displayed speed consistently with the chosen surface-distance
definition. This remains constrained surface driving without suspension/jumps.

Filter collisions by vertical overlap and surface association: deck rails block
deck traffic, supports block vehicles at their actual height and unrelated
ground obstacles do not block elevated vehicles. Connected approach surfaces
can share collisions even when their IDs differ. Check swept motion at speed
so a car cannot skip a transition or bypass a barrier between ticks.

Spawn/recovery must use a reachable safe surface with full vehicle clearance,
preserve the active level where possible and never teleport to the road below.
For the first release, unprotected elevated edges or invalid support trigger a
controlled recovery to the last safe pose. Falling, jumping, rollovers and
realistic impacts between heights are deferred to full 3D physics.

Gate: all four vehicles retain flat-road handling, traverse slopes in forward
and reverse, cannot switch levels at crossings, and preserve expected pause,
recovery, vehicle-switch and boundary behaviour.

### 6. Publish reproducible jobs and validate real locations

Extend v10's `custom_worker.py`, `custom_places.py`, `job_validation.py`, manifest
and independent audit. Include terrain source/content hashes, surface network,
inference policy and added render outputs in job/cache identity. Freeze runtime
inputs as well as renderer inputs for reproducible acceptance evidence.

Keep the current scene playable during generation. Mark a job built only after
all nine base tiles, every declared bridge patch and all required geometry and
connectivity/clearance checks pass. Retain source inputs, `terrain-report.json`,
`bridge-report.json`, `surface-network.json`, logs and rejection reasons.

Use synthetic regressions for crossings, sloped endpoints, duplicate sources,
missing tags/heights, source failure, high-speed transitions, crop boundaries,
multi-span/curved decks and unsupported structures. Then choose mapped examples
covering a river bridge, a road overpass with both routes accessible, and a
hilly road with a bridge, plus a flat v9 regression scene.

Run Python geometry/profile tests, JS contact/collision tests, and fresh browser
driving on both levels with all vehicles. Check pause/recovery, switching,
reload/cache, scene disposal, pending generation and missing-patch failure/retry.
Wait for terminal real job status, audit all output hashes and verify actual HTTP
and rendered pages after restart. Preserve earlier frozen editions. Distinguish
cached generation from cold acquisition and browser loading.

Gate: independently accepted meshes/tiles, successful real driving and explicit
visual review for every selected sample. Freeze before testing additional unseen
bridges, record accepted/rejected counts, and make no worldwide or Android
acceptance claim from the initial samples.

## Initial release boundary and delivery order

First deliver the synthetic overpass proof (step 1), then one mapped river bridge
end-to-end through steps 2-6. Add a real road-over-road crossing next, followed
by terrain-driven hills and broader unseen-site validation. The schema supports
elevation from the start, even if the first bridge uses flat surrounding terrain.

Initial scope: fixed bridges, simple spans/curves, ordinary approaches, ground
plus one elevated deck at a crossing, slope response and correct under/over
behaviour. Detect and report movable bridges, complex stacked interchanges,
tunnels, multistorey parking and other unsupported structures. No new traffic,
audio, live lighting, streaming or full 3D vehicle simulation is implied.

## External data references

- [OSM bridge](https://wiki.openstreetmap.org/wiki/Key:bridge): bridge-tagged
  transport ways and separately mapped structure outlines are distinct evidence.
- [OSM layer](https://wiki.openstreetmap.org/wiki/Key:layer): relative ordering at
  overlaps, not metric height or a global storey identifier.
- [OSM elevation](https://wiki.openstreetmap.org/wiki/Key:ele): sparse absolute
  elevation evidence, normally referenced to EGM96; feature meaning matters.
- [Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM):
  candidate fallback only. GLO-30 is a 30 m DSM including structures/vegetation,
  with EGM2008 vertical reference; it cannot supply individual bridge clearances.
  Provider selection and source attribution remain implementation requirements.
