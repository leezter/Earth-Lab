"""Mapped reserved-lane presence with explicitly inferred paint/layout."""
from collections import Counter
from shapely import set_precision
from shapely.geometry import Polygon,Point,LineString,box
from shapely.ops import unary_union
from road_types import family
from roof_styles import colour
from parking_features import side_spec as parking_spec
from street_features import profile,integer,tangent,strokes
from v9_common import band,orient,line_parts

def cycle_spec(tags,side,left_driving=False):
    generic=tags.get('cycleway')
    preferred='left' if left_driving else 'right'
    if tags.get('oneway')=='-1':preferred='right' if preferred=='left' else 'left'
    if tags.get('oneway') in {'yes','1','true','-1'} and side!=preferred:generic=None
    value=tags.get('cycleway:'+side,tags.get('cycleway:both',generic))
    if value!='lane':return None
    def attr(k):return tags.get(f'cycleway:{side}:{k}',tags.get(f'cycleway:both:{k}',tags.get('cycleway:'+k)))
    from site_features import dimension
    width,source=dimension(attr('width'),1.5,.7,3.5)
    return {'width':width,'width_source':source,'advisory':attr('lane')=='advisory',
            'colour':attr('surface:colour') or attr('colour'),'surface':attr('surface'),
            'direction_override':-1 if attr('oneway')=='-1' else 1 if attr('oneway') in {'yes','1'} else None,'markings':attr('lane_markings')!='no'}

def lane_specs(tags,width,left=False):
    """Return lateral bands; OSM lane lists run left-to-right in travel direction."""
    specs=[];reserves={};cycles={s:cycle_spec(tags,s,left) for s in ('left','right')}
    for side,sign in [('left',-1),('right',1)]:
        park=parking_spec(tags,side);pw=park['width'] if park and park['position']=='lane' else 0
        cycle=cycles[side];cw=cycle['width'] if cycle else 0;reserves[side]=pw+cw
        if cycle:
            inner=width/2-pw-cw;outer=width/2-pw
            lo,hi=(inner,outer) if sign==1 else (-outer,-inner)
            specs.append({'kind':'cycle','lo':lo,'hi':hi,'side':side,'direction':cycle['direction_override'] or ((-1 if tags.get('oneway')=='-1' else 1) if tags.get('oneway') in {'yes','1','true','-1'} else (-1 if side==('right' if left else 'left') else 1)),**cycle})
    lo=-width/2+reserves['left'];hi=width/2-reserves['right']
    if hi-lo<2.5:return [],'insufficient travel width after parking/cycle lanes'
    oneway=tags.get('oneway') in {'yes','1','true','-1'}
    arrays=[]
    if oneway:
        array=tags.get('bus:lanes',tags.get('psv:lanes'))
        n=integer(tags.get('lanes'))
        if array:
            values=array.split('|');n=n or len(values)
            if len(values)!=n:return specs,'bus lane list/count mismatch'
            arrays=[(values,lo,hi,-1 if tags.get('oneway')=='-1' else 1)]
    else:
        nf=integer(tags.get('lanes:forward'));nb=integer(tags.get('lanes:backward'))
        if nf and nb and nf+nb<=8:
            step=(hi-lo)/(nf+nb)
            split=lo+(nf if left else nb)*step
            for suffix,n,a,b,d in [('forward',nf,lo if left else split,split if left else hi,1),
                                  ('backward',nb,split if left else lo,hi if left else split,-1)]:
                array=tags.get('bus:lanes:'+suffix,tags.get('psv:lanes:'+suffix))
                if array:
                    values=array.split('|')
                    if len(values)!=n:return specs,'directional bus lane list/count mismatch'
                    arrays.append((values,a,b,d))
        elif any('bus:lanes' in k or 'psv:lanes' in k for k in tags):return specs,'ambiguous directional bus lane counts'
    for values,a,b,direction in arrays:
        step=(b-a)/len(values)
        if not 2.2<=step<=5:return specs,'implausible bus lane width'
        for i,value in enumerate(values):
            if value!='designated':continue
            start=a+i*step if direction==1 else b-(i+1)*step
            specs.append({'kind':'bus','lo':start,'hi':start+step,'direction':direction,'width':step,
                          'width_source':'inferred from carriageway and lane count','colour':None,'surface':None,'markings':True})
    # Side-specific legacy busways are supported without guessing a directional list.
    if not arrays:
        for side in ('left','right'):
            value=tags.get('busway:'+side)
            if value is None and oneway and side==(('right' if left else 'left') if tags.get('oneway')=='-1' else ('left' if left else 'right')):value=tags.get('busway')
            if value!='lane':continue
            from site_features import dimension
            w,source=dimension(tags.get(f'busway:{side}:width'),3,2.2,5)
            if hi-lo-w<2.2:continue
            a=lo if side=='left' else hi-w
            specs.append({'kind':'bus','lo':a,'hi':a+w,'width':w,'width_source':source,
                          'direction':(-1 if tags.get('oneway')=='-1' else 1) if oneway else (-1 if side==('right' if left else 'left') else 1),
                          'colour':tags.get(f'busway:{side}:surface:colour'),'surface':tags.get(f'busway:{side}:surface'),'markings':True})
    return specs,None

def cycle_symbol():
    wheels=unary_union([Point(0,y).buffer(.28).boundary.buffer(.045) for y in (-.65,.65)])
    frame=LineString([(0,-.65),(-.26,0),(.18,.13),(0,-.65),(.18,.13),(0,.65),(-.26,0)]).buffer(.04)
    return unary_union([wheels,frame,LineString([(.18,.13),(.3,.33),(.43,.33)]).buffer(.04)])

def bus_symbol():
    glyphs=[[(0,0),(0,1),(.6,1),(.75,.75),(.6,.5),(0,.5),(.6,.5),(.75,.25),(.6,0),(0,0)],
            [(0,1),(0,.15),(.15,0),(.6,0),(.75,.15),(.75,1)],
            [(.75,1),(.1,1),(0,.85),(0,.6),(.75,.4),(.75,.15),(.6,0),(0,0)]]
    return unary_union([LineString([((x+i*.85-1.225)*.72,(y-.5)*2.6) for x,y in glyph]).buffer(.06) for i,glyph in enumerate(glyphs)])

def compile_mobility(osm,roads,driving,solid,existing_paint,lat,lon):
    records=[];skipped=Counter();surfaces={};materials={};paints=[];reserved=[];extent=box(-420,-420,420,420)
    neighbours={};points={}
    for road in roads:
        e=road['element'];refs=e.get('nodes',[])
        for i,(ref,p) in enumerate(zip(refs,e['geometry'])):
            points[ref]=Point(road['line'].coords[i]);neighbours.setdefault(ref,set())
            if i:neighbours[ref].add(refs[i-1])
            if i+1<len(refs):neighbours[ref].add(refs[i+1])
    junctions=unary_union([points[n].buffer(8) for n,links in neighbours.items() if len(links)>=3])
    # Use the export's millimetre precision for derived lane overlays. Curved
    # near-coincident source offsets otherwise trigger GEOS overlay assertions.
    quantize=lambda g:set_precision(g.buffer(0),.001)
    lane_domain=quantize(driving.intersection(extent).difference(solid))
    junctions=quantize(junctions)
    paint_mask=quantize(unary_union(list(existing_paint.values())).buffer(.3))
    occupied=Polygon()
    for road in roads:
        e=road['element'];t=e['tags'];line=road['line'];width=road['width']
        specs,reason=lane_specs(t,width,profile(lat,lon)['left'])
        if reason:skipped[reason]+=1
        for spec in specs:
            g=quantize(band(line,spec['lo'],spec['hi'])).intersection(lane_domain).difference(occupied).buffer(0)
            if g.area<1:continue
            rgb=colour(spec.get('colour'));key=spec['kind']+('_'+''.join(f'{round(v*255):02x}' for v in rgb) if rgb else '_neutral')
            materials[key]={'family':family(spec.get('surface')),'colour':rgb,'role':'reserved lane','colour_source':'mapped' if rgb else 'inherited neutral surface'}
            # Neutral lanes retain the inherited surface. Only mapped colour/surface
            # changes add a finish layer; geometry still reserves their road space.
            if rgb or spec.get('surface'):surfaces.setdefault(key,[]).append(g)
            reserved.append(g);occupied=occupied.union(g)
            paint_domain=g.difference(junctions).difference(paint_mask)
            if spec.get('markings',True) and t.get('lane_markings')!='no':
                edge=spec['lo'] if abs(spec['lo'])<abs(spec['hi']) else spec['hi']
                for piece in line_parts(line.offset_curve(edge)):
                    paints.append(strokes(piece,.10,1 if spec.get('advisory') else None,2).intersection(paint_domain))
                symbol=cycle_symbol() if spec['kind']=='cycle' else bus_symbol()
                centre=(spec['lo']+spec['hi'])/2
                for i in range(int(line.length/30)+1):
                    s=10+i*30
                    if s>line.length-4:continue
                    p=line.interpolate(s);tx,ty=tangent(line,s);p=Point(p.x-ty*centre,p.y+tx*centre)
                    glyph=orient(symbol,p,(tx*spec['direction'],ty*spec['direction']))
                    if paint_domain.buffer(.01).covers(glyph):paints.append(glyph.intersection(paint_domain))
            records.append({'id':str(e['id']),**spec,'carriageway_width_source':road['width_source'],
                            'geometry_inferred':True,'paint_presence_and_layout_inferred':True,'source_tags':t,'area_m2':round(g.area,3)})
    return {k:unary_union(v) for k,v in surfaces.items()},unary_union(paints),unary_union(reserved),{
        'records':records,'skipped':dict(skipped),'materials':materials,'geometry_precision_metres':.001,'lane_area_m2':round(unary_union(reserved).area,3),
        'limitations':['Mapped lane permissions/presence do not survey physical symbols, boundaries or colours.',
                       'Conditional lane access is retained in source tags but not simulated.',
                       'Ambiguous directional arrays and unsupported shared/contraflow legacy busways are skipped.']}
