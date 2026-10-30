from pathlib import Path
import sys,json,webbrowser,html
from urllib.parse import urlparse,parse_qs
from http.server import SimpleHTTPRequestHandler
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent;sys.path.insert(0,str(REPO))
import earth_backend as baseline
def report():return json.loads((ROOT/'report.json').read_text())
def sites():return report()['sites']
class Handler(baseline.Handler):
 def __init__(self,*a,**kw):SimpleHTTPRequestHandler.__init__(self,*a,directory=str(ROOT/'web'),**kw)
 def translate_path(self,path):
  u=urlparse(path)
  if u.path.startswith('/rv/'):return str(REPO/'web'/u.path.lstrip('/'))
  if u.path.startswith('/baked/'):
   parts=u.path.split('/');sid=parts[2]if len(parts)>3 else '';name=parts[3]if len(parts)>3 else ''
   if sid in [s['id']for s in sites()]and name in [f'{x}_{y}.webp'for x in range(3)for y in range(3)]:return str(ROOT/'runs'/sid/'baked/tiles'/name)
  return super().translate_path(path)
 def raw(self,text,mime='text/html; charset=utf-8'):
  b=text.encode();self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_GET(self):
  u=urlparse(self.path);q=parse_qs(u.query)
  if u.path=='/api/health':return self.reply({'ok':True,'edition':'six-settings-batch'})
  if u.path=='/api/sites':return self.reply(sites())
  if u.path=='/api/report':return self.reply(report())
  if u.path=='/api/summary':return self.reply(json.loads((ROOT/'summary.json').read_text()))
  if u.path=='/config.js':return self.raw('window.EARTH_BATCH_SITES='+json.dumps(sites())+';','application/javascript; charset=utf-8')
  if u.path=='/api/data':
   sid=q.get('id',['berlin'])[0];entry=next((s for s in sites()if s['id']==sid),None)
   if not entry or entry['status']!='built':return self.reply({'error':'Scene unavailable: '+str(entry.get('error',entry['status'])if entry else sid)},503)
   return self.reply(json.loads((ROOT/'runs'/sid/'district-data.json').read_text()))
  if u.path=='/gallery.html':
   review=json.loads((ROOT/'visual-review.json').read_text())if(ROOT/'visual-review.json').exists()else {}
   cards=[]
   for s in sites():
    sid=s['id'];result=review.get(sid,{});title=html.escape(s['name']);status=html.escape(result.get('status','Not visually reviewed'))
    if s['status']=='built':
     cards.append(f'<section><h2>{title}</h2><p>{html.escape(s["setting"])} · {status} · {s.get("buildings",0)} building sections · {s.get("trees",0)} trees</p><p>{html.escape(result.get("notes",""))}</p><p>Generated in {s["total_seconds"]/60:.1f} min · nearest-road centre adjustment {s["automatic_road_snap_metres"]:.1f} m</p><a href="/?site={sid}">Drive this scene</a><div class="pair"><a href="reviews/{sid}-overview.png" target="_blank"><img src="reviews/{sid}-overview.png" alt="{title} overview"></a><a href="reviews/{sid}-close.png" target="_blank"><img src="reviews/{sid}-close.png" alt="{title} close driving view"></a></div></section>')
    else:cards.append(f'<section><h2>{title}</h2><p>{html.escape(s["status"])}: {html.escape(s.get("error","Pending"))}</p></section>')
   return self.raw('''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Earth Lab · Six settings</title><style>body{background:#14232b;color:#eaf0ee;font:16px system-ui;line-height:1.6;max-width:1700px;margin:auto;padding:30px}a{color:#87ddc5}p{max-width:1100px}section{margin:40px 0}img{width:100%;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:1000px){.pair{grid-template-columns:1fr}}</style><h1>Earth Lab · Six settings, one frozen generator</h1><p>Each scene uses the same frozen rules, 32 pixels per metre and 48 Cycles samples. Material selection follows mapped tags, building/land-use geometry and coarse regional fallbacks. No individual scene was manually repaired. Screenshots are automatic browser captures, at matching camera settings.</p><p>Technical generation success and visual acceptance are reported separately. Missing trees, unsuitable defaults, flattened hills and generic architecture are limitations, not proof of exact real-world reproduction. <a href="/api/report">Build report</a></p>'''+''.join(cards)+'<p>Powered by Poly Haven · CC0 materials. Map data: Overture Maps / OpenStreetMap contributors and upstream sources. Vehicles and physics: RacingVibes.</p>')
  return super().do_GET()
if __name__=='__main__':
 s=baseline.Server(('127.0.0.1',47843),Handler);(ROOT/'server-token.txt').write_text(baseline.STOP_TOKEN);print('Six-setting batch: http://127.0.0.1:47843',flush=True)
 if '--no-browser'not in sys.argv:webbrowser.open('http://127.0.0.1:47843/gallery.html')
 s.serve_forever()
