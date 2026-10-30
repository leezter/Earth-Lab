"""Blender reference sheet of every road shader at one shared physical scale."""
import bpy,sys,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from road_materials import build
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
materials=build();scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.6
for i,(name,(mat,_))in enumerate(materials.items()):
 y=-i*3.6
 mesh=bpy.data.meshes.new(name);mesh.from_pydata([(0,y,0),(26,y,0),(26,y+2.6,0),(0,y+2.6,0)],[],[(0,1,2,3)]);ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat);uv=mesh.uv_layers.new()
 for loop in mesh.loops:
  v=mesh.vertices[loop.vertex_index].co;uv.data[loop.index].uv=(v.x,v.y)
 bpy.ops.object.text_add(location=(0,y+2.85,.01));bpy.context.object.data.body=name.replace('_',' ')+'  |  26 m strip';bpy.context.object.data.size=.4
bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(math.radians(25),math.radians(-20),0);bpy.context.object.data.energy=2
bpy.ops.object.camera_add(location=(13,-20,80));scene.camera=bpy.context.object;scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=48
scene.render.resolution_x=1800;scene.render.resolution_y=2800;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.filepath=str(ROOT/'road-materials.png');bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'road-materials.blend'));bpy.ops.render.render(write_still=True)
