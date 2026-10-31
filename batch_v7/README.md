# Road markings and signals edition

Open http://127.0.0.1:47849/ or run `batch_v7/launch.py` with the existing Earth Python environment. `/gallery.html` lists local generated areas. Version 6 remains on 47848 with its renderer, scenes and search fix preserved.

## What is added

- Longitudinal centre/lane dividers from usable mapped lane counts, respecting `lane_markings=no`. Marked-lane presence and lane-count-only inference are distinguished. Unknown counts, implausible widths, ambiguous odd directional splits and unsupported roundabout layouts are omitted. Separate mapped solid/dashed/lane-divider/stop-line geometries are supported where present.
- Marked crossing ways/nodes select zebra-style or paired-line paint. Explicitly unmarked and unspecified crossings do not automatically receive zebra stripes. Separately mapped crossing paths take priority over nearby node approximations. Other marking styles remain unsupported.
- Stop/give-way and signal stop lines are associated with mapped controls. A control tag establishes control presence, not a surveyed painted stop line: paint presence/extent can be inferred. Turn arrows use explicit turn-lane data on supported one-way layouts; turn permissions do not prove physical arrows, so their presence/layout are approximate.
- Stop/give-way signs and traffic-light poles/housings/lenses are authored in Blender. A mapped control may denote a junction centre or stopping position rather than a physical pole. Roadside placement, pole counts and dimensions are inferred; junction-centre abstractions are expanded into eligible incoming approaches. Ambiguous unconnected controls and obstructed pole locations are omitted.
- Optional coloured **plan-view signal indicators** use a 24-second illustrative two-axis cycle with amber and all-red intervals. The clock pauses with the drive, resets on scene change/reload, and has no background interval. This is not a real schedule, traffic AI, right-of-way enforcement, dynamic illumination or a reconstruction of protected turns. The baked vertical signal hardware remains unlit.

Paint is constructed as geometry and clipped inside the existing carriageways, away from buildings. Longitudinal dashes stop around inferred junction mouths and mapped crossing/control areas. Widths, dash/gap patterns, colours, stop-line dimensions and wear are approximations. Coarse geographic profiles provide continental white, British/Irish left-driving white and US-style yellow directional separation; these are explicit heuristics, not surveyed country boundaries or universal road standards. Same-direction lane dividers remain white in the supported US-style profile.

Existing road geometry is retained, so paint does not correct inaccurate carriageway widths, elevation, bridge layering or intersection shapes. Road snapping and the driving-road filter exclude transport/unknown classes; unsupported source geometry can still appear in the inherited ground rendering. Bus/cycle lane paint, parking restrictions, traffic vehicles, pedestrians and live lighting remain outside this edition.

## Sources and reproducibility

The independent OSM evidence/cache schema retains signal, crossing, stop, give-way and road-marking nodes alongside existing highway ways and node connections. Existing map adapters and their installation are unchanged. Source snapshots, `street-report.json`, prepared geometry, `traffic-assets.json`, logs and nine tile hashes remain under ignored `custom/place-*/`. Reports distinguish paint/control evidence, inferred style/placement, skipped cases and regional profile. Feature records describe pre-clipping candidates; playable geometry is measured separately by `audit.json`.

`freeze.json` versions renderer inputs and material manifests. Earlier editions and evidence remain untouched. New renderer code needs a new version and cache identity. Viewer-only fixes can be maintained separately. The current scene remains playable while another persistent serial job runs, and generation submission does not mean completion.

## Commands

From the repository root in PowerShell:

```powershell
$earthPython = "$env:LOCALAPPDATA\Programs\BeamNG.Earth.Berlin.Realism\.venv\Scripts\python.exe"
& $earthPython batch_v7/launch.py
& $earthPython batch_v7/test_streets.py
node batch_v7/test_signals.cjs
& $earthPython batch_v7/test_sites.py
& $earthPython batch_v7/test_pavements.py
& $earthPython batch_v7/test_road_types.py
& $earthPython batch_v3/test_roof_styles.py
& $earthPython batch_v7/audit.py
node batch_v7/verify.cjs
node batch_v7/verify_signals.cjs
& $earthPython batch_v7/stop.py
```

Use the pinned portable Blender with `--background --factory-startup --python-exit-code 1 --python batch_v7/verify_traffic_assets.py` to build the editable `street-kit.blend` reference and `street-kit.png`. That kit checks asset construction, not geographic accuracy. Blender modules use bundled Python libraries only; no packages are installed into Blender.

The audit verifies earlier frozen inputs, completed-scene tiles/dimensions, paint containment and inferred pole exclusion from buildings/carriageways, plus inherited ground/collision checks. It needs completed local scenes and reports zero scene checks without them. It records the inherited millimetre ring-rounding and small-island export tolerances.

The real browser tour checks driving, pause/recovery, vehicles, switching, cache/reload and controlled tile failure/retry. Picker lifecycle uses a mock job; `verify_pending.cjs` separately checks an actual pending generation. Signal tests cover the real illustration clock, pause, phases, toggle and reset. Stationary desktop FPS readings are not driving benchmarks or Android acceptance.

## Attribution and interpretation

Map features: OpenStreetMap contributors, ODbL, https://www.openstreetmap.org/copyright . Schema references: https://wiki.openstreetmap.org/wiki/Key:lane_markings , https://wiki.openstreetmap.org/wiki/Key:road_marking , https://wiki.openstreetmap.org/wiki/Tag:highway%3Dtraffic_signals , https://wiki.openstreetmap.org/wiki/Key:traffic_signals:direction , https://wiki.openstreetmap.org/wiki/Key:crossing:markings . Mapping is incomplete and does not establish current physical state or signal schedules.

Previous ground/building geometry, Berlin 2014/2015 survey, WorldCover, Meta/WRI canopy, copied RacingVibes physics/artwork and **Powered by Poly Haven** CC0 microdetail retain their credits and licences in `../batch_v6/README.md`, `../batch_v5/README.md` and `assets/materials/batch-manifest.json`. Paint and traffic hardware are authored here; no new texture downloads or game assets are used.

The Berlin signal sample was selected from mapped controls before rendering; New York and London exercise supported regional layouts. These are targeted integration samples, not blind worldwide visual-acceptance tests. Real-world paint layout, hardware placement and timing require better evidence than lane counts and control nodes alone.

## Development evidence

`development-v7.1/` retains the initial renderer. Its first local build was stopped during slow inherited fence assembly and the queued jobs were superseded; these are not accepted renders. Version 7.2 batches the same cuboid specifications by material/bevel, retaining metric masonry UVs. The batched boundary kit was built/rendered inside Blender before the new scene run. No earlier edition was edited for this optimisation.

## Delivered local checks

For `streets-v7.2`, 51 Python unit tests pass, together with JavaScript spawn/ground checks and the signal phase/conflict/pause/reset checks. Both the traffic/sign kit and batched boundary kit build and render inside the pinned Blender. The editable references are `street-kit.blend` and `boundary-kit.blend`; these are asset references, not geographical acceptance evidence.

Four custom scenes reached `built`: Berlin signal approaches, London/Trafalgar Square, New York/City Hall and New York/Broadway. All 36 tile hashes/dimensions and all earlier renderer hashes passed the audit. Playable paint areas are about 14 m² (Berlin), 157 m² (London), 251 m² (City Hall area) and 79 m² (Broadway). These areas describe generated paint, not verified real-world coverage.

The first final-version builds took about 176, 170, 200 and 187 seconds respectively, using existing source-download caches where available. Browser readiness in the four-scene tour was 0.40–0.60 s; cached-generation responses were 0.008–0.011 s. These are separate measurements, not cold-download or mobile benchmarks. Boundary batching avoids thousands of per-cuboid operator calls; no uncompleted v7.1 run is counted as a successful timing comparison.

The four-scene browser tour passes actual driving, all four vehicles, pause/recovery, switching, reload/cache, controlled missing-tile retry, picker lifecycle and the real New York place search. Picker lifecycle uses a mock job, separately from real background-job driving in `pending-verification.json`. `signal-verification.json` checks actual clock progression, pause, phase changes, toggle, no conflicting green axes in the illustrative model, and switch/reload reset. See `verification.json`, `unit-verification.json` and `audit.json`.

Visual review retains City Hall as a limited plaza-centred result; the Broadway scene was added using a mapped street position to provide a road-focused preview. Berlin, London and Broadway are candidate integration improvements, with approximate layouts and underlying geometry. No per-scene geometry repair was performed. See `visual-review.json`.

A real server stop/relaunch retained all four completed scenes, and each rendered its nine cached tiles afterwards. Signal pause/phase/toggle/reset checks also pass after restart. See `restart-verification.json` and `signal-verification.json`. Settled stationary desktop samples were approximately 60 FPS; these are not driving or Android benchmarks.
