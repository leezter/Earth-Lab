"""Boundary-constrained tessellation and checks against the actual mesh faces."""
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, MultiPoint
from shapely.ops import unary_union, triangulate


def polygon_parts(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'Polygon':
        yield geometry
    else:
        for part in getattr(geometry, 'geoms', []):
            yield from polygon_parts(part)


def source_shape(parts, clip=None):
    shape=unary_union([Polygon(p[0],p[1:]).buffer(0) for p in parts])
    return shape.intersection(clip) if clip is not None else shape


def triangles(shape):
    for part in polygon_parts(shape):
        yield from constrained_delaunay_triangles(part).geoms


def pack(triangles, height=None):
    vertices=[];faces=[];index={}
    for triangle in triangles:
        face=[]
        for x,y in list(triangle.exterior.coords)[:3]:
            key=(float(x),float(y))
            if key not in index:
                index[key]=len(vertices)
                vertices.append([*key,height(x,y)] if height else list(key))
            face.append(index[key])
        faces.append(face)
    return {'vertices':vertices,'faces':faces}


def flat_mesh(parts, clip):
    return pack(triangles(source_shape(parts,clip)))


def flat_sources(scene):
    result={name:scene[name] for name in ('roads','pavements','green','gardens','water')}
    result.update(scene['surfaces'])
    for prefix,key in (('', 'landcover'),('path_','path_surfaces'),('walk_','pavement_surfaces'),
                       ('site_','site_surfaces'),('parking_','parking_surfaces'),('paint_','road_paint'),('mobility_','mobility_surfaces')):
        result.update({prefix+name:parts for name,parts in scene.get(key,{}).items()})
    result.update(bay_white=scene.get('parking_paint',[]),tree_pits=scene.get('tree_pits',[]),access_tactile=scene.get('tactile',[]),mobility_white=scene.get('mobility_paint',[]))
    return result


def roof_surface(poly, points, height):
    # Keep the existing sampled pitched-roof profile. Clip the point-based
    # triangulation at the footprint, then constrain every clipped piece;
    # discarding crossing triangles loses whole roof wedges and courtyard edges.
    def fitted():
        for triangle in triangulate(MultiPoint(points)):
            yield from triangles(triangle.intersection(poly))
    return pack(fitted(),height)


def coverage(source, mesh, clip=None):
    faces=[Polygon([mesh['vertices'][i][:2] for i in face]) for face in mesh['faces']]
    target=source.intersection(clip) if clip is not None else source
    actual=unary_union(faces)
    if clip is not None:
        actual=actual.intersection(clip)
    result={'source_m2':target.area,'mesh_m2':actual.area,
            'missing_m2':target.difference(actual).area,
            'outside_m2':actual.difference(target).area}
    tolerance=max(1e-6,target.area*1e-9)
    if result['missing_m2']>tolerance or result['outside_m2']>tolerance:
        raise ValueError('Mesh does not cover its source polygon: '+str(result))
    return result
