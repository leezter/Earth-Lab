"""Blender-only authored street furniture and tactile material; batched meshes."""
import math
import bpy
from mathutils import Vector

def tactile_material(basic):
    mat=basic('Tactile warning paving / inferred buff studs',(.62,.53,.31),.85)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    position=nodes.new('ShaderNodeNewGeometry')
    modulo=nodes.new('ShaderNodeVectorMath');modulo.operation='MODULO';modulo.inputs[1].default_value=(.065,.065,.065)
    links.new(position.outputs['Position'],modulo.inputs[0])
    centre=nodes.new('ShaderNodeVectorMath');centre.operation='SUBTRACT';centre.inputs[1].default_value=(.0325,.0325,0)
    links.new(modulo.outputs['Vector'],centre.inputs[0])
    separate=nodes.new('ShaderNodeSeparateXYZ');links.new(centre.outputs['Vector'],separate.inputs[0])
    combine=nodes.new('ShaderNodeCombineXYZ');links.new(separate.outputs['X'],combine.inputs['X']);links.new(separate.outputs['Y'],combine.inputs['Y'])
    distance=nodes.new('ShaderNodeVectorMath');distance.operation='LENGTH';links.new(combine.outputs[0],distance.inputs[0])
    mask=nodes.new('ShaderNodeMath');mask.operation='LESS_THAN';mask.inputs[1].default_value=.018;links.new(distance.outputs['Value'],mask.inputs[0])
    bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.45;bump.inputs['Distance'].default_value=.004
    links.new(mask.outputs[0],bump.inputs['Height']);links.new(bump.outputs[0],nodes.get('Principled BSDF').inputs['Normal'])
    return mat

def build(scene,basic):
    materials={'metal':basic('Furniture dark powder coated metal',(.045,.055,.055),.55,.45),
               'zinc':basic('Furniture galvanised steel',(.32,.34,.34),.42,.65),
               'wood':basic('Bench timber / inferred finish',(.27,.15,.065)),
               'roof':basic('Shelter metal roof',(.09,.12,.13),.5,.45),
               'glass':basic('Shelter glass / inferred',(.13,.23,.25),.25),
               'sign':basic('Generic bus stop flag',(.055,.18,.34)),
               'white':basic('Furniture pale reflector',(.75,.74,.69))}
    glass=materials['glass'].node_tree.nodes.get('Principled BSDF')
    if 'Transmission Weight' in glass.inputs:glass.inputs['Transmission Weight'].default_value=.35
    batches={key:[[],[]] for key in materials};counts={}
    def poly(key,points):
        verts,faces=batches[key];k=len(verts);verts.extend(points);faces.append(list(range(k,k+len(points))))
    def world(item,p):
        x,y=item['point'];a=item['heading'];tx,ty=math.cos(a),math.sin(a);r,f,z=p
        return (x-ty*r+tx*f,-y-tx*r-ty*f,z+item.get('ground_z',.14))
    def cube(key,item,centre,size):
        cx,cy,cz=centre;wx,wy,wz=[v/2 for v in size]
        vertices=[world(item,(cx+x,cy+y,cz+z)) for x,y,z in [(-wx,-wy,-wz),(wx,-wy,-wz),(wx,wy,-wz),(-wx,wy,-wz),(-wx,-wy,wz),(wx,-wy,wz),(wx,wy,wz),(-wx,wy,wz)]]
        for face in ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)):poly(key,[vertices[i] for i in face])
    def tube(key,item,a,b,radius):
        a=Vector(world(item,a));b=Vector(world(item,b));direction=(b-a).normalized()
        u=direction.cross(Vector((0,0,1)))
        if u.length<.01:u=direction.cross(Vector((1,0,0)))
        u.normalize();v=direction.cross(u);n=12
        rings=[[tuple(c+radius*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n))) for i in range(n)] for c in (a,b)]
        poly(key,list(reversed(rings[0])));poly(key,rings[1])
        for i in range(n):j=(i+1)%n;poly(key,[rings[0][i],rings[0][j],rings[1][j],rings[1][i]])
    for item in scene.get('furniture',[]):
        x,y=item['point']
        if abs(x)>155 or abs(y)>155:continue
        kind=item['kind'];w,l,h=item['width'],item['length'],item['height'];counts[kind]=counts.get(kind,0)+1
        if kind=='bollard':
            tube('metal',item,(0,0,0),(0,0,h),w/2);tube('white',item,(0,0,h*.75),(0,0,h*.86),w*.51)
        elif kind=='bike_rack':
            tube('zinc',item,(0,-l/2,0),(0,-l/2,h),.035);tube('zinc',item,(0,l/2,0),(0,l/2,h),.035)
            tube('zinc',item,(0,-l/2,h),(0,l/2,h),.035)
        elif kind=='bus_stop':
            tube('zinc',item,(0,0,0),(0,0,h),.045);cube('sign',item,(0,0,h-.3),(.045,.42,.6));cube('white',item,(-.026,0,h-.3),(.008,.3,.35))
        elif kind=='shelter':
            for a in (-w/2,w/2):
                for b in (-l/2,l/2):cube('metal',item,(a,b,h/2),(.055,.055,h))
            cube('roof',item,(0,0,h),(w+.15,l+.15,.10))
            cube('glass',item,(w/2,0,h*.45),(.025,l,h*.8))
            for b in (-l/2,l/2):cube('glass',item,(0,b,h*.45),(w,.025,h*.8))
            cube('wood',item,(w*.25,0,.45),(.35,l*.72,.065))
        elif kind=='bench':
            for f in (-l*.33,l*.33):cube('metal',item,(0,f,.23),(w*.7,.08,.46))
            for i in range(4):cube('wood',item,(-w*.37+i*w*.25,0,.47),(w*.20,l,.055))
            for z in (.64,.78):cube('wood',item,(w*.43,0,z),(.055,l,.10))
        elif kind=='bin':
            cube('metal',item,(0,0,h/2),(w,l,h));cube('white',item,(0,0,h*.85),(w*1.01,l*1.01,.05))
    for key,(vertices,faces) in batches.items():
        if not faces:continue
        mesh=bpy.data.meshes.new('Mapped street furniture / '+key);mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(materials[key])
    return {'rendered_counts':counts,'dimensions_and_style':'Generic inferred prefabs at mapped or labelled inferred positions.'}
