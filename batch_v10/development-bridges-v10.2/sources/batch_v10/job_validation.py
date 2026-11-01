"""Reject unsupported source interpretations before publishing playable tiles."""


def validate_parking(scene):
    # This acceptance check is separate from the frozen renderer. Ground-level
    # parking footprints must not be accepted from an indoor/underground kind,
    # even when the source omits its location/level tags.
    for record in scene['parking_report']['records']:
        tags=record.get('source_tags',{})
        if (tags.get('parking') in {'underground','multi-storey','rooftop','garage_boxes','sheds'}
                or tags.get('building') not in {None,'','no'}):
            raise ValueError('Unsupported enclosed or layered parking footprint '+record['id']+
                             '. This renderer cannot safely publish this area.')


def validate_spatial(scene):
    """Reject geometry conflicts before spending time on a Blender render."""
    from shapely.geometry import Polygon,Point
    from shapely.ops import unary_union
    def shape(parts):return unary_union([Polygon(p[0],p[1:]).buffer(0)for p in parts])
    def require(ok,message):
        if not ok:raise ValueError(message)
    walk=shape(scene['pavements']);road=shape(scene['roads']);pits=shape(scene['tree_pits'])
    solid=unary_union([shape(b['parts'])for b in scene['buildings']])
    require(walk.intersection(pits).area<.15,'Protected tree pits paved over')
    require(walk.intersection(solid).area<.15,'Pedestrian geometry overlaps buildings')
    require(walk.buffer(-.002).intersection(road.buffer(-.002)).area<.001,'Pedestrian geometry overlaps carriageway')
    for name,domain,groups in [('pavement',walk,scene['pavement_surfaces']),('road',road,scene['surfaces'])]:
        materials=[shape(parts)for parts in groups.values()];joined=unary_union(materials)
        require(sum(g.area for g in materials)-joined.area<.15,name+' materials overlap')
        gap=domain.difference(joined.buffer(.002))
        pieces=[gap]if gap.geom_type=='Polygon'else list(getattr(gap,'geoms',[]))
        require(all(p.area<=.03+.002*p.length for p in pieces),name+' material coverage gap')
        require(joined.difference(domain.buffer(.002)).area<.01,name+' material outside source footprint')
    reserved=shape(scene['reserved_lanes']);paint=shape(scene['mobility_paint'])
    require(reserved.difference(road.buffer(.002)).area<.02,'Reserved lane outside carriageway')
    require(paint.difference(reserved.buffer(.002)).area<.02,'Mobility paint outside lane')
    require(shape(scene['refuges']).intersection(road.buffer(-.002)).area<.01,'Refuge remains drivable')
    require(shape(scene['tactile']).difference(walk.buffer(.002)).area<.02,'Tactile pad outside pedestrian space')
    for ramp in scene['ramps']:
        require(shape(ramp['parts']).difference(walk.buffer(.002)).area<.02,'Ramp outside pedestrian space')
    solid_interior=solid.buffer(-.002);road_interior=road.buffer(-.002)
    for item in scene['furniture']:
        p=Point(item['point'])
        require(not solid_interior.covers(p),'Furniture inside building')
        if item['kind']!='bollard':require(not road_interior.covers(p),'Furniture inside carriageway')
