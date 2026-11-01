"""Mapped parking presence, approximate lane geometry and evidence-gated paint."""
import math
from collections import Counter
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union, substring
from pavements import metres, osm_shape
from site_features import ground_level, area_role
from street_features import DRIVE, tangent
from road_types import family
from surface_network import export
from shapely import set_precision


def side_spec(tags, side):
    def get(suffix=''):
        for prefix in (f'parking:{side}', 'parking:both'):
            if prefix+suffix in tags:
                return tags[prefix+suffix]
    position=get()
    orientation=get(':orientation')
    if position is None:
        old=tags.get(f'parking:lane:{side}',tags.get('parking:lane:both'))
        if old in {'parallel','diagonal','perpendicular'}:
            position='lane';orientation=old
        else:
            position=old
    if position not in {'lane','street_side'}:
        return None
    if orientation not in {'parallel','diagonal','perpendicular'}:
        orientation='parallel'; inferred=True
    else:
        inferred=False
    width=metres(get(':width'))
    if width is None:
        width=metres(tags.get(f'parking:lane:{side}:width',tags.get('parking:lane:both:width')))
    return {'position':position,'orientation':orientation,'orientation_inferred':inferred,
            'width':width or (2.1 if orientation=='parallel' else 5), 'width_inferred':width is None,
            'surface':get(':surface'), 'marked':get(':markings')=='yes'}


def compile_parking(osm, xy, driving, solid, pedestrian, driveways, road_paint):
    surfaces={};records=[];skipped=Counter();omitted=[];paint=[];occupied=Polygon()
    ways=[];nodes={};connections={}
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if e.get('type')!='way' or t.get('highway') not in DRIVE or not ground_level(t) or t.get('area')=='yes':continue
        pts=[xy((p['lon'],p['lat'])) for p in e.get('geometry',[])]
        if len(pts)<2:continue
        line=LineString(pts);ways.append((e,line))
        refs=e.get('nodes',[])
        for i,(ref,p) in enumerate(zip(refs,pts)):
            nodes[ref]=Point(p);connections.setdefault(ref,set())
            if i:connections[ref].add(refs[i-1])
            if i+1<len(refs):connections[ref].add(refs[i+1])
    junctions=unary_union([nodes[n].buffer(10) for n,v in connections.items() if len(v)>=3])
    driving=set_precision(driving,.001)
    exclusion=set_precision(unary_union([solid.buffer(.15),pedestrian,driveways.buffer(.5),junctions,
                          unary_union(list(road_paint.values())).buffer(.5)]),.001)
    # Individually mapped spaces have stronger location/shape evidence than
    # offset parking lanes. A space polygon does not establish painted borders.
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if t.get('amenity') not in {'parking_space','parking'}:continue
        # Match site-surface eligibility: a building or enclosed parking kind
        # is not evidence of a ground-level parking surface. Keep its source
        # in the report, without inventing an asphalt footprint or bay paint.
        reason=None
        if area_role(t)!='parking':reason='enclosed or layered parking'
        elif not ground_level(t):reason='non-ground parking'
        if reason:
            skipped[reason]+=1
            omitted.append({'id':str(e['id']),'type':e['type'],'reason':reason,'source_tags':t})
            continue
        if e.get('geometry_complete') is False:continue
        g=set_precision(osm_shape(e,xy),.001).difference(exclusion).buffer(0)
        if g.is_empty:continue
        surfaces.setdefault(family(t.get('surface')),[]).append(g);occupied=occupied.union(g)
        marked=t.get('markings')=='yes'
        if marked and t.get('amenity')=='parking_space':paint.append(g.boundary.buffer(.06).intersection(g))
        # For narrow single-row mapped areas only. Large/multi-row lots need
        # explicit individual spaces; guessing aisles would obstruct access.
        orientation=t.get('orientation',t.get('parking:orientation'))
        if marked and t.get('amenity')=='parking' and orientation in {'parallel','diagonal','perpendicular'}:
            coords=list(g.minimum_rotated_rectangle.exterior.coords)
            edges=[(Point(a).distance(Point(b)),a,b) for a,b in zip(coords,coords[1:])]
            length,a,b=max(edges);depth=min(v[0] for v in edges)
            expected=3.2 if orientation=='parallel' else 6.5
            if depth<=expected and length>6:
                tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
                nx,ny=-ty,tx
                cx,cy=g.centroid.x,g.centroid.y
                spacing=6 if orientation=='parallel' else 2.6 if orientation=='perpendicular' else 3.6
                for i in range(1,int(length/spacing)):
                    along=-length/2+i*spacing
                    shift=depth if orientation=='diagonal' else 0
                    points=[(cx+tx*(along+shift*f)+nx*depth*f,cy+ty*(along+shift*f)+ny*depth*f) for f in (-1,1)]
                    paint.append(LineString(points).buffer(.06,cap_style=2).intersection(g))
            else:skipped['multi-row or ambiguous marked parking polygon']+=1
        records.append({'id':str(e['id']),'parts':export(g),'presence':'mapped parking polygon','geometry_inferred':False,
                        'source_tags':t,'bay_layout_inferred':marked and t.get('amenity')=='parking',
                        'paint_evidence':marked,'area_m2':round(g.area,3)})
    for e,line in ways:
        tags=e['tags'];width=metres(tags.get('width:carriageway')) or metres(tags.get('width'))
        specs={s:side_spec(tags,s) for s in ('left','right')}
        for side,spec in specs.items():
            if not spec:continue
            if width is None:
                skipped['parking lane without explicit carriageway width']+=1;continue
            total=sum(s['width'] for s in specs.values() if s and s['position']=='lane')
            if width-total<2.5:
                skipped['insufficient remaining carriageway']+=1;continue
            sign=-1 if side=='left' else 1
            inner=width/2-spec['width'] if spec['position']=='lane' else width/2
            outer=inner+spec['width']
            g=line.buffer(sign*outer,single_sided=True,join_style=2).difference(line.buffer(sign*inner,single_sided=True,join_style=2))
            # Outside parking requires existing mapped site coverage later;
            # never extend an inferred strip into a pavement or private yard.
            if spec['position']=='street_side':
                skipped['street-side parking needs mapped area']+=1;continue
            g=set_precision(g,.001).intersection(driving).difference(exclusion).difference(set_precision(occupied,.001)).buffer(0)
            if g.area<1:continue
            surfaces.setdefault(family(spec['surface'] or tags.get('surface')),[]).append(g);occupied=occupied.union(g)
            if spec['marked']:
                spacing=6 if spec['orientation']=='parallel' else 2.6 if spec['orientation']=='perpendicular' else 3.6
                # Approximate repeated dividers, only with explicit marking evidence.
                for i in range(1,int(line.length/spacing)):
                    s=i*spacing;p=line.interpolate(s);tx,ty=tangent(line,s);nx,ny=-ty*sign,tx*sign
                    shift=spec['width'] if spec['orientation']=='diagonal' else 0
                    a=(p.x+nx*inner,p.y+ny*inner)
                    b=(p.x+nx*outer+tx*shift,p.y+ny*outer+ty*shift)
                    stroke=LineString([a,b]).buffer(.06,cap_style=2)
                    if g.buffer(.02).covers(LineString([a,b])):paint.append(stroke.intersection(g))
            records.append({'id':str(e['id']),'parts':export(g),'line':list(line.coords),'side':side,**spec,'geometry_inferred':True,'source_tags':tags,
                            'paint_evidence':spec['marked'],'area_m2':round(g.area,3)})
    return {k:unary_union(v) for k,v in surfaces.items()},unary_union(paint),{
        'records':records,'skipped':dict(skipped),'omitted':omitted,'area_m2':round(occupied.area,3),
        'paint_area_m2':round(unary_union(paint).area,3),
        'limitations':['Parking presence does not prove painted bays. Repeated bay dimensions are inferred.',
                       'Conditional restrictions are retained as source tags, not simulated.',
                       'Street-side parking uses existing mapped site polygons, not inferred widening.']}
