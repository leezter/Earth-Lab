"""Bridge evidence and conservative matching to copied baseline centrelines."""
from shapely.geometry import LineString,box
from shapely.ops import unary_union

DRIVE = {'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link',
         'tertiary','tertiary_link','residential','living_street','unclassified','service'}


def is_bridge(tags):
    return tags.get('bridge') not in {None,'','no','false','0'}


def unsupported(tags):
    if tags.get('tunnel') not in {None,'','no','false','0'}:
        return 'Tunnel driving is not supported'
    if tags.get('bridge') in {'movable','temporary','low_water_crossing'} or tags.get('bridge:movable') not in {None,'','no'}:
        return 'Movable/temporary/low-water bridges are not supported'
    if tags.get('access') in {'no','private'} or tags.get('motor_vehicle')=='no':
        return 'Restricted motor access'
    return None


def strip_elevated(raw,osm,xy):
    """Clip aligned elevated ribbons, never a crossing lower road at the same XY."""
    elevated=[]
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if e.get('type')!='way' or not t.get('highway'):
            continue
        if not (is_bridge(t) or t.get('tunnel') not in {None,'','no'} or str(t.get('layer','0')) not in {'','0'}):
            continue
        pts=[xy((p['lon'],p['lat'])) for p in e.get('geometry',[])]
        if len(pts)>1:
            elevated.append((e,LineString(pts)))
    roads=[]; matches=[]
    for road in raw['roads']:
        pieces=[]; matched=[];in_context=False
        for part in road['parts']:
            for ring in part:
                if len(ring)<2:continue
                line=LineString([xy(p)for p in ring]);cuts=[]
                if not line.intersects(box(-420,-420,420,420)):
                    continue
                in_context=True
                # Compare individual baseline segments, so curves are supported.
                for a,b in zip(line.coords,list(line.coords)[1:]):
                    segment=LineString([a,b]);dx,dy=b[0]-a[0],b[1]-a[1]
                    for e,g in elevated:
                        near=segment.intersection(g.buffer(2.5,cap_style=2))
                        if near.length<min(2,segment.length*.6):continue
                        mid=segment.interpolate(.5,normalized=True);s=g.project(mid)
                        p,q=g.interpolate(max(0,s-1)),g.interpolate(min(g.length,s+1))
                        dot=abs(dx*(q.x-p.x)+dy*(q.y-p.y))/max(1e-9,segment.length*p.distance(q))
                        if dot>.85:
                            cuts.append(g.buffer(2.5,cap_style=2));matched.append(str(e['id']))
                clipped=line.difference(unary_union(cuts)) if cuts else line
                for piece in ([clipped] if clipped.geom_type=='LineString' else getattr(clipped,'geoms',[])):
                    if piece.geom_type=='LineString' and piece.length>.2:
                        # xy is affine; invert via its unit basis.
                        o=xy((0,0));ex=xy((1,0));ey=xy((0,1))
                        coords=[[(x-o[0])/(ex[0]-o[0]),(y-o[1])/(ey[1]-o[1])]for x,y in piece.coords]
                        pieces.append([coords])
        if in_context and str(road.get('level',0)) not in {'','0','0.0','None'} and not matched:
            if road.get('class') in DRIVE:
                raise ValueError('Non-ground baseline road lacks matched OSM evidence: '+road['id'])
            matches.append({'baseline_id':road['id'],'reason':'Unsupported non-ground pedestrian/cycle geometry omitted'})
            continue
        if pieces:roads.append({**road,'parts':pieces})
        if matched:matches.append({'baseline_id':road['id'],'osm_ids':sorted(set(matched)),'policy':'aligned portions removed from ground'})
    return {**raw,'roads':roads},matches
