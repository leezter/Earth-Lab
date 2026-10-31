"""Metric Blender boundary kit: mapped lines, explicitly inferred finishes."""
import math
import random
import hashlib
import bpy
from shapely.geometry import LineString,Point,box
from site_features import lines as line_parts


def build(s,cube,curve,basic):
    cache={};counts={'wall':0,'fence':0,'hedge':0,'gate':0}
    def material(kind,finish=None,rgb=None):
        key=(kind,finish,tuple(rgb)if rgb else None)
        if key in cache:
            return cache[key]
        wood=finish in {'wood','timber'}
        brick=finish in {'brick','bricks'}
        colour=rgb or ((.22,.12,.065)if wood else (.31,.19,.13)if brick else (.24,.27,.28)if kind=='fence'else (.09,.18,.055)if kind=='hedge'else (.36,.35,.31))
        if rgb:
            colour=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)
        mat=basic('Boundary / '+str(key),colour,.9,.45 if kind=='fence'and not wood else 0)
        n=mat.node_tree.nodes;l=mat.node_tree.links;p=n.get('Principled BSDF')
        coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=22 if kind=='hedge'else 8;noise.inputs['Detail'].default_value=3;l.new(coord.outputs['Object'],noise.inputs['Vector'])
        mix=n.new('ShaderNodeMixRGB');l.new(noise.outputs['Fac'],mix.inputs[0]);mix.inputs[1].default_value=tuple(v*.82 for v in colour)+(1,);mix.inputs[2].default_value=tuple(v*1.08 for v in colour)+(1,)
        height=noise.outputs['Fac']
        if kind=='wall'and finish not in {'concrete','cement'}:
            separate=n.new('ShaderNodeSeparateXYZ');combine=n.new('ShaderNodeCombineXYZ');l.new(coord.outputs['Object'],separate.inputs[0]);l.new(separate.outputs['X'],combine.inputs['X']);l.new(separate.outputs['Z'],combine.inputs['Y'])
            pattern=n.new('ShaderNodeTexBrick');pattern.inputs['Scale'].default_value=1;pattern.inputs['Brick Width'].default_value=.23 if brick else .42;pattern.inputs['Row Height'].default_value=.075 if brick else .18;pattern.inputs['Mortar Size'].default_value=.008;pattern.inputs['Mortar Smooth'].default_value=.003;l.new(combine.outputs[0],pattern.inputs['Vector'])
            pattern.inputs['Color1'].default_value=tuple(v*.86 for v in colour)+(1,);pattern.inputs['Color2'].default_value=tuple(v*1.07 for v in colour)+(1,);pattern.inputs['Mortar'].default_value=(.13,.13,.12,1);l.new(pattern.outputs['Color'],p.inputs['Base Color']);height=pattern.outputs['Fac']
        else:
            l.new(mix.outputs[0],p.inputs['Base Color'])
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.25;bump.inputs['Distance'].default_value=.035 if kind=='hedge'else .012;l.new(height,bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal'])
        cache[key]=mat;return mat
    extent=box(-155,-155,155,155)
    for boundary in s.get('boundaries',[]):
        line=LineString(boundary['points']).intersection(extent)
        if line.is_empty:
            continue
        kind=boundary['kind'];width=boundary['width'];height=boundary['height'];mat=material(kind,boundary.get('material'),boundary.get('colour'))
        rng=random.Random(int(hashlib.sha256(boundary['id'].encode()).hexdigest()[:12],16))
        for part in line_parts(line):
            if kind=='hedge':
                count=max(1,math.ceil(part.length/max(.45,width*.8)))
                for i in range(count+1):
                    p=part.interpolate(i/count,normalized=True);bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(p.x,-p.y,height*.53));o=bpy.context.object;o.name='Mapped hedge / '+boundary['id'];o.scale=(width*.64,width*.64,height*.57*rng.uniform(.94,1.06));o.data.materials.append(mat)
            else:
                for a,b in zip(part.coords,list(part.coords)[1:]):
                    dx=b[0]-a[0];dy=-(b[1]-a[1]);length=math.hypot(dx,dy)
                    if length<.01:
                        continue
                    angle=math.atan2(dy,dx);x=(a[0]+b[0])/2;y=-(a[1]+b[1])/2
                    if kind=='wall':
                        o=cube('Mapped boundary wall',(x,y,height/2),(length+.03,width,height),mat,.015);o.rotation_euler.z=angle
                        cap=cube('Wall coping',(x,y,height+.035),(length+.04,width+.035,.07),mat,.012);cap.rotation_euler.z=angle
                    else:
                        # Slim posts, rails and uprights read from above without
                        # claiming an untagged fence's exact construction.
                        posts=max(1,math.ceil(length/2.2))
                        for i in range(posts+1):
                            t=i/posts;post=cube('Fence post',(a[0]+dx*t,-a[1]+dy*t,height/2),(.09,.09,height+.05),mat,.01);post.rotation_euler.z=angle
                        for z in (height*.30,height*.85):
                            rail=cube('Fence rail',(x,y,z),(length,.045,.055),mat);rail.rotation_euler.z=angle
                        timber=boundary.get('material')in {'wood','timber'}
                        uprights=max(1,math.ceil(length/(.15 if timber or boundary.get('fence_type')=='railing'else .32)))
                        for i in range(uprights+1):
                            t=i/uprights;bar=cube('Fence upright',(a[0]+dx*t,-a[1]+dy*t,height*.55),(.10 if timber else .025,.025,height*.75),mat);bar.rotation_euler.z=angle
            counts[kind]+=1
    gate_mat=material('fence','metal')
    for gate in s.get('gates',[]):
        x,y=gate['point']
        if not extent.covers(Point(x,y)):
            continue
        angle=-gate['angle'];w=gate['width'];h=gate['height'];ax,ay=math.cos(angle),math.sin(angle);left=(x-ax*w/2,-y-ay*w/2);right=(x+ax*w/2,-y+ay*w/2)
        for px,py in (left,right):
            cube('Mapped gate post',(px,py,h/2),(.13,.13,h+.1),gate_mat,.015)
        swing=angle+math.radians(65);end=(left[0]+math.cos(swing)*w,left[1]+math.sin(swing)*w)
        for z in (.25,h*.85):
            curve('Gate leaf / inferred open pose',[(left[0],left[1],z),(end[0],end[1],z)],.025,gate_mat)
        count=max(1,math.ceil(w/.35))
        for i in range(count+1):
            t=i/count;px=left[0]+(end[0]-left[0])*t;py=left[1]+(end[1]-left[1])*t
            curve('Gate upright',[(px,py,.25),(px,py,h*.85)],.018,gate_mat)
        counts['gate']+=1
    return {'rendered_parts':counts,'material_variants':len(cache),
            'note':'Positions follow mapped lines/nodes. Missing dimensions, construction and open gate pose are inferred.'}
