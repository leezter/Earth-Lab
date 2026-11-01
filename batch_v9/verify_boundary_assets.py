"""Run inside portable Blender: build and render an editable reference kit."""
import sys,json,math
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import boundary_assets

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def basic(name,color,rough=.8,metal=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return mat
def cube(name,location,scale,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:
        modifier=o.modifiers.new('Soft edges','BEVEL');modifier.width=bevel;modifier.segments=2
    return o
def curve(name,points,radius,mat):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=1;spline=data.splines.new('POLY');spline.points.add(len(points)-1)
    for p,xyz in zip(spline.points,points):p.co=(*xyz,1)
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat);return ob
s={'boundaries':[{'id':'reference '+kind,'kind':kind,'points':[[-8,y],[8,y]],'width':width,'height':1.4,'material':finish}
    for kind,y,width,finish in [('wall',6,.25,'brick'),('fence',2,.1,'metal'),('hedge',-3,.7,None)]],
   'gates':[{'point':[0,-7],'angle':0,'width':3,'height':1.3}]}
report=boundary_assets.build(s,cube,curve,basic)
assert all(v>0 for v in report['rendered_parts'].values()),report
floor=basic('Reference ground',(.25,.26,.24));cube('Ground',(0,0,-.1),(24,24,.1),floor)
bpy.ops.object.light_add(type='SUN',location=(0,0,20));sun=bpy.context.object;sun.rotation_euler=(.5,-.2,-.4);sun.data.energy=2
bpy.ops.object.camera_add(location=(0,0,30));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=23
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.render.resolution_x=scene.render.resolution_y=736;scene.render.resolution_percentage=100;scene.world.color=(.4,.4,.4);scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'boundary-kit.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'boundary-kit.blend'));bpy.ops.render.render(write_still=True)
(ROOT/'boundary-kit-verification.json').write_text(json.dumps({'blender':bpy.app.version_string,'referenceOnly':True,**report},indent=2)+'\n')
print('BOUNDARY_KIT_PASS',report)
