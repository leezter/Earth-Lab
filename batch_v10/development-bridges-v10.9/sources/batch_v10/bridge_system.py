"""Attach terrain, independent road surfaces and height-aware obstacles to v10."""
from shapely.geometry import Point,Polygon,LineString
from shapely.ops import unary_union
import numpy as np

import terrain_sources
from surface_network import compile_network,validate
from bridge_geometry import obstacles
from surface_network import export
from terrain import height_at,finalize


def enrich(data,osm,xy):
    s=data['scene'];lat,lon=s['origin'];terrain=terrain_sources.read(lat,lon)
    # Water receives one robust local level within this bounded scene. This is an
    # inferred local water surface, not hydrology or a tide model.
    water=unary_union([Polygon(p[0],p[1:])for p in s['water']])
    water_cells=[]
    if not water.is_empty:
        for iy,row in enumerate(terrain['heights']):
            for ix,z in enumerate(row):
                x=terrain['origin'][0]+ix*terrain['step'];y=terrain['origin'][1]+iy*terrain['step']
                if water.covers(Point(x,y)):water_cells.append((iy,ix,z))
        if water_cells:
            level=float(np.percentile([z for _,_,z in water_cells],25))
            for iy,ix,_ in water_cells:terrain['heights'][iy][ix]=level
            terrain['water_level_local_m']=level
    network=compile_network(osm,xy,terrain,s['water'])
    finalize(terrain,network)
    checks=validate(network,terrain)
    obstacles(network,terrain)
    additions=[g for g in network['surfaces']if g['kind']=='approach'or g.get('ordering_inferred')]
    protected=unary_union([Polygon(p[0],p[1:])for p in s['pavements']]+[Polygon(p[0],p[1:])for b in s['buildings']for p in b['parts']])
    for surface in additions:
        original=unary_union([Polygon(p[0],p[1:])for p in surface['parts']])
        footprint=original.difference(protected).buffer(0)
        surface['parts']=export(footprint);surface['clipped_from_protected_ground_m2']=original.difference(footprint).area
        # New approach ownership supersedes the old ground finish exactly once.
        for family,parts in list(s['surfaces'].items()):
            s['surfaces'][family]=export(unary_union([Polygon(p[0],p[1:])for p in parts]).difference(footprint))
        family=surface['surface'];existing=unary_union([Polygon(p[0],p[1:])for p in s['surfaces'].get(family,[])])
        s['surfaces'][family]=export(existing.union(footprint))
        s['roads']=export(unary_union([Polygon(p[0],p[1:])for p in s['roads']]).union(footprint))
    decks=[g for g in network['surfaces']if g['kind']=='deck']
    if decks:
        nearest=min(decks,key=lambda g:LineString(g['points']).distance(Point(0,0)))
        point=LineString(nearest['points']).interpolate(LineString(nearest['points']).project(Point(0,0)))
        if abs(point.x)<80 and abs(point.y)<80:s['spawn']={'x':point.x,'y':point.y,'surface_id':nearest['id']}
    # Do not publish bridge edges that intersect an unrelated building. Ground
    # solids below a deck are filtered by height in the browser.
    for bridge in network['report']['records']:
        deck=next(g for g in network['surfaces']if g['id']==bridge['id'])
        for building in s['buildings']:
            shape=unary_union([Polygon(p[0],p[1:])for p in building['parts']])
            if LineString(deck['points']).buffer(deck['width']/2).intersection(shape).area>.1:
                centre=shape.centroid
                from terrain import profile_at
                if height_at(terrain,centre.x,centre.y)+building['height']>=profile_at(deck,centre.x,centre.y)[0]-.45:
                    raise ValueError('Bridge intersects a mapped building: '+bridge['id'])
    s.update(terrain=terrain,surface_network=network,bridge_report=network['report'],bridge_checks=checks)
    s['notes'].append('Bridges use mapped topology, inferred metric profiles and generic structures; terrain is relative, provider-dependent elevation.')
    return data
