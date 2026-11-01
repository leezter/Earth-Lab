"""Metric Blender road shaders: surface structure, aggregate and broad wear.
Reference families follow OSM surface photo examples; details are inferred.
No lane paint or road-specific damage is invented by these materials.
"""
import bpy,json
from pathlib import Path
from road_types import FAMILIES
def build():
 out={}
 repo=Path(__file__).resolve().parent.parent
 scans={a['id']:a for a in json.loads((repo/'assets/materials/batch-manifest.json').read_text(encoding='utf-8-sig'))}
 for kind in FAMILIES:
  mat=bpy.data.materials.new('Road / '+kind);mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF');p.inputs['Roughness'].default_value=.88
  coord=n.new('ShaderNodeTexCoord')
  def noise(scale):
   t=n.new('ShaderNodeTexNoise');t.inputs['Scale'].default_value=scale;t.inputs['Detail'].default_value=2;l.new(coord.outputs['UV'],t.inputs['Vector']);return t.outputs['Fac']
  def ramp(value,a,b,lo=.2,hi=.8):
   t=n.new('ShaderNodeValToRGB');t.color_ramp.elements[0].position=lo;t.color_ramp.elements[0].color=(*a,1);t.color_ramp.elements[1].position=hi;t.color_ramp.elements[1].color=(*b,1);l.new(value,t.inputs[0]);return t.outputs['Color']
  palettes={'asphalt':((.018,.022,.025),(.065,.071,.074)),'concrete':((.20,.19,.17),(.37,.36,.33)),'concrete_slabs':((.22,.21,.19),(.40,.39,.36)),'paving_blocks':((.22,.19,.15),(.37,.32,.25)),'sett':((.13,.14,.14),(.30,.30,.27)),'cobble':((.16,.16,.14),(.34,.32,.27)),'compacted':((.16,.13,.09),(.34,.29,.20)),'gravel':((.19,.18,.14),(.40,.37,.29)),'earth':((.12,.075,.037),(.29,.19,.09)),'sand':((.32,.24,.13),(.55,.44,.27)),'grass':((.07,.10,.025),(.18,.22,.07)),'wood':((.13,.085,.045),(.30,.22,.12)),'metal':((.16,.18,.19),(.34,.36,.36))}
  a,b=palettes[kind];fine=noise(100 if kind in ['asphalt','sand']else 35);broad=noise(.18)
  colour=ramp(fine,a,b);height=fine
  if kind in ['concrete_slabs','paving_blocks','sett','wood']:
   brick=n.new('ShaderNodeTexBrick');brick.inputs['Scale'].default_value=1
   w,h={'concrete_slabs':(3.5,4.5),'paving_blocks':(.20,.10),'sett':(.22,.16),'wood':(2.4,.18)}[kind]
   brick.inputs['Brick Width'].default_value=w;brick.inputs['Row Height'].default_value=h;brick.inputs['Mortar Size'].default_value=.008 if kind!='concrete_slabs'else .014
   brick.inputs['Mortar Smooth'].default_value=.004;brick.inputs['Color1'].default_value=(*a,1);brick.inputs['Color2'].default_value=(*b,1);brick.inputs['Mortar'].default_value=(.055,.05,.042,1);l.new(coord.outputs['UV'],brick.inputs['Vector']);colour=brick.outputs['Color'];height=brick.outputs['Fac']
  elif kind in ['cobble','gravel']:
   vor=n.new('ShaderNodeTexVoronoi');vor.feature='DISTANCE_TO_EDGE';vor.inputs['Scale'].default_value=5.5 if kind=='cobble'else 22;l.new(coord.outputs['UV'],vor.inputs['Vector']);height=vor.outputs['Distance'];colour=ramp(height,(.065,.058,.045),b,.015,.075)
  # Photographic fine detail, blended with an independently rotated sample to
  # reduce periodic scan landmarks. Procedural joints remain family-specific.
  scan_id={'asphalt':'asphalt_02','concrete':'concrete_pavement','concrete_slabs':'concrete_pavement','paving_blocks':'cobblestone_floor_03','sett':'cobblestone_floor_03','cobble':'cobblestone_floor_03','compacted':'gravel_floor','gravel':'gravel_floor','earth':'brown_mud_dry','sand':'dry_ground_rocks','grass':'aerial_grass_rock','wood':'brown_mud_dry','metal':'corrugated_iron'}[kind]
  scan=scans[scan_id];file=next(f for f in scan['files']if f['kind']=='Diffuse');size=float(scan['metadata']['dimensions'][0])/1000
  samples=[]
  for rotation,offset in [(0,(0,0,0)),(.83,(8.13,13.71,0))]:
   mapping=n.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(1/size,1/size,1/size);mapping.inputs['Rotation'].default_value=(0,0,rotation);mapping.inputs['Location'].default_value=offset;l.new(coord.outputs['UV'],mapping.inputs['Vector'])
   tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(repo/file['path']),check_existing=True);l.new(mapping.outputs[0],tex.inputs['Vector']);samples.append(tex.outputs['Color'])
  blend=n.new('ShaderNodeMixRGB');l.new(noise(.4),blend.inputs[0]);l.new(samples[0],blend.inputs[1]);l.new(samples[1],blend.inputs[2]);bw=n.new('ShaderNodeRGBToBW');l.new(blend.outputs[0],bw.inputs[0])
  detail=ramp(bw.outputs[0],(.67,.67,.67),(1.4,1.4,1.4),.05,.55)
  photograph=n.new('ShaderNodeMixRGB');photograph.blend_type='MULTIPLY';photograph.inputs[0].default_value=.8;l.new(colour,photograph.inputs[1]);l.new(detail,photograph.inputs[2]);colour=photograph.outputs[0]
  micro=n.new('ShaderNodeBump');micro.inputs['Strength'].default_value=.25;micro.inputs['Distance'].default_value=.004;l.new(bw.outputs[0],micro.inputs['Height'])
  # Nonperiodic stains at metre scale break flatness without repeating a crack tile.
  stain=ramp(broad,(.77,.76,.72),(1.08,1.07,1.04));mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;l.new(colour,mix.inputs[1]);l.new(stain,mix.inputs[2]);l.new(mix.outputs[0],p.inputs['Base Color'])
  bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.28;bump.inputs['Distance'].default_value=.008 if kind in ['asphalt','sand','concrete']else .025;l.new(height,bump.inputs['Height']);l.new(micro.outputs[0],bump.inputs['Normal']);l.new(bump.outputs[0],p.inputs['Normal'])
  if kind=='metal':p.inputs['Metallic'].default_value=.65;p.inputs['Roughness'].default_value=.55
  out[kind]=(mat,1.)
 return out
