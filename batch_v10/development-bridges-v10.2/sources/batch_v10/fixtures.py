"""Synthetic geometry for the overpass proof and slope/flat regressions."""
import copy,math
from shapely.geometry import LineString,box
from shapely.ops import unary_union
from surface_network import POLICY,make_surface,sampled,export,validate
from terrain_sources import flat
from bridge_geometry import obstacles


def scene(name='overpass'):
    if name not in {'overpass','hills','flat'}:raise ValueError('Unknown fixture')
    terrain=flat();terrain['source']={'status':'available','provider':'authored synthetic fixture',
        'datum':'arbitrary local metre reference','policy':'fixture-v1','warning':'Synthetic test scene, not a mapped location'}
    tags={'highway':'residential','surface':'asphalt','name':'Synthetic test road'}
    low=LineString([(0,-110),(0,110)]);surfaces=[]
    ground=make_surface('lower','ground',low,12,tags,['south','north'],[[0,0],[220,0]])
    surfaces.append(ground)
    if name=='overpass':
        z=5.05;deckline=LineString([(-22,0),(22,0)])
        deck=make_surface('bridge-fixture','deck',deckline,12,{**tags,'bridge':'yes','layer':'1'},['a','b'],[[0,z],[44,z]])
        deck['thickness']=.45;deck['connections']=['approach-a','approach-b'];surfaces.append(deck)
        for side in (-1,1):
            line=LineString([(side*22,0),(side*96,0)])
            profile=sampled(line,lambda p,t:z*(1-t*t*(3-2*t)))
            sid='approach-a'if side<0 else'approach-b'
            ramp=make_surface(sid,'approach',line,12,tags,['a'if side<0 else'b','outer-'+str(side)],profile)
            ramp['bridge_id']=deck['id'];ramp['connections']=[deck['id']];surfaces.append(ramp)
            terrain['embankments'].append({k:ramp[k]for k in ('id','points','width','profile')})
        report={'policy':POLICY,'records':[{'id':deck['id'],'source_ids':['synthetic'],
                'crossings':[{'surface_id':'lower','point':[0,0],'lower_z':0}],
                'height_inferred':True,'approaches':['approach-a','approach-b']}],
                'omitted':[],'height_accuracy':'Authored synthetic test geometry'}
        spawn={'x':0,'y':0,'surface_id':'bridge-fixture'}
    else:
        terrain['embankments']=[]
        for iy,row in enumerate(terrain['heights']):
            for ix in range(len(row)):
                x=terrain['origin'][0]+ix*terrain['step']
                row[ix]=x*.08 if name=='hills'else 0
        road=LineString([(-110,0),(110,0)])
        surfaces=[make_surface('hill-road','ground',road,14,tags,['a','b'],[[0,-8.8 if name=='hills'else 0],[220,8.8 if name=='hills'else 0]])]
        report={'policy':POLICY,'records':[],'omitted':[],'height_accuracy':'Authored synthetic test geometry'}
        spawn={'x':-65,'y':0,'surface_id':'hill-road'}
    network={'schema':1,'policy':copy.deepcopy(POLICY),'surfaces':surfaces,'obstacles':[],'report':report}
    obstacles(network,terrain);checks=validate(network,terrain)
    if name=='overpass':
        network['obstacles'].append({'id':'fixture-pier','kind':'support','parts':export(box(-13,2,-11,4)),
                                    'zmin':-.3,'zmax':4.6,'inferred':True,'bridge_id':'bridge-fixture'})
    driving=unary_union([LineString(g['points']).buffer(g['width']/2,cap_style=2)for g in surfaces if g['kind']!='deck'])
    s={'origin':[0,0],'version':10,'extent':[-420,-420,420,420],'context':{'ground':'aerial_grass_rock'},
       'buildings':[],'roads':export(driving),'surfaces':{'asphalt':export(driving)},'path_surfaces':{},
       'pavements':[],'green':[],'gardens':[],'water':[],'trees':[],'shrubs':[],
       'landcover':{'grass':export(box(-155,-155,155,155).difference(driving))},
       'streets':[{'points':g['points'],'width':g['width'],'name':g['name'],'class':'residential','surface_family':'asphalt'}for g in surfaces],
       'pavement_surfaces':{},'pavement_report':{'materials':{},'sources':{},'area_m2':0},'kerbs':[],
       'driveways':[],'tree_pits':[],'site_areas':[],'site_surfaces':{},'boundaries':[],'gates':[],
       'boundary_solids':[],'site_report':{'materials':{},'area_m2':0,'boundaries':0,'boundary_kinds':{},'gates':0},
       'refuges':[],'ramps':[],'tactile':[],'access_report':{},'furniture':[],'furniture_solids':[],
       'furniture_report':{},'mobility_surfaces':{},'mobility_paint':[],'reserved_lanes':[],
       'mobility_report':{'materials':{}},'parking_surfaces':{},'parking_paint':[],
       'parking_report':{'records':[]},'geometry_report':{},'road_paint':{},'traffic_hardware':[],'street_report':{},
       'terrain':terrain,'surface_network':network,'bridge_report':report,'bridge_checks':checks,
       'spawn':spawn,'notes':['Synthetic '+name+' fixture; no geographic accuracy claim.']}
    return {'cell':'synthetic-'+name,'roads':[],'buildings':[],'credits':'Authored test geometry','scene':s,
            'pavement_inputs':{'osm':{'elements':[]},'survey':[]}}
