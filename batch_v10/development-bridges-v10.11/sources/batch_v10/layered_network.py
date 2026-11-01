"""Connected deck graph and monotone metric clearance/grade constraint solver.

No global layer-to-metres mapping: ordering creates local clearance constraints.
The least feasible heights above the sampled terrain are inferred, not surveyed.
"""
import math,heapq
from collections import Counter,defaultdict,deque
from shapely.geometry import LineString,Point
from shapely.ops import unary_union
from bridge_sources import is_bridge
from terrain import height_at,profile_at


def required(roads):
    decks=[r for r in roads if is_bridge(r['tags'])]
    counts=Counter(n for r in decks for i,n in enumerate(r['nodes'])for _ in range(1 if i in (0,len(r['nodes'])-1)else 2))
    if any(n>2 for n in counts.values()):return True
    for i,a in enumerate(decks):
        for b in decks[:i]:
            if set(a['nodes'])&set(b['nodes']) and abs(a['width']-b['width'])>1:return True
            if not set(a['nodes'])&set(b['nodes']) and a['line'].buffer(a['width']/2).intersects(b['line'].buffer(b['width']/2)):
                return True
    return False


def compile_layered(roads,terrain,local,water,omitted):
    from surface_network import make_surface,export,POLICY,UnsupportedLayout,fit_ground_profiles
    if terrain['source']['status']!='available':raise ValueError('Layered bridges require identified terrain data')
    policy={**POLICY,'id':'connected-deck-constraints-v1','profile_step_m':2,'junction_grade':0,
            'approach_context_m':420,'clearance_margin_m':.35}
    counts=Counter(n for r in roads for n in r['nodes'])
    surfaces=[]
    for r in roads:
        cuts=[0]+[i for i in range(1,len(r['nodes'])-1)if counts[r['nodes'][i]]>1]+[len(r['nodes'])-1]
        for j,(a,b)in enumerate(zip(cuts,cuts[1:])):
            line=LineString(r['points'][a:b+1])
            if line.length<.05:continue
            deck=is_bridge(r['tags']);sid=('bridge-'if deck else'osm-')+r['id']+'-'+str(j)
            s=make_surface(sid,'deck'if deck else'ground',line,r['width'],r['tags'],[r['nodes'][a],r['nodes'][b]],[])
            s.update(source_ids=[r['id']],thickness=.45 if deck else 0)
            surfaces.append(s)
    ground=[s for s in surfaces if s['kind']=='ground'];fit_ground_profiles(ground,terrain)
    lines={s['id']:LineString(s['points'])for s in surfaces}
    shapes={s['id']:lines[s['id']].buffer(s['width']/2,cap_style=2,join_style=1)for s in surfaces}
    endpoints=defaultdict(list)
    for s in surfaces:
        for n in s['nodes']:endpoints[n].append(s)
    # Rounded shared deck ends close the polygon wedges at branching junctions.
    junctions={n:gs for n,gs in endpoints.items()if len(gs)>1 and any(g['kind']=='deck'for g in gs)}
    for n,gs in junctions.items():
        for s in gs:
            if s['kind']!='deck':continue
            p=s['points'][0 if s['nodes'][0]==n else -1]
            shapes[s['id']]=shapes[s['id']].union(Point(p).buffer(s['width']/2,quad_segs=8))
    # Vertices are graph variables; shared source nodes have exactly one height.
    values=[];keys={};positions=[];samples={};edges=[];fixed={}
    def variable(key,p,z):
        if key not in keys:
            keys[key]=len(values);values.append(z);positions.append(p)
        return keys[key]
    adjacency=defaultdict(list);deck_nodes=set()
    for s in surfaces:
        length=lines[s['id']].length;count=max(1,math.ceil(length/2));rows=[]
        for i in range(count+1):
            st=length*i/count;p=lines[s['id']].interpolate(st)
            key=('node',s['nodes'][0 if i==0 else -1])if i in (0,count)else(s['id'],i)
            z=s['profile'][i][1]if s['kind']=='ground'else height_at(terrain,p.x,p.y)
            rows.append((st,variable(key,(p.x,p.y),z)))
        samples[s['id']]=rows
        if s['kind']=='deck':deck_nodes.update((rows[0][1],rows[-1][1]))
        for (a,u),(b,v)in zip(rows,rows[1:]):
            grade=.17 if s['kind']=='ground'else .16
            edges.extend([(u,v,-grade*(b-a)),(v,u,-grade*(b-a))])
            if s['kind']=='ground':adjacency[u].append((v,b-a));adjacency[v].append((u,b-a))
    # Only road corridors reachable from a deck endpoint may become approaches.
    distance={n:0 for n in deck_nodes};queue=[(0,n)for n in deck_nodes];heapq.heapify(queue)
    while queue:
        d,u=heapq.heappop(queue)
        if d>distance[u]:continue
        for v,w in adjacency[u]:
            if d+w<distance.get(v,float('inf')):distance[v]=d+w;heapq.heappush(queue,(d+w,v))
    for s in ground:
        for st,u in samples[s['id']]:
            if distance.get(u,float('inf'))>policy['approach_context_m']:
                fixed[u]=values[u]
    portal_groups=[]
    for node,gs in junctions.items():
        origin=keys['node',node];limit=max(g['width']for g in gs)+2
        local_nodes={origin:0};todo=[(0,origin)]
        while todo:
            dist,u=heapq.heappop(todo)
            for v,w in adjacency[u]:
                if dist+w<=limit and dist+w<local_nodes.get(v,float('inf')):
                    local_nodes[v]=dist+w;heapq.heappush(todo,(dist+w,v))
        portal_groups.append(set(local_nodes))
        for u in local_nodes:
            # Flatten only complete short source links near the portal, not the
            # first metres of a long sloping ground approach.
            if any(u in (samples[g['id']][0][1],samples[g['id']][-1][1])for g in ground):
                edges.extend([(origin,u,0),(u,origin,0)])
    crossings=defaultdict(list);orders=[]
    def indices(s,p):
        st=lines[s['id']].project(Point(p));rows=samples[s['id']]
        for (a,u),(b,v)in zip(rows,rows[1:]):
            if st<=b+1e-8:return (u,v)
        return (rows[-1][1],)*2
    def points(shape):
        return [tuple(p)for part in export(shape)for ring in part for p in ring]
    def equal(a,b):edges.extend([(a,b,0),(b,a,0)])
    # A single flat portal at every shared deck node, including merge overlaps.
    for n,gs in junctions.items():
        u=keys['node',n]
        for s in gs:
            st0=0 if s['nodes'][0]==n else lines[s['id']].length
            reach=s['width']/2+1
            for other in gs:
                if other is s:continue
                overlap=shapes[s['id']].intersection(shapes[other['id']])
                for p in points(overlap):reach=max(reach,abs(lines[s['id']].project(Point(p))-st0)+2)
            # Flatten only elevated ribbons; ground approaches retain their slope.
            if s['kind']=='deck':
                s.setdefault('junction_reach',{})[n]=reach
                for st,v in samples[s['id']]:
                    if abs(st-st0)<=reach:equal(u,v)
    for i,a in enumerate(surfaces):
        for b in surfaces[:i]:
            if a['kind']!='deck'and b['kind']!='deck':continue
            overlap=shapes[a['id']].intersection(shapes[b['id']])
            if overlap.area<.02:continue
            shared=set(a['nodes'])&set(b['nodes'])
            ae={samples[a['id']][0][1],samples[a['id']][-1][1]};be={samples[b['id']][0][1],samples[b['id']][-1][1]}
            portal_join=any(ae&group and be&group for group in portal_groups)
            if shared or portal_join:
                # Shared-node overlaps belong to the same junction plane.
                if a['kind']==b['kind']=='deck':
                    for p in points(overlap):
                        for u in indices(a,p):
                            for v in indices(b,p):equal(u,v)
                continue
            if a['kind']==b['kind']=='deck':
                la=int(a['source_tags'].get('layer',1));lb=int(b['source_tags'].get('layer',1))
                if la==lb:raise UnsupportedLayout('Overlapping unconnected decks have ambiguous equal ordering: '+a['id']+' / '+b['id'])
                upper,lower=(a,b)if la>lb else(b,a);orders.append((lower['id'],upper['id']))
            else:upper,lower=(a,b)if a['kind']=='deck'else(b,a)
            pts=points(overlap)
            # Include centreline profile stations inside the overlap, not only
            # polygon boundary vertices (a lower crest may be in the interior).
            for s in (upper,lower):
                for st,u in samples[s['id']]:
                    p=lines[s['id']].interpolate(st)
                    if overlap.buffer(.01).covers(p):pts.append((p.x,p.y))
            gap=policy['required_clearance_m']+.45+policy['clearance_margin_m']
            for p in pts:
                for u in indices(upper,p):
                    for v in indices(lower,p):edges.append((v,u,gap))
            crossings[upper['id']].append({'surface_id':lower['id'],'point':list(overlap.centroid.coords[0]),'clearance_samples':[list(p)for p in pts]})
    # Longest-path relaxation computes the least feasible raise-only solution.
    # Positive cycles encode impossible ordering/grade constraints and fail.
    outgoing=defaultdict(list)
    for u,v,w in edges:outgoing[u].append((v,w))
    queue=deque(range(len(values)));queued=set(queue);updates=[0]*len(values)
    while queue:
        u=queue.popleft();queued.remove(u)
        for v,w in outgoing[u]:
            target=values[u]+w
            if target<=values[v]+1e-7:continue
            if v in fixed and target>fixed[v]+.001:
                raise UnsupportedLayout('Insufficient mapped approach length for bounded grade near '+str(tuple(round(t,1)for t in positions[v])))
            values[v]=target;updates[v]+=1
            if updates[v]>len(values):raise UnsupportedLayout('Conflicting bridge ordering or insufficient junction/grade context')
            if v not in queued:queue.append(v);queued.add(v)
    records=[]
    for s in surfaces:
        s['profile']=[[st,values[u]]for st,u in samples[s['id']]]
        s['connections']=sorted({g['id']for n in s['nodes']for g in endpoints[n]if g is not s})
        if s['kind']=='deck':
            s['parts']=export(shapes[s['id']]);s['junction_nodes']=[n for n in s['nodes']if n in junctions]
            records.append({'id':s['id'],'source_ids':s['source_ids'],'crossings':crossings[s['id']],
                            'height_inferred':True,'approaches':[g['id']for n in s['nodes']for g in endpoints[n]if g['kind']=='ground']})
        elif any(values[u]>height_at(terrain,*positions[u])+.05 for _,u in samples[s['id']]):
            s['kind']='approach';s['bridge_id']=s['id'];s['height_source']='connected graph inferred approach'
            terrain['embankments'].append({k:s[k]for k in ('id','points','width','profile')})
    profiles={s['id']:s['profile']for s in surfaces}
    for road in terrain['road_profiles']:road['profile']=profiles[road['id']]
    # Explicit painter ordering is a partial order between crossing decks.
    decks=[s for s in surfaces if s['kind']=='deck'];rank={s['id']:0 for s in decks}
    for _ in range(len(decks)):
        changed=False
        for a,b in orders:
            if rank[b]<=rank[a]:rank[b]=rank[a]+1;changed=True
        if not changed:break
    else:raise UnsupportedLayout('Bridge render ordering contains a cycle')
    for s in decks:s['render_order']=rank[s['id']]
    return {'schema':2,'policy':policy,'surfaces':surfaces,'obstacles':[],
            'report':{'policy':policy,'records':records,'omitted':omitted,'junctions':{n:[s['id']for s in gs]for n,gs in junctions.items()},
                      'solver':{'variables':len(values),'constraints':len(edges),'max_raise_m':max(values[i]-height_at(terrain,*p)for i,p in enumerate(positions))},
                      'height_accuracy':'Inferred connected metric profiles; no surveyed clearance','osm_ele':'Retained, not fused'}}
