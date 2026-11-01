"""Blender-only standard-library traffic hardware kit; geometry is batched."""
import math
import bpy

def build(scene_data,basic):
    materials={
        'post':basic('Signal/sign galvanised posts',(.24,.26,.27),.5,.6),
        'housing':basic('Traffic signal housing',(.025,.028,.025)),
        'red':basic('Sign red',(.52,.018,.012)),
        'white':basic('Sign white',(.78,.78,.72)),
        'lens':basic('Unlit signal lenses',(.035,.045,.035),.3),
    }
    batches={key:[[],[]]for key in materials};counts={'signal':0,'stop':0,'give_way':0}
    def polygon(key,points):
        v,f=batches[key];i=len(v);v.extend(points);f.append(list(range(i,i+len(points))))
    def cuboid(key,centre,scale,angle=0):
        cx,cy,cz=centre;sx,sy,sz=[s/2 for s in scale];cs,sn=math.cos(angle),math.sin(angle)
        points=[(cx+x*cs-y*sn,cy+x*sn+y*cs,cz+z)for x,y,z in [(-sx,-sy,-sz),(sx,-sy,-sz),(sx,sy,-sz),(-sx,sy,-sz),(-sx,-sy,sz),(sx,-sy,sz),(sx,sy,sz),(-sx,sy,sz)]]
        for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:polygon(key,[points[i]for i in face])
    for item in scene_data.get('traffic_hardware',[]):
        x,y=item['point'];y=-y
        if abs(x)>155 or abs(y)>155:continue
        kind=item['kind'];heading=-item['heading'];tx,ty=math.cos(heading),math.sin(heading);rx,ry=-ty,tx
        height=3.2 if kind=='signal'else 2.1
        cuboid('post',(x,y,height/2),(.10,.10,height))
        if kind=='signal':
            cuboid('housing',(x+tx*.13,y+ty*.13,3.05),(.28,.32,.95),heading)
            # Three vertical lenses face approaching vehicles. They remain
            # unlit in the bake; the viewer has optional plan-view indicators.
            for z in (3.36,3.05,2.74):
                centre=(x-tx*.025,y-ty*.025,z)
                polygon('lens',[(centre[0]+rx*.105*math.cos(a),centre[1]+ry*.105*math.cos(a),z+.105*math.sin(a))for a in [i*math.tau/16 for i in range(16)]])
        else:
            n=8 if kind=='stop'else 3;radius=.38 if kind=='stop'else .45
            # Local sign up is world Z; the board normal faces the approach.
            offset=math.pi/8 if n==8 else -math.pi/2
            for key,rad,forward in [('red',radius,0),('white',radius*.78 if n==3 else radius*.90,-.006)]:
                if n==8 and key=='white':continue
                polygon(key,[(x+rx*rad*math.cos(offset+i*math.tau/n)+tx*forward,y+ry*rad*math.cos(offset+i*math.tau/n)+ty*forward,height+rad*math.sin(offset+i*math.tau/n))for i in range(n)])
            if kind=='stop':
                from mathutils import Matrix,Vector
                text=bpy.data.curves.new('STOP text','FONT');text.body='STOP';text.align_x='CENTER';text.align_y='CENTER';text.size=.21;text.extrude=.001
                ob=bpy.data.objects.new('STOP sign lettering',text);bpy.context.collection.objects.link(ob);ob.location=(x-tx*.008,y-ty*.008,height)
                # right/up/front constitute a right-handed text frame.
                right=Vector((ty,-tx,0));up=Vector((0,0,1));front=right.cross(up)
                ob.rotation_euler=Matrix((right,up,front)).transposed().to_euler();text.materials.append(materials['white'])
        counts[kind]+=1
    for key,(verts,faces)in batches.items():
        if not faces:continue
        mesh=bpy.data.meshes.new('Traffic hardware / '+key);mesh.from_pydata(verts,[],faces);mesh.update();ob=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(ob);mesh.materials.append(materials[key])
    return {'rendered_hardware':counts,'placement':'Inferred roadside placement from mapped controls; not surveyed pole locations.'}

def paint_material(name,basic):
    mat=basic('Road paint / '+name,(.76,.75,.68)if name=='white'else(.73,.49,.025),.8)
    n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=75;noise.inputs['Detail'].default_value=2
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.001;l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
    return mat
