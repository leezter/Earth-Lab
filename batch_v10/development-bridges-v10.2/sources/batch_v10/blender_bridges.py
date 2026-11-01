"""Blender-only height anchoring, fixed deck assets and sparse RGBA passes."""
import json,math
import bpy
from mathutils import Vector
from terrain import height_at,profile_at


def drape(s):
    terrain=s['terrain']
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH':
            world=obj.matrix_world.copy();inverse=world.inverted()
            for vertex in obj.data.vertices:
                p=world@vertex.co;p.z+=height_at(terrain,p.x,-p.y);vertex.co=inverse@p
            obj.data.update()
        elif obj.type=='CURVE':
            world=obj.matrix_world.copy();inverse=world.inverted()
            for spline in obj.data.splines:
                for point in spline.points:
                    p=world@Vector(point.co[:3]);p.z+=height_at(terrain,p.x,-p.y)
                    p=inverse@p;point.co=(*p,1)
        elif obj.type=='FONT':
            obj.location.z+=height_at(terrain,obj.location.x,-obj.location.y)


def build(s,mesh,lines,concrete,road_materials):
    groups={};surfaces={g['id']:g for g in s['surface_network']['surfaces']}
    for deck in s['bridge_meshes']:
        objects=[];g=deck['mesh'];surface=surfaces[deck['id']];material,scale=road_materials[deck['surface']]
        objects.append(mesh('Bridge deck / '+deck['id'],[(x,-y,z)for x,y,z in g['vertices']],g['faces'],material,scale))
        for part in deck['parts']:
            for ring in part:
                vertices=[];faces=[]
                for x,y in ring:
                    z=profile_at(surface,x,y)[0];vertices.extend([(x,-y,z-.45),(x,-y,z+.018)])
                for i in range(len(ring)-1):faces.append([i*2,i*2+1,i*2+3,i*2+2])
                objects.append(mesh('Bridge fascia / '+deck['id'],vertices,faces,concrete))
        groups[deck['id']]=objects
    for obstacle in s['surface_network']['obstacles']:
        if obstacle['kind']=='rail':
            a,b=obstacle['a'],obstacle['b'];za,zb=obstacle['za'],obstacle['zb']
            if not any(abs(p[0])<155 and abs(p[1])<155 for p in (a,b)):continue
            ob=mesh('Inferred parapet / '+obstacle['surface_id'],
                    [(a[0],-a[1],za),(b[0],-b[1],zb),(b[0],-b[1],zb+1.1),(a[0],-a[1],za+1.1)],[[0,1,2,3]],concrete)
            rail=lines('Parapet coping / '+obstacle['surface_id'],[(a[0],-a[1],za+1.1),(b[0],-b[1],zb+1.1)],.13,concrete)
            if surfaces[obstacle['surface_id']]['kind']=='deck':groups[obstacle['bridge_id']].extend([ob,rail])
        else:
            for part in obstacle['parts']:
                ring=part[0];vertices=[];faces=[]
                for x,y in ring:vertices.extend([(x,-y,obstacle['zmin']),(x,-y,obstacle['zmax'])])
                for i in range(len(ring)-1):faces.append([2*i,2*i+1,2*i+3,2*i+2])
                mesh('Inferred bridge abutment',vertices,faces,concrete)
    for objects in groups.values():
        for obj in objects:obj.visible_camera=False
    return groups


def patches(s,groups,scene,camera,root):
    records=[];all_objects=list(scene.objects)
    for sid,objects in groups.items():
        deck=next(d for d in s['bridge_meshes']if d['id']==sid)
        coords=[p for part in deck['parts']for ring in part for p in ring]
        if not coords:continue
        x0=max(-96,math.floor((min(p[0]for p in coords)-.7)*32)/32)
        y0=max(-96,math.floor((min(p[1]for p in coords)-.7)*32)/32)
        x1=min(96,math.ceil((max(p[0]for p in coords)+.7)*32)/32)
        y1=min(96,math.ceil((max(p[1]for p in coords)+.7)*32)/32)
        if x1<=x0 or y1<=y0:continue
        visible=set(objects)
        for obj in all_objects:
            if obj.type in {'MESH','CURVE','FONT'}:obj.visible_camera=obj in visible
        camera.location=((x0+x1)/2,-(y0+y1)/2,150)
        camera.data.sensor_fit='HORIZONTAL';camera.data.ortho_scale=x1-x0
        scene.render.resolution_x=round((x1-x0)*32);scene.render.resolution_y=round((y1-y0)*32)
        scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
        name=sid+'.png';scene.render.filepath=str(root/'baked'/name)
        bpy.ops.render.render(write_still=True)
        records.append({'id':sid,'name':name,'bounds':[x0,y0,x1,y1],
                        'width':scene.render.resolution_x,'height':scene.render.resolution_y})
    (root/'baked/bridge-passes.json').write_text(json.dumps(records,indent=2))
