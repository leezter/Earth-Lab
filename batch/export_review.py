"""Write the completed experiment's summary and offline gallery; no scene edits."""
from pathlib import Path
import json,statistics,urllib.request
ROOT=Path(__file__).resolve().parent
r=json.loads((ROOT/'report.json').read_text())
b=json.loads((ROOT/'browser-verification.json').read_text())
times=[s['total_seconds']for s in r['sites']if s['status']=='built']
summary={
 'experiment':r['freeze'],'technical_built':len(times),'attempted':len(r['sites']),
 'runtime_driving_passes':sum(s.get('movement',False)for s in b['results']),
 'automatic_screenshots':sum(s.get('screenshots',0)for s in b['results']),
 'visual_candidates':2,'visual_limited':3,'visual_rejected':1,
 'exact_real_world_accuracy_validated':False,
 'source_hashes_unchanged':r['source_hashes_unchanged'],
 'manual_baked_scene_edits':0,
 'general_viewer_fix':'clear-spawn-v1; original failing test retained',
 'configured_material_sets':11,'pixels_per_metre':32,
 'tile_bytes_total':sum(s.get('tile_bytes',0)for s in r['sites']),
 'build_seconds_min':min(times),'build_seconds_max':max(times),
 'build_seconds_median':statistics.median(times),
 'next_data_gap':'Use raster land cover and canopy data to distinguish forest, fields, bare ground and water; rerun the batch as a new frozen version.'
}
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2))
with urllib.request.urlopen('http://127.0.0.1:47843/gallery.html',timeout=5)as response:
 page=response.read().decode()
page=page.replace('src="reviews/','src="web/reviews/')
page=page.replace('href="reviews/','href="web/reviews/')
page=page.replace('href="/?site=','href="http://127.0.0.1:47843/?site=')
page=page.replace('href="/api/report"','href="report.json"')
(ROOT/'Review.html').write_text(page,encoding='utf-8')
print(json.dumps(summary,indent=2))
