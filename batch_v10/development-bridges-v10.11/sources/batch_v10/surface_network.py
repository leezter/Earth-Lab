"""Source-node connectivity and bounded, explicitly inferred fixed-bridge profiles."""
import math
from collections import Counter,defaultdict

from shapely.geometry import LineString,Point,Polygon
from shapely.ops import substring,unary_union

from bridge_sources import DRIVE,is_bridge,unsupported
from pavements import metres
from road_types import family
from terrain import height_at,profile_at,raster_height

POLICY={'id':'fixed-bridge-profiles-v2','max_grade':.18,'inferred_approach_grade':.12,'inference_margin_m':.25,
        'deck_thickness_m':.45,'required_clearance_m':4.6,'height_step_m':.12,
        'max_context_approach_m':300,'sample_m':2,'rail_height_m':1.1}


class UnsupportedLayout(ValueError):
    """A deterministic topology limit, not a transient source failure."""


def export(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':
        return [[[list(p)for p in ring.coords]for ring in [g.exterior,*g.interiors]]]
    return [part for child in getattr(g,'geoms',[])for part in export(child)]


def sampled(line,fn,step=2):
    count=max(1,math.ceil(line.length/step))
    return [[line.length*i/count,float(fn(line.interpolate(i/count,normalized=True),i/count))]for i in range(count+1)]


def make_surface(sid,kind,line,width,tags,nodes,profile):
    return {'id':sid,'kind':kind,'points':[list(p)for p in line.coords],
            'parts':export(line.buffer(width/2,cap_style=2,join_style=1)),
            'width':width,'nodes':list(nodes),'profile':profile,'connections':[],
            'surface':family(tags.get('surface')),'name':tags.get('name',tags.get('highway','Road')),
            'source_tags':tags,'height_source':'DEM relative profile'if kind=='ground'else'constrained inferred design',
            'structure_inferred':kind!='ground'}


def compile_network(osm,xy,terrain,water_parts=()):
    roads=[];omitted=[]
    local=Polygon([[-96,-96],[96,-96],[96,96],[-96,96]])
    water=unary_union([Polygon(p[0],p[1:])for p in water_parts])
    # A short layer-tagged continuation sharing a bridge endpoint can be an
    # approach, without implying a second deck. Keep that classification inferred.
    continuations=set();anchors=[]
    for e in osm.get('elements',[]):
        if e.get('type')=='way' and is_bridge(e.get('tags',{})) and e.get('nodes'):
            t=e['tags'];anchors.append((set(map(str,(e['nodes'][0],e['nodes'][-1]))),t.get('name'),t.get('highway'),t.get('layer','1')))
    changed=True
    while changed:
        changed=False
        for e in osm.get('elements',[]):
            t=e.get('tags',{});ns=e.get('nodes',[])
            if e.get('type')!='way' or not ns or is_bridge(t) or e['id']in continuations or unsupported(t):continue
            if str(t.get('layer','0'))in {'','0'}:continue
            endpoints=set(map(str,(ns[0],ns[-1])))
            if any(endpoints&nodes and t.get('name')==name and t.get('highway')==cls and t.get('layer')==layer for nodes,name,cls,layer in anchors):
                continuations.add(e['id']);anchors.append((endpoints,t.get('name'),t.get('highway'),t.get('layer')));changed=True
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if e.get('type')!='way' or t.get('highway') not in DRIVE or t.get('area')=='yes':continue
        points=[xy((p['lon'],p['lat']))for p in e.get('geometry',[])]
        if len(points)<2:continue
        line=LineString(points)
        reason=unsupported(t)
        if not is_bridge(t) and e['id']not in continuations and str(t.get('layer','0')) not in {'','0'}:
            reason=reason or 'Non-ground road without supported bridge evidence'
        if reason:
            omitted.append({'id':str(e['id']),'reason':reason,'source_tags':t})
            if line.intersects(local) and reason!='Restricted motor access'and not reason.startswith('Building passage omitted'):
                raise ValueError(reason+' (OSM way '+str(e['id'])+')')
            continue
        roads.append({'id':str(e['id']),'tags':t,'points':points,'nodes':[str(n)for n in e['nodes']],
                      'line':line,'width':max(3,min(30,metres(t.get('width:carriageway'))or metres(t.get('width'))or
                          {'motorway':12,'primary':10,'secondary':9,'tertiary':8,'service':4}.get(t['highway'],7)))})
    counts=Counter(n for r in roads for n in r['nodes'])
    ground=[];bridge_ways=[r for r in roads if is_bridge(r['tags'])]
    from layered_network import required,compile_layered
    if required(roads):
        return compile_layered(roads,terrain,local,water,omitted)
    # Join contiguous bridge source ways to avoid false abutments inside a span.
    bridges=[];remaining=list(bridge_ways)
    while remaining:
        group=remaining.pop(0);group={**group,'source_ids':[group['id']]}
        changed=True
        while changed:
            changed=False
            for other in remaining:
                if other['tags'].get('layer','1')!=group['tags'].get('layer','1'):continue
                a,b=group['nodes'][0],group['nodes'][-1]
                if b==other['nodes'][0]:pts,ns=other['points'],other['nodes'];side='end'
                elif b==other['nodes'][-1]:pts,ns=other['points'][::-1],other['nodes'][::-1];side='end'
                elif a==other['nodes'][-1]:pts,ns=other['points'],other['nodes'];side='start'
                elif a==other['nodes'][0]:pts,ns=other['points'][::-1],other['nodes'][::-1];side='start'
                else:continue
                if abs(other['width']-group['width'])>1:
                    raise ValueError('Bridge width changes at a source join; unsupported design')
                if side=='end':group['points']+=pts[1:];group['nodes']+=ns[1:]
                else:group['points']=pts[:-1]+group['points'];group['nodes']=ns[:-1]+group['nodes']
                group['source_ids'].append(other['id']);remaining.remove(other);changed=True;break
        group['line']=LineString(group['points']);bridges.append(group)
    for r in roads:
        if is_bridge(r['tags']):continue
        cuts=[0]+[i for i in range(1,len(r['nodes'])-1)if counts[r['nodes'][i]]>1]+[len(r['nodes'])-1]
        for index,(a,b)in enumerate(zip(cuts,cuts[1:])):
            line=LineString(r['points'][a:b+1])
            if line.length<.05:continue
            surface=make_surface('osm-'+r['id']+'-'+str(index),'ground',line,r['width'],r['tags'],[r['nodes'][a],r['nodes'][b]],[])
            surface['ordering_inferred']=int(r['id'])in continuations
            ground.append(surface)
    fit_ground_profiles(ground,terrain)
    decks=[];approaches=[];records=[]
    for bridge in bridges:
        line=bridge['line'];width=bridge['width'];sid='bridge-'+min(bridge['source_ids'],key=int)
        if not line.buffer(width/2).intersects(local.buffer(80)):
            continue
        if terrain['source']['status']!='available':
            raise ValueError('Bridge generation requires identified terrain data: '+sid)
        if line.length<3:raise ValueError('Bridge span too short: '+sid)
        bank_heights=[height_at(terrain,*p)for p in [bridge['points'][0],bridge['points'][-1]]]
        z=max(bank_heights)
        crossings=[]
        for lower in ground:
            g=LineString(lower['points']);intersection=line.intersection(g)
            if intersection.is_empty:continue
            if intersection.geom_type not in {'Point','MultiPoint'}:
                raise UnsupportedLayout('Ground and bridge centreline segments overlap ('+sid+'). Choose another area; these mapped sources cannot be separated safely.')
            for intersection in ([intersection]if intersection.geom_type=='Point'else intersection.geoms):
                station=line.project(intersection)
                if min(station,line.length-station)<2:continue
                # Same shared node in the middle of a deck contradicts grade separation.
                if set(bridge['nodes'][1:-1])&set(lower['nodes']):
                    raise ValueError('Bridge and lower road share an interior source node: '+sid)
                overlap=line.buffer(width/2,cap_style=2).intersection(g.buffer(lower['width']/2,cap_style=2))
                samples=[list(p)for part in export(overlap)for ring in part for p in ring]+[[intersection.x,intersection.y]]
                lower_z=max(height_at(terrain,*p)for p in samples)
                z=max(z,lower_z+POLICY['required_clearance_m']+POLICY['deck_thickness_m']+POLICY['inference_margin_m'])
                crossings.append({'surface_id':lower['id'],'point':[intersection.x,intersection.y],'lower_z':lower_z,'clearance_samples':samples})
        if line.intersects(water):
            bank=max(height_at(terrain,*bridge['points'][0]),height_at(terrain,*bridge['points'][-1]))
            z=max(z,bank)
        def bank_profile(t):return bank_heights[0]+(bank_heights[1]-bank_heights[0])*(t*t*(3-2*t))
        lift=0
        for crossing in crossings:
            for point in crossing['clearance_samples']:
                t=line.project(Point(point))/line.length
                needed=height_at(terrain,*point)+POLICY['required_clearance_m']+POLICY['deck_thickness_m']+POLICY['inference_margin_m']
                lift=max(lift,(needed-bank_profile(t))/max(.001,math.sin(math.pi*t)**2))
        candidate=sampled(line,lambda p,t:bank_profile(t)+lift*math.sin(math.pi*t)**2)
        candidate_grade=max(abs((b[1]-a[1])/(b[0]-a[0]))for a,b in zip(candidate,candidate[1:]))
        deck_profile=candidate if candidate_grade<=.16 else [[0,z],[line.length,z]]
        deck=make_surface(sid,'deck',line,width,bridge['tags'],[bridge['nodes'][0],bridge['nodes'][-1]],deck_profile)
        deck['source_ids']=bridge['source_ids'];deck['thickness']=POLICY['deck_thickness_m'];decks.append(deck)
        record={'id':sid,'source_ids':bridge['source_ids'],'deck_height_local_m':z,'height_inferred':True,
                'ordering_source':'OSM bridge/layer; local crossing topology','crossings':crossings,'approaches':[]}
        for end in (0,-1):
            node=deck['nodes'][end];point=Point(deck['points'][end]);base=height_at(terrain,point.x,point.y)
            endpoint_z=deck['profile'][end][1]
            if abs(endpoint_z-base)<.05:continue
            candidates=[g for g in ground if node in g['nodes']]
            if len(candidates)!=1:
                raise ValueError('Bridge approach needs one unambiguous road at endpoint '+node+' ('+sid+')')
            consumed=[];points=[];current=candidates[0];join=node;distance=0
            while True:
                reverse=current['nodes'][-1]==join
                pts=current['points'][::-1]if reverse else current['points']
                nodes=current['nodes'][::-1]if reverse else current['nodes']
                segment=LineString(pts);end_base=height_at(terrain,*pts[-1])
                needed=max(12,1.6*abs(z-end_base)/POLICY['inferred_approach_grade'])
                take=min(segment.length,max(0,needed-distance))
                # If the needed endpoint moved closer as terrain rose, still
                # retain a positive, reproducible final piece.
                if take<1:take=min(segment.length,1)
                part=substring(segment,0,take)
                points.extend(list(part.coords)[1:]if points else list(part.coords))
                distance+=take;consumed.append(current);ground.remove(current)
                if take<segment.length-.05:
                    target_node=sid+('-start'if end==0 else'-end')+'-ground'
                    rest=substring(segment,take,segment.length)
                    ground.append({**current,'points':[list(p)for p in rest.coords],
                                   'parts':export(rest.buffer(current['width']/2,cap_style=2,join_style=1)),
                                   'nodes':[target_node,nodes[-1]]})
                    break
                target_node=nodes[-1]
                actual_needed=1.6*abs(z-height_at(terrain,*points[-1]))/POLICY['inferred_approach_grade']
                if distance>=max(8,actual_needed):break
                following=[g for g in ground if target_node in g['nodes']]
                if len(following)!=1 or distance>POLICY['max_context_approach_m']:
                    raise ValueError('Insufficient unbranched approach context for '+sid)
                current=following[0];join=target_node
            ramp_line=LineString(points);end_z=height_at(terrain,*points[-1])
            profile=sampled(ramp_line,lambda p,t:z+(end_z-z)*(t*t*(3-2*t)))
            ramp=make_surface(sid+('-approach-a'if end==0 else'-approach-b'),'approach',ramp_line,width,
                              consumed[0]['source_tags'],[node,target_node],profile)
            ramp['source_ids']=[g['id']for g in consumed];ramp['bridge_id']=sid
            if ramp_line.buffer(width/2).intersection(water.buffer(-1)).area>2:
                raise ValueError('Inferred approach would fill mapped water: '+sid)
            terrain['embankments'].append({k:ramp[k]for k in ('id','points','width','profile')})
            approaches.append(ramp);record['approaches'].append(ramp['id'])
        for other in decks[:-1]:
            if LineString(other['points']).buffer(other['width']/2).intersection(line.buffer(width/2)).area>.05:
                raise ValueError('Overlapping bridge decks are outside this edition: '+sid)
        records.append(record)
    for g in ground:
        line=LineString(g['points']);g['profile']=sampled(line,lambda p,t:height_at(terrain,p.x,p.y))
    surfaces=ground+approaches+decks
    endpoints=defaultdict(list)
    for g in surfaces:
        for n in g['nodes']:endpoints[n].append(g)
    for g in surfaces:
        g['connections']=sorted({other['id']for n in g['nodes']for other in endpoints[n]if other is not g})
    return {'schema':1,'policy':POLICY,'surfaces':surfaces,'obstacles':[],
            'report':{'policy':POLICY,'records':records,'omitted':omitted,
                      'height_accuracy':'Inferred profiles, relative terrain; no surveyed deck height/clearance',
                      'osm_ele':'Retained in source tags; not fused across unresolved vertical datums'}}


def fit_ground_profiles(ground,terrain):
    """Constrained roadbeds suppress noisy DEM banks/voids, with shared node heights."""
    nodes={};lengths={}
    for g in ground:
        line=LineString(g['points']);lengths[g['id']]=line.length
        for n,p in zip(g['nodes'],[g['points'][0],g['points'][-1]]):nodes.setdefault(n,raster_height(terrain,*p))
    for _ in range(80):
        changed=0
        for g in ground:
            a,b=g['nodes'];limit=lengths[g['id']]*.14;difference=nodes[b]-nodes[a]
            if abs(difference)>limit:
                correction=(abs(difference)-limit)/2* (1 if difference>0 else -1)
                nodes[a]+=correction;nodes[b]-=correction;changed=max(changed,abs(correction))
        if changed<1e-6:break
    profiles=[];grid={};adjusted=0
    for g in ground:
        line=LineString(g['points']);profile=sampled(line,lambda p,t:raster_height(terrain,p.x,p.y))
        values=[p[1]for p in profile]
        values=[sum(values[max(0,i-3):i+4])/len(values[max(0,i-3):i+4])for i in range(len(values))]
        values[0]=nodes[g['nodes'][0]];values[-1]=nodes[g['nodes'][-1]]
        # Alternate bounded slopes with fixed shared endpoints. This is inferred
        # road grading, not a claim that coarse raster noise is a surveyed hill.
        for _ in range(12):
            for i in range(1,len(values)-1):
                limit=(profile[i][0]-profile[i-1][0])*.16;values[i]=max(values[i-1]-limit,min(values[i-1]+limit,values[i]))
            for i in range(len(values)-2,0,-1):
                limit=(profile[i+1][0]-profile[i][0])*.16;values[i]=max(values[i+1]-limit,min(values[i+1]+limit,values[i]))
        if any(abs(v-p[1])>.05 for v,p in zip(values,profile)):adjusted+=1
        g['profile']=[[p[0],v]for p,v in zip(profile,values)]
        record={k:g[k]for k in ('id','points','width','profile')};index=len(profiles);profiles.append(record)
        xs,ys=zip(*g['points']);margin=g['width']/2+6
        for x in range(math.floor((min(xs)-margin)/20),math.floor((max(xs)+margin)/20)+1):
            for y in range(math.floor((min(ys)-margin)/20),math.floor((max(ys)+margin)/20)+1):grid.setdefault(f'{x},{y}',[]).append(index)
    terrain.update(road_profiles=profiles,road_profile_grid=grid,roadbed_policy={
        'id':'shared-node-roadbed-v1','node_grade_limit':.14,'profile_grade_limit':.16,
        'adjusted_surfaces':adjusted,'inferred':True,'smoothing_window_m':14})


def validate(network,terrain):
    surfaces={s['id']:s for s in network['surfaces']};checks=[]
    for surface in surfaces.values():
        profile=surface['profile']
        for a,b in zip(profile,profile[1:]):
            if b[0]<=a[0] or not all(math.isfinite(v)for v in (*a,*b)):
                raise ValueError('Invalid surface profile: '+surface['id'])
            if abs((b[1]-a[1])/(b[0]-a[0]))>network['policy']['max_grade']+.001:
                if LineString(surface['points']).intersects(Polygon([[-100,-100],[100,-100],[100,100],[-100,100]])):
                    raise ValueError('Excessive road grade: '+surface['id'])
        for cid in surface['connections']:
            if cid not in surfaces or surface['id'] not in surfaces[cid]['connections']:
                raise ValueError('Non-reciprocal surface connection')
            other=surfaces[cid]
            for a,na in enumerate(surface['nodes']):
                for b,nb in enumerate(other['nodes']):
                    if na!=nb:continue
                    p=surface['points'][0 if a==0 else -1];q=other['points'][0 if b==0 else -1]
                    if math.dist(p,q)>.05 or abs(profile_at(surface,*p)[0]-profile_at(other,*q)[0])>network['policy']['height_step_m']:
                        raise ValueError('Discontinuous surface connection: '+surface['id']+' / '+cid)
        checks.append({'id':surface['id'],'profile_samples':len(profile),'connections':len(surface['connections'])})
    for bridge in network['report']['records']:
        deck=surfaces[bridge['id']]
        for crossing in bridge['crossings']:
            lower=surfaces.get(crossing['surface_id'])
            if lower is None:raise ValueError('A bridge approach consumed an underlying crossing')
            for point in crossing.get('clearance_samples',[crossing['point']]):
                low=height_at(terrain,*point)if lower['kind']=='ground'and max(map(abs,point))<=160 else profile_at(lower,*point)[0]
                high=profile_at(deck,*point)[0]
                if high-deck['thickness']-low<network['policy']['required_clearance_m']-.01:
                    raise ValueError('Insufficient inferred clearance: '+deck['id'])
    return {'surfaces':checks,'bridges':len(network['report']['records']),'status':'passed'}
