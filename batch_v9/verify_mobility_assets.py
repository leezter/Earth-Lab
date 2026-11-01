"""Build and render the editable Blender furniture/access reference, not a map."""
from pathlib import Path
import sys,json,math
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
import v9_assets
ROOT=Path(__file__).resolve().parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def basic(name,rgb,roughness=.8,metallic=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metallic
    return mat
def cube(name,point,size,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=point);o=bpy.context.object;o.name=name;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
items=[]
dimensions={'bollard':(.16,.16,1),'bike_rack':(.1,1,.8),'bus_stop':(.15,.5,2.5),
            'shelter':(1.4,3.2,2.4),'bench':(.6,1.8,.85),'bin':(.5,.5,.9)}
for i,(kind,(w,l,h)) in enumerate(dimensions.items()):
    items.append({'kind':kind,'point':[-9+i*3.6,0],'heading':math.pi/2,'width':w,'length':l,'height':h,'ground_z':.14})
report=v9_assets.build({'furniture':items},basic)
cube('Pedestrian surface',(0,0,.06),(24,7,.16),basic('Paving reference',(.40,.39,.36)))
cube('Carriageway reference',(0,-5,-.02),(24,3,.06),basic('Road reference',(.075,.08,.08)))
cube('Refuge outline',(-7,-5,.06),(1.6,3,.16),basic('Refuge stone',(.52,.51,.47)))
tactile=v9_assets.tactile_material(basic);cube('Tactile paving reference',(-2,-1.5,.146),(1.5,.45,.012),tactile)
mesh=bpy.data.meshes.new('Lowered kerb ramp reference')
mesh.from_pydata([(1,-3.5,.02),(3,-3.5,.02),(3,-2,.14),(1,-2,.14)],[],[(0,1,2),(0,2,3)]);mesh.update()
obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(basic('Ramp concrete',(.43,.43,.40)))
symbols=json.loads((ROOT/'mobility-symbols.json').read_text())
paint=basic('Symbol paint',(.8,.79,.73))
for i,(name,g) in enumerate(symbols.items()):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([(x+5+i*3,y-5,.025)for x,y in g['vertices']],[],g['faces']);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(paint)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.world.color=(.25,.25,.25)
bpy.ops.object.light_add(type='SUN',location=(0,0,30));bpy.context.object.rotation_euler=(.35,-.25,-.45);bpy.context.object.data.energy=2.5
bpy.ops.object.camera_add(location=(0,-2,40));camera=bpy.context.object;camera.rotation_euler=(0,0,0);camera.data.type='ORTHO';camera.data.ortho_scale=26;scene.camera=camera
scene.render.resolution_x=1800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'street-access-kit.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'street-access-kit.blend'))
bpy.ops.render.render(write_still=True)
assert set(report['rendered_counts'])==set(dimensions)
(ROOT/'street-access-kit-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
