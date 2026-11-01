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
    from shapely.geometry import Polygon,box
    from shapely.ops import unary_union
    records=[];all_objects=list(scene.objects)
    for sid,objects in groups.items():
        deck=next(d for d in s['bridge_meshes']if d['id']==sid)
        shape=unary_union([Polygon(p[0],p[1:]).buffer(0)for p in deck['parts']]).intersection(box(-96,-96,96,96))
        if shape.is_empty:continue
        visible=set(objects)
        for obj in all_objects:
            if obj.type in {'MESH','CURVE','FONT'}:obj.visible_camera=obj in visible
        # Bound decoded memory by tight local patches rather than one diagonal
        # deck's mostly-transparent scene-sized bounding box.
        for ix in range(6):
            for iy in range(6):
                cell=box(-96+ix*32,-96+iy*32,-64+ix*32,-64+iy*32)
                part=shape.intersection(cell)
                if part.area<.001:continue
                xa,ya,xb,yb=part.bounds
                x0=max(cell.bounds[0],math.floor((xa-.7)*32)/32);y0=max(cell.bounds[1],math.floor((ya-.7)*32)/32)
                x1=min(cell.bounds[2],math.ceil((xb+.7)*32)/32);y1=min(cell.bounds[3],math.ceil((yb+.7)*32)/32)
                camera.location=((x0+x1)/2,-(y0+y1)/2,150)
                camera.data.sensor_fit='HORIZONTAL';camera.data.ortho_scale=x1-x0
                scene.render.resolution_x=round((x1-x0)*32);scene.render.resolution_y=round((y1-y0)*32)
                scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
                pid=sid+'-p-'+str(ix)+'-'+str(iy);name=pid+'.png';scene.render.filepath=str(root/'baked'/name)
                bpy.ops.render.render(write_still=True)
                records.append({'id':pid,'surface_id':sid,'name':name,'bounds':[x0,y0,x1,y1],
                                'width':scene.render.resolution_x,'height':scene.render.resolution_y})
    (root/'baked/bridge-passes.json').write_text(json.dumps(records,indent=2))
