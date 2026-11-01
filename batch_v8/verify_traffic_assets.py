"""Portable Blender smoke render: editable signal/sign and road-paint reference."""
from pathlib import Path
import bpy,sys,math,json
from mathutils import Vector
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
import traffic_assets
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def basic(name,c,rough=.8,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
data={'traffic_hardware':[{'point':[x,0],'heading':-math.pi/2,'kind':kind}for x,kind in [(-4,'stop'),(0,'signal'),(4,'give_way')]]}
report=traffic_assets.build(data,basic);assert all(n==1 for n in report['rendered_hardware'].values())
bpy.ops.mesh.primitive_plane_add(size=22);bpy.context.object.data.materials.append(basic('Ground',(.065,.07,.075)))
for y in (-8,-3,2,7):
 bpy.ops.mesh.primitive_plane_add(size=1,location=(-2,y,.01));ob=bpy.context.object;ob.scale=(.12,3,1);ob.data.materials.append(traffic_assets.paint_material('white',basic))
bpy.ops.object.light_add(type='SUN',location=(0,0,15));bpy.context.object.rotation_euler=(.3,-.2,-.4);bpy.context.object.data.energy=2
bpy.ops.object.camera_add(location=(10,-14,13));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=18
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.resolution_x=960;scene.render.resolution_y=736;scene.render.resolution_percentage=100;scene.world.color=(.4,.4,.4);scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'street-kit.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'street-kit.blend'));bpy.ops.render.render(write_still=True)
(ROOT/'street-kit-verification.json').write_text(json.dumps({'blender':bpy.app.version_string,'referenceOnly':True,**report},indent=2)+'\n');print('STREET_KIT_PASS',report)
