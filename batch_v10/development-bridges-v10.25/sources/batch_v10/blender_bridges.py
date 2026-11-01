"""Blender-only height anchoring, fixed deck assets and sparse RGBA passes."""
import json,math
import bpy
from mathutils import Vector
from terrain import height_at,profile_at


def drape(s):
    terrain=s['terrain']
    for obj in list(bpy.context.scene.objects):
        anchor=obj.get('terrain_anchor');constant=obj.get('terrain_offset')
        if constant is None and anchor is not None:constant=height_at(terrain,*anchor)
        if obj.name=='water':constant=terrain.get('water_level_local_m',0)
        if constant is not None:
            obj.location.z+=constant
            continue
        if obj.type=='MESH':
            world=obj.matrix_world.copy();inverse=world.inverted()
            for vertex in obj.data.vertices:
                p=world@vertex.co
                offset=(terrain.get('water_level_local_m',0)if obj.name=='water'else constant if constant is not None else height_at(terrain,p.x,-p.y))
                p.z+=offset;vertex.co=inverse@p
            obj.data.update()
        elif obj.type=='CURVE':
            world=obj.matrix_world.copy();inverse=world.inverted()
            for spline in obj.data.splines:
                for point in spline.points:
                    p=world@Vector(point.co[:3]);p.z+=constant if constant is not None else height_at(terrain,p.x,-p.y)
                    p=inverse@p;point.co=(*p,1)
        elif obj.type=='FONT':
            obj.location.z+=constant if constant is not None else height_at(terrain,obj.location.x,-obj.location.y)


def build(s,mesh,lines,concrete,road_materials):
    groups={};surfaces={g['id']:g for g in s['surface_network']['surfaces']}
    for deck in s['bridge_meshes']:
        objects=[];g=deck['mesh'];surface=surfaces[deck['id']];material,scale=road_materials[deck['surface']]
        if deck.get('structure_mesh'):
            sm=deck['structure_mesh'];objects.append(mesh('Mapped structural deck / '+deck['id'],[(x,-y,z)for x,y,z in sm['vertices']],sm['faces'],concrete))
        objects.append(mesh('Bridge deck / '+deck['id'],[(x,-y,z)for x,y,z in g['vertices']],g['faces'],material,scale))
        for part in deck['parts']:
            for ring in part:
                vertices=[];faces=[]
                for x,y in ring:
                    z=profile_at(surface,x,y)[0];vertices.extend([(x,-y,z-.45),(x,-y,z+.018)])
                for i in range(len(ring)-1):faces.append([i*2,i*2+1,i*2+3,i*2+2])
                objects.append(mesh('Bridge fascia / '+deck['id'],vertices,faces,concrete))
        groups[deck['id']]=objects
    rail_meshes={}
    for obstacle in s['surface_network']['obstacles']:
        if obstacle['kind']=='rail':
            a,b=obstacle['a'],obstacle['b'];za,zb=obstacle['za'],obstacle['zb']
            if not any(abs(p[0])<155 and abs(p[1])<155 for p in (a,b)):continue
            vertices,faces=rail_meshes.setdefault(obstacle['surface_id'],([],[]));index=len(vertices)
            dx,dy=b[0]-a[0],b[1]-a[1];length=max(.001,math.hypot(dx,dy));nx,ny=-dy/length*.13,dx/length*.13
            vertices.extend([(a[0],-a[1],za),(b[0],-b[1],zb),(b[0],-b[1],zb+1.1),(a[0],-a[1],za+1.1),
                             (a[0]+nx,-a[1]-ny,za+1.1),(b[0]+nx,-b[1]-ny,zb+1.1),
                             (b[0]-nx,-b[1]+ny,zb+1.1),(a[0]-nx,-a[1]+ny,za+1.1)])
            faces.extend([[index+i for i in (0,1,2,3)],[index+i for i in (4,5,6,7)]])
        else:
            for part in obstacle['parts']:
                ring=part[0];vertices=[];faces=[]
                for x,y in ring:vertices.extend([(x,-y,obstacle['zmin']),(x,-y,obstacle['zmax'])])
                for i in range(len(ring)-1):faces.append([2*i,2*i+1,2*i+3,2*i+2])
                mesh('Inferred bridge abutment',vertices,faces,concrete)
    for sid,(vertices,faces) in rail_meshes.items():
        ob=mesh('Inferred parapets / '+sid,vertices,faces,concrete)
        if surfaces[sid]['kind']=='deck':groups[sid].append(ob)
    for overhead in s.get('bridge_overheads',[]):
        groups[overhead['id']]=[o for o in bpy.context.scene.objects if o.get('building_id')==overhead['building_id']]
    for objects in groups.values():
        for obj in objects:obj.visible_camera=False
    return groups


def patches(s,groups,scene,camera,root):
    records=[];all_objects=list(scene.objects);surfaces={s['id']:s for s in s['surface_network']['surfaces']}
    for sid,objects in groups.items():
        overhead=next((d for d in s.get('bridge_overheads',[])if d['id']==sid),None)
        if overhead:
            points=[p for part in overhead['parts'] for ring in part for p in ring]
            bounds=[min(p[0]for p in points),min(p[1]for p in points),max(p[0]for p in points),max(p[1]for p in points)];bounds=[bounds[0]-.5,bounds[1]-.5,bounds[2]+.5,bounds[3]+.5]
            deck={'image_regions':[{'suffix':'roof','bounds':bounds}]}
        else:deck=next(d for d in s['bridge_meshes']if d['id']==sid)
        visible=set(objects)
        for other,obs in groups.items():
            coplanar_join=other in surfaces and sid in surfaces and other!=sid and bool(set(surfaces[sid]['nodes'])&set(surfaces[other]['nodes']))
            for obj in obs:obj.visible_shadow=not coplanar_join
        for obj in all_objects:
            if obj.type in {'MESH','CURVE','FONT'}:obj.visible_camera=obj in visible
        for region in deck['image_regions']:
            x0,y0,x1,y1=region['bounds']
            camera.location=((x0+x1)/2,-(y0+y1)/2,150)
            camera.data.sensor_fit='HORIZONTAL';camera.data.ortho_scale=x1-x0
            scene.render.resolution_x=round((x1-x0)*32);scene.render.resolution_y=round((y1-y0)*32)
            scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
            pid=sid+'-p-'+region['suffix'];name=pid+'.png';scene.render.filepath=str(root/'baked'/name)
            bpy.ops.render.render(write_still=True)
            records.append({'id':pid,'surface_id':sid,'name':name,'bounds':[x0,y0,x1,y1],
                            'zmax':overhead['zmax'] if overhead else None,'kind':'overhead' if overhead else 'deck','width':scene.render.resolution_x,'height':scene.render.resolution_y})
    (root/'baked/bridge-passes.json').write_text(json.dumps(records,indent=2))
