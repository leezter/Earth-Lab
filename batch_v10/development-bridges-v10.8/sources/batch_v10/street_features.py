"""Road paint and control placement. Geometry evidence is separate from style inference."""
import math
from collections import Counter,defaultdict
from shapely.geometry import Point,LineString,Polygon,box
from shapely.ops import unary_union,substring
from shapely import STRtree
from shapely.prepared import prep
from site_features import ground_level,dimension,lines

DRIVE={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','unclassified','service'}

def profile(lat,lon):
    if 24<lat<49.5 and -125<lon<-66:return {'name':'US-style geographic approximation','left':False,'centre':'yellow','dash':3.,'gap':9.}
    if 49<lat<60 and -9<lon<2:return {'name':'British/Irish-style geographic approximation','left':True,'centre':'white','dash':2.,'gap':4.}
    return {'name':'generic continental-style approximation','left':False,'centre':'white','dash':3.,'gap':6.}

def integer(value):
    try:
        n=int(str(value));return n if 1<=n<=8 else None
    except (ValueError,TypeError):return None

def tangent(line,s):
    a=line.interpolate(max(0,s-.5));b=line.interpolate(min(line.length,s+.5));dx=b.x-a.x;dy=b.y-a.y;length=math.hypot(dx,dy)
    return (dx/length,dy/length)if length>.001 else (1.,0.)

def strokes(line,width,dash=None,gap=0):
    if not dash:return line.buffer(width/2,cap_style=2,join_style=2)
    pieces=[];s=0.
    while s<line.length:
        end=min(line.length,s+dash)
        if end-s>.02:pieces.append(substring(line,s,end).buffer(width/2,cap_style=2,join_style=2))
        s+=dash+gap
    return unary_union(pieces)

def crossing_style(tags):
    value=tags.get('crossing:markings')
    if value=='no' or tags.get('crossing')in {'unmarked','no','informal'}:return None
    if value in {'zebra','ladder','zebra:double'}or tags.get('crossing_ref')=='zebra' or tags.get('crossing')=='zebra':return 'zebra'
    if value in {'yes','lines','dashes'}or tags.get('crossing')in {'marked','uncontrolled'}:return 'lines'
    return None

def crossing_paint(line,width,style):
    if style=='zebra':return strokes(line,width,.5,.5)
    return unary_union([strokes(line.offset_curve(sign*width/2),.15)for sign in (-1,1)])

def arrow(point,t,turn):
    # Coordinates are lateral-right/forward metres, transformed to map space.
    x,y=point;tx,ty=t;rx,ry=-ty,tx
    def world(p):return (x+rx*p[0]+tx*p[1],y+ry*p[0]+ty*p[1])
    shapes=[]
    for item in turn.split(';'):
        if item=='through':
            shapes.extend([LineString([world((0,-1.2)),world((0,.7))]).buffer(.09,cap_style=2),Polygon([world((-.45,.6)),world((.45,.6)),world((0,1.35))])])
        elif item in {'left','right'}:
            sign=-1 if item=='left'else 1
            shapes.extend([LineString([world((0,-1.2)),world((0,.3)),world((sign*.75,.3))]).buffer(.09,cap_style=2,join_style=2),Polygon([world((sign*.65,-.12)),world((sign*.65,.72)),world((sign*1.25,.3))])])
    return unary_union(shapes)

def compile_streets(osm,raw,xy,driving,solid,lat,lon,reserved=None):
    regional=profile(lat,lon);extent=box(-420,-420,420,420);skipped=Counter();records=[];paint=[];hardware=[];cross_masks=[]
    elements=osm.get('elements',[]);base=[]
    for road in raw['roads']:
        if road['class']not in DRIVE:continue
        for part in road['parts']:
            for ring in part:
                if len(ring)>1:base.append((LineString([xy(p)for p in ring]),road['width']))
    index=STRtree([g for g,_ in base]);ways=[];node_ways=defaultdict(list);neighbours=defaultdict(set);node_points={}
    for e in elements:
        tags=e.get('tags',{})
        if e.get('type')!='way' or tags.get('highway')not in DRIVE or tags.get('area')=='yes'or not ground_level(tags):continue
        pts=[xy((p['lon'],p['lat']))for p in e.get('geometry',[])];refs=e.get('nodes',[])
        if len(pts)<2:continue
        line=LineString(pts)
        if not line.intersects(extent):continue
        clipped=line.intersection(extent);corridor=clipped.buffer(12);near=[base[int(i)]for i in index.query(corridor)]
        match=max(near,key=lambda pair:pair[0].intersection(corridor).length,default=None)
        width,ws=dimension(tags.get('width'),match[1]if match else 7,2,40)
        road={'id':str(e['id']),'tags':tags,'line':line,'points':pts,'refs':refs,'width':width,'width_source':ws,'oneway':tags.get('oneway')in {'yes','1','true','-1'}}
        ways.append(road)
        for i,ref in enumerate(refs):
            node_ways[ref].append((road,i));node_points[ref]=Point(pts[i])
            if i:neighbours[ref].add(refs[i-1])
            if i+1<len(refs):neighbours[ref].add(refs[i+1])
    junctions={ref:node_points[ref]for ref,n in neighbours.items()if len(n)>=3}
    junction_mask=unary_union([p.buffer(max((r['width']/2+1 for r,_ in node_ways[ref]),default=5))for ref,p in junctions.items()])
    domain=driving.buffer(-.10).difference(solid)
    solid_mask=prep(solid.buffer(.15));road_mask=prep(driving.buffer(.1))
    reserved_mask=reserved.buffer(.10)if reserved is not None else None
    def add(g,kind,source,evidence,colour='white',**info):
        if reserved is not None and kind in {'centre_divider','lane_divider','turn_arrow'}:g=g.difference(reserved_mask)
        if g.is_empty:return
        paint.append((kind,g,colour))
        records.append({'kind':kind,'source':source,'presence_evidence':evidence,'style_inferred':True,**info})
    mapped_linear=[]
    for e in elements:
        tags=e.get('tags',{});kind=tags.get('road_marking')
        if not kind or e.get('type')!='way'or not ground_level(tags):continue
        if kind not in {'solid_line','dashed_line','lane_divider','stop_line'}:
            skipped['unsupported separately mapped marking']+=1;continue
        pts=[xy((p['lon'],p['lat']))for p in e.get('geometry',[])]
        if len(pts)<2:continue
        line=LineString(pts).intersection(extent);width,_=dimension(tags.get('width'),.35 if kind=='stop_line'else .12,.04,1)
        colour='yellow'if tags.get('colour')in {'yellow','#ffff00'}else'white'
        g=unary_union([strokes(part,width,regional['dash']if kind in {'dashed_line','lane_divider'}else None,regional['gap'])for part in lines(line)])
        add(g,'mapped_'+kind,f"OSM way/{e['id']}",'separately mapped marking geometry',colour,position_inferred=False)
        mapped_linear.append(line.buffer(.8))
    # Separately mapped marked crossings take priority over node approximations.
    crossing_ways=[]
    for e in elements:
        tags=e.get('tags',{})
        if e.get('type')!='way'or tags.get('footway')!='crossing'or not ground_level(tags):continue
        pts=[xy((p['lon'],p['lat']))for p in e.get('geometry',[])]
        if len(pts)<2:continue
        style=crossing_style(tags)
        if not style:continue
        line=LineString(pts);width,_=dimension(tags.get('width'),3,1,8);g=crossing_paint(line,width,style)
        add(g,'crossing',f"OSM way/{e['id']}",'mapped crossing markings',pattern=style,position_inferred=False)
        crossing_ways.append(line.buffer(width/2+1));cross_masks.append(line.buffer(width/2+1))
    crossing_domain=unary_union(crossing_ways)
    for e in elements:
        tags=e.get('tags',{});cls=tags.get('highway');ref=str(e.get('id'))
        if e.get('type')!='node'or cls not in {'crossing','traffic_signals','stop','give_way'}or not ground_level(tags):continue
        p=e['geometry'][0];point=Point(xy((p['lon'],p['lat'])))
        if not extent.covers(point):continue
        connected=node_ways.get(ref,[])
        if not connected:skipped['control without connected driving way']+=1;continue
        source=f"OSM node/{ref}"
        if cls=='crossing':
            style=crossing_style(tags)
            if style and not crossing_domain.covers(point):
                road,i=max(connected,key=lambda pair:pair[0]['width']);line=road['line'];s=line.project(point);tx,ty=tangent(line,s);rx,ry=-ty,tx;w=road['width']/2-.15
                cross=LineString([(point.x-rx*w,point.y-ry*w),(point.x+rx*w,point.y+ry*w)])
                g=crossing_paint(cross,3,style);add(g,'crossing',source,'mapped crossing markings',pattern=style,position_inferred=True);cross_masks.append(cross.buffer(2.5))
            elif not style:skipped['unmarked or unspecified crossing paint']+=1
        is_signal=cls=='traffic_signals'or(cls=='crossing'and(tags.get('crossing')=='traffic_signals'or tags.get('crossing:signals')=='yes'))
        if cls=='crossing'and not is_signal:continue
        # A junction-centre abstraction expands to eligible incoming approaches.
        centre=ref in junctions;used=[]
        for road,i in connected:
            line=road['line'];s=line.project(point);tag=road['tags'];direction=tags.get('traffic_signals:direction',tags.get('direction'))
            candidates=[1,-1]
            if direction in {'forward','backward'}:candidates=[1 if direction=='forward'else -1]
            elif road['oneway']:candidates=[-1 if tag.get('oneway')=='-1'else 1]
            elif not centre and not is_signal:
                near=[(point.distance(p),r)for r,p in junctions.items()if point.distance(p)<40]
                if near:
                    _,r=min(near);candidates=[1 if line.project(junctions[r])>s else -1]
                else:skipped['ambiguous stop/give-way direction']+=1;continue
            for sign in candidates:
                if (sign==1 and i==0)or(sign==-1 and i==len(road['points'])-1):continue
                distance=s-sign*(road['width']/2+2 if centre else 0)
                if not 0<=distance<=line.length:continue
                tx,ty=tangent(line,distance);tx*=sign;ty*=sign;key=(round(tx,1),round(ty,1))
                if any(tx*a+ty*b>.95 for a,b in used):continue
                used.append((tx,ty));stop=line.interpolate(distance);rx,ry=-ty,tx;side=-1 if regional['left']else 1;w=road['width']
                # Paint across the controlled approach, not the opposing lane.
                lo,hi=(-w/2+.15,w/2-.15)if road['oneway']else((.15,w/2-.15)if side==1 else(-w/2+.15,-.15))
                bar=LineString([(stop.x+rx*lo,stop.y+ry*lo),(stop.x+rx*hi,stop.y+ry*hi)])
                kind='signal_stop_line'if is_signal else 'stop_line'if cls=='stop'else'give_way_line'
                add(strokes(bar,.35 if cls!='give_way'else .22,None if cls!='give_way'else .45,.35),kind,source,'mapped junction control; painted line inferred',direction_inferred=direction not in {'forward','backward'},position_inferred=centre)
                cross_masks.append(bar.buffer(1))
                pole=None
                for edge in (side,-side):
                    for extra in (.55,1.05,1.55,2.05,3.05):
                        candidate=Point(stop.x+rx*(w/2+extra)*edge,stop.y+ry*(w/2+extra)*edge)
                        if not solid_mask.covers(candidate)and not road_mask.covers(candidate):pole=candidate;break
                    if pole:break
                if pole is None:skipped['no unobstructed roadside hardware placement']+=1;continue
                nearby=[(pole.distance(p),r)for r,p in junctions.items()if pole.distance(p)<45]
                group=min(nearby)[1]if nearby else ref
                hardware.append({'id':source+':'+road['id']+':'+str(sign),'kind':'signal'if is_signal else cls,
                    'point':[round(pole.x,3),round(pole.y,3)],'heading':math.atan2(ty,tx),
                    'source':source,'group':str(group),'axis':0 if abs(tx)>=abs(ty)else 1,
                    'placement_inferred':True,'direction_inferred':direction not in {'forward','backward'}})
    exclusions=unary_union([junction_mask,*cross_masks,*mapped_linear])
    for road in ways:
        tags=road['tags'];n=integer(tags.get('lanes'));marked=tags.get('lane_markings')
        if marked=='no':skipped['explicitly unmarked lane dividers']+=1;continue
        if tags.get('junction')=='roundabout':skipped['roundabout lane layout not reconstructed']+=1;continue
        if not n or n<2:skipped['no usable multi-lane count']+=1;continue
        if road['width']/n<2.1:skipped['lane count incompatible with width']+=1;continue
        if tags.get('surface')in {'sett','cobblestone','unpaved','gravel','ground','dirt','sand','grass'}and marked!='yes':continue
        if tags.get('highway')in {'living_street','service'}and marked!='yes':continue
        fwd=integer(tags.get('lanes:forward'));back=integer(tags.get('lanes:backward'))
        if not road['oneway']and n%2 and (not fwd or not back or fwd+back!=n):skipped['ambiguous odd directional lane split']+=1;continue
        fwd=fwd or n//2;lane=road['width']/n
        for j in range(1,n):
            offset=-road['width']/2+j*lane
            divider=road['line'].offset_curve(offset)
            directional=(j==(fwd if regional['left']else n-fwd))and not road['oneway']
            colour=regional['centre']if directional else'white'
            g=unary_union([strokes(piece,.12,regional['dash'],regional['gap'])for piece in lines(divider.intersection(extent))]).difference(exclusions)
            add(g,'centre_divider'if directional else'lane_divider','OSM way/'+road['id'],'lane_markings=yes'if marked=='yes'else'mapped lane count; paint presence inferred',colour,lanes=n,width_inferred=road['width_source']!='mapped')
        # Turn arrows require explicit per-lane turn tags and a known one-way
        # arrangement; more complex bidirectional turn layouts remain omitted.
        turn=tags.get('turn:lanes')or tags.get('turn:lanes:forward')
        if road['oneway']and turn and len(turn.split('|'))==n and road['line'].length>20 and lane>=2.6:
            sign=-1 if tags.get('oneway')=='-1'else 1;at=road['line'].length-12 if sign==1 else 12;p=road['line'].interpolate(at);tx,ty=tangent(road['line'],at);tx*=sign;ty*=sign
            for j,value in enumerate(turn.split('|')):
                offset=-road['width']/2+(j+.5)*lane;g=arrow((p.x-ty*offset,p.y+tx*offset),(tx,ty),value).difference(junction_mask)
                add(g,'turn_arrow','OSM way/'+road['id'],'mapped turn:lanes; placement inferred',turn=value)
    surfaces={};occupied=Polygon()
    for colour in ('white','yellow'):
        group=unary_union([g for _,g,c in paint if c==colour]).intersection(domain).intersection(extent).difference(occupied).buffer(0)
        surfaces[colour]=group;occupied=unary_union([occupied,group])
    report={'profile':regional,'paint_area_m2':round(occupied.area,3),'feature_counts':dict(Counter(r['kind']for r in records)),
        'hardware_counts':dict(Counter(h['kind']for h in hardware)),'records':records,'skipped':dict(skipped),
        'limitations':['Lane widths, dash/line patterns and colours use labelled regional approximations; not surveyed paint.',
            'Signal/control nodes do not establish physical pole positions; roadside placement is inferred.',
            'Unmarked roads, unknown lane counts and ambiguous odd lane splits receive no inferred dividers.',
            'Crossing paint requires a marking tag; unspecified crossings are not automatically zebra crossings.',
            'Illustrative signal phases are not real schedules. No traffic AI, enforcement or live lighting is added.']}
    controls=unary_union([g for kind,g,_ in paint if kind in {'crossing','signal_stop_line','stop_line','give_way_line'}]).intersection(domain)
    report['control_paint_parts']=[[list(p.exterior.coords),*[list(r.coords)for r in p.interiors]]for p in __import__('site_features').polygons(controls)]
    return surfaces,hardware,report
