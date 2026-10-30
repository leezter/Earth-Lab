"""Blender background build: actual 3D geometry/PBR lighting -> orthographic game tiles."""
import bpy,math,json,random,sys,time
from pathlib import Path
from mathutils import Vector
REPO=Path(__file__).resolve().parent.parent
ROOT=Path(sys.argv[sys.argv.index('--work-dir')+1]).resolve()
args=sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []
preview='--preview'in args;SIZE=192;PIXELS=2048 if preview else 6144
s=json.loads((ROOT/'geometry.json').read_text());assets=json.loads((REPO/'assets/materials/batch-manifest.json').read_text(encoding='utf-8-sig'))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24 if preview else 48;scene.cycles.use_denoising=True;scene.cycles.max_bounces=5;scene.cycles.transparent_max_bounces=4
try:
 prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
 for d in prefs.devices:d.use=d.type=='OPTIX'
 if any(d.type=='OPTIX'for d in prefs.devices):scene.cycles.device='GPU'
except Exception as e:print('GPU fallback',e)
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.76,.83,.92,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.65
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.15
def basic(name,color,rough=.8,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
def pbr(assetid):
 a=next(a for a in assets if a['id']==assetid);m=basic(assetid,(.4,.4,.4));n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 for f in a['files']:
  tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(REPO/f['path']),check_existing=True)
  if f['kind']=='Diffuse':l.new(tex.outputs['Color'],p.inputs['Base Color'])
  else:
   tex.image.colorspace_settings.name='Non-Color'
   if f['kind']=='Rough':l.new(tex.outputs['Color'],p.inputs['Roughness'])
   elif f['kind']=='nor_gl':
    norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.65;l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],p.inputs['Normal'])
 return m,float(a['metadata'].get('dimensions',[3000])[0])/1000
materials={a['id']:pbr(a['id'])for a in assets}
# Neutral summer ground rather than the dry yellow cast of the source scan.
gm=materials['aerial_grass_rock'][0];nn=gm.node_tree.nodes;ll=gm.node_tree.links;pp=nn.get('Principled BSDF');tex=next(n for n in nn if n.type=='TEX_IMAGE' and '_diff_' in n.image.name);mix=nn.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.7;mix.inputs[2].default_value=(.42,.68,.32,1);ll.new(tex.outputs['Color'],mix.inputs[1]);ll.new(mix.outputs[0],pp.inputs['Base Color'])
watermat=basic('River water',(.045,.10,.095),.16,.15)
concrete=basic('Pale weathered limestone kerb',(.52,.51,.46));wallmat=basic('Warm mineral render',(.53,.50,.43));metal=basic('Zinc flashing',(.24,.28,.29),.38,.7);glass=basic('Skylight glass',(.085,.16,.19),.18,.4);brick=basic('Chimney brick',(.28,.15,.1));soil=basic('Courtyard compacted earth',(.24,.23,.18))
def mesh(name,verts,faces,material,scale=3,angle=0):
 # Input map rings use south-positive coordinates. Flip any downward top faces
 # after conversion to Blender's north-positive Y; normal maps need outward normals.
 faces=[list(reversed(f))if (Vector(verts[f[1]])-Vector(verts[f[0]])).cross(Vector(verts[f[2]])-Vector(verts[f[0]])).z<-.00001 else f for f in faces]
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.data.materials.append(material)
 uv=me.uv_layers.new(name='Metric UV');cs,sn=math.cos(angle),math.sin(angle)
 for face in me.polygons:
  for li in face.loop_indices:
   v=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=((v.x*cs-v.y*sn)/scale,(v.x*sn+v.y*cs)/scale)
 return ob
def cube(name,location,scale,mat,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 if bevel:
  m=o.modifiers.new('Soft manufactured edges','BEVEL');m.width=bevel;m.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def lines(name,points,radius,mat):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=1;p=cu.splines.new('POLY');p.points.add(len(points)-1)
 for v,pt in zip(p.points,points):v.co=(*pt,1)
 o=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(o);o.data.materials.append(mat);return o
mesh('Earth base',[(-450,-450,-.13),(450,-450,-.13),(450,450,-.13),(-450,450,-.13)],[(0,1,2,3)],materials[s.get('context',{}).get('ground','brown_mud_dry')][0],materials[s.get('context',{}).get('ground','brown_mud_dry')][1])
for kind,g in s['flat'].items():
 if not g['faces']:continue
 asset={'roads':'asphalt_02','asphalt':'asphalt_02','cobble':'cobblestone_floor_03','concrete':'concrete_pavement','dirt':'brown_mud_dry','gravel':'gravel_floor','pavements':'concrete_pavement','green':'aerial_grass_rock','gardens':'aerial_grass_rock','water':'asphalt_02'}[kind]
 mat,sc=materials[asset]
 if kind=='water':mat=watermat
 z=.14 if kind=='pavements'else .025 if kind in ['green','gardens']else .003 if kind=='roads'else .01
 mesh(kind,[(x,-y,z)for x,y in g['vertices']],g['faces'],mat,sc)
for part in s['roads']:
 for ring in part:
  if not any(abs(p[0])<140 and abs(p[1])<140 for p in ring):continue
  verts=[];faces=[]
  for x,y in ring:verts.extend([(x,-y,.01),(x,-y,.15)])
  for i in range(len(ring)-1):faces.append([2*i,2*i+1,2*i+3,2*i+2])
  mesh('Raised stone kerb',verts,faces,concrete)
for b in s['buildings']:
 rng=random.Random(b['seed']);h=b['height'];walls=[];faces=[]
 for part in b['parts']:
  for ring in part:
   for i in range(1,len(ring)):
    a,c=ring[i-1],ring[i];k=len(walls);walls.extend([(a[0],-a[1],0),(c[0],-c[1],0),(c[0],-c[1],h),(a[0],-a[1],h)]);faces.append([k,k+1,k+2,k+3])
   lines('Rain gutter',[(x,-y,h+.03)for x,y in ring],.07,metal)
 mesh('Mapped facade '+b['id'],walls,faces,wallmat)
 ring=b['parts'][0][0];longest=max(zip(ring,ring[1:]),key=lambda ab:(ab[0][0]-ab[1][0])**2+(ab[0][1]-ab[1][1])**2);angle=math.atan2(longest[1][1]-longest[0][1],longest[1][0]-longest[0][0])
 tag=str(b.get('material','')).lower()
 asset='corrugated_iron'if 'metal'in tag or 'zinc'in tag or b.get('industrial_inferred') else 'clay_roof_tiles_02'if 'tile'in tag else 'roof_slates_02'if 'slate'in tag else 'asphalt_02'if b['roof']=='flat'else s.get('context',{}).get('roof_default','roof_slates_02')
 mat,sc=materials[asset]
 rm=b['mesh'];roof=mesh('Pitched roof '+b['id'],[(x,-y,z)for x,y,z in rm['vertices']],rm['faces'],mat,sc,angle)
 # Place fittings on known roof vertices well away from eaves; do not fill courtyards.
 candidates=[v for v in rm['vertices']if v[2]>h+.7]if b['roof']!='flat'else rm['vertices']
 rng.shuffle(candidates);accepted=[]
 for x,y,z in candidates:
  if len(accepted)>=min(8,max(1,len(rm['vertices'])//100)):break
  if any((x-a)**2+(y-c)**2<25 for a,c in accepted):continue
  accepted.append((x,y));kind=rng.random()
  if kind<.55:
   cube('Stone chimney flashing',(x,-y,z+.12),(1.15,.9,.25),metal,.04);cube('Brick chimney',(x,-y,z+.65),(.65,.5,1.2),brick,.035);cube('Chimney cap',(x,-y,z+1.3),(.85,.7,.13),concrete,.03)
  else:
   cube('Rooflight frame',(x,-y,z+.18),(1.25,1.75,.32),metal,.06);cube('Rooflight glazing',(x,-y,z+.36),(1.08,1.58,.035),glass,.02)
# Lightweight botanical meshes: branching trunks and many individual leaf polygons, not shaded balls.
leafmats=[basic('Leaf '+str(i),c)for i,c in enumerate([(.10,.20,.065),(.16,.27,.085),(.23,.33,.10),(.27,.35,.13)])]
bark=basic('Tree bark',(.16,.12,.075))
for ti,t in enumerate(s['trees']):
 x,y,r=t['x'],-t['y'],t['r'];rng=random.Random(t['seed']);height=r*2.4
 lines('Tree trunk',[(x,y,0),(x+.1,y,height*.65)],.13,bark)
 for i in range(6):
  a=rng.random()*math.tau;lines('Tree branch',[(x,y,height*.4),(x+math.cos(a)*r*.7,y+math.sin(a)*r*.7,height*.8)],.05,bark)
 verts=[];faces=[]
 for i in range(1500):
  a=rng.random()*math.tau;rr=math.sqrt(rng.random())*r;lx=x+math.cos(a)*rr;ly=y+math.sin(a)*rr;lz=height*.63+math.sqrt(max(0,1-(rr/r)**2))*r*.8+rng.uniform(-.5,.5)
  w=rng.uniform(.12,.27);ang=rng.random()*math.tau;dx,dy=math.cos(ang)*w,math.sin(ang)*w;k=len(verts);verts.extend([(lx-dx,ly-dy,lz),(lx-dy*.55,ly+dx*.55,lz+.06),(lx+dx,ly+dy,lz),(lx+dy*.55,ly-dx*.55,lz-.04)]);faces.append([k,k+1,k+2,k+3])
 ob=mesh('Leaf canopy '+str(ti),verts,faces,leafmats[0])
 for m in leafmats[1:]:ob.data.materials.append(m)
 for p in ob.data.polygons:p.material_index=rng.randrange(len(leafmats))
# Physical sun + environment; bake shadows and material response into the ground view.
bpy.ops.object.light_add(type='SUN',location=(0,0,100));sun=bpy.context.object;sun.rotation_euler=(math.radians(24),math.radians(-16),math.radians(-25));sun.data.energy=2.1;sun.data.angle=math.radians(5)
bpy.ops.object.camera_add(location=(0,0,150));camera=bpy.context.object;camera.rotation_euler=(0,0,0);camera.data.type='ORTHO';camera.data.ortho_scale=SIZE;scene.camera=camera
scene.render.resolution_x=scene.render.resolution_y=PIXELS;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
scene.render.filepath=str(ROOT/'baked'/('preview.png'if preview else 'street-6144.png'));(ROOT/'baked').mkdir(exist_ok=True)
print('READY_TO_RENDER',len(scene.objects),'objects',scene.cycles.device,flush=True);start=time.monotonic();bpy.ops.render.render(write_still=True)
(ROOT/'bake-report.json').write_text(json.dumps({'renderer':'Blender Cycles','blender':bpy.app.version_string,'device':scene.cycles.device,'pixels':PIXELS,'metres':SIZE,'pixels_per_metre':PIXELS/SIZE,'samples':scene.cycles.samples,'seconds':time.monotonic()-start,'objects':len(scene.objects),'buildings':len(s['buildings']),'trees':len(s['trees']),'context':s.get('context',{}),'material_sources':[a['id']for a in assets],'geometry':'mapped footprints; inferred pitched roofs and roof fittings','vegetation':'procedural botanical mesh placements'},indent=2))
