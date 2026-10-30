from pathlib import Path
from PIL import Image
import json,hashlib
ROOT=Path(__file__).resolve().parent;Image.MAX_IMAGE_PIXELS=100000000
im=Image.open(ROOT/'baked/street-6144.png').convert('RGB');out=ROOT/'baked/tiles';out.mkdir(exist_ok=True)
files=[]
for y in range(3):
 for x in range(3):
  p=out/f'{x}_{y}.webp';im.crop((x*2048,y*2048,(x+1)*2048,(y+1)*2048)).save(p,quality=95,method=6)
  files.append({'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(ROOT/'baked/manifest.json').write_text(json.dumps({'metres':192,'pixels':6144,'pixels_per_metre':32,'tile_metres':64,'tile_pixels':2048,'extent':[-96,-96,96,96],'files':files},indent=2));print('Baked tiles ready',sum(f['bytes']for f in files),'bytes')
