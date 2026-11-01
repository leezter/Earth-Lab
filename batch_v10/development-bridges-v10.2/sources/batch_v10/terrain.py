"""Shared metre-space terrain/profile sampling; also runs inside Blender."""
import math


def project_line(points, x, y):
    best = None
    station = 0.0
    for a, b in zip(points, points[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/length**2))
        d = math.hypot(x-a[0]-dx*t, y-a[1]-dy*t)
        candidate = (d, station+t*length, dx/length, dy/length)
        if best is None or d < best[0]:
            best = candidate
        station += length
    return best or (float('inf'), 0, 1, 0)


def profile_at(surface, x, y):
    distance, station, tx, ty = project_line(surface['points'], x, y)
    samples = surface['profile']
    for a, b in zip(samples, samples[1:]):
        if station <= b[0]+1e-8:
            length = b[0]-a[0]
            t = max(0, min(1, (station-a[0])/max(length, 1e-9)))
            grade = (b[1]-a[1])/max(length, 1e-9)
            return a[1]+t*(b[1]-a[1]), grade*tx, grade*ty
    return samples[-1][1], 0, 0


def raster_height(terrain, x, y):
    grid = terrain['heights']; step = terrain['step']; x0, y0 = terrain['origin']
    fx = max(0, min(len(grid[0])-1.00000001, (x-x0)/step))
    fy = max(0, min(len(grid)-1.00000001, (y-y0)/step))
    ix, iy = int(fx), int(fy); u, v = fx-ix, fy-iy
    return ((1-u)*grid[iy][ix]+u*grid[iy][ix+1])*(1-v)+((1-u)*grid[iy+1][ix]+u*grid[iy+1][ix+1])*v


def height_at(terrain, x, y):
    base = raster_height(terrain, x, y)
    candidates=terrain.get('road_profile_grid',{}).get(f'{math.floor(x/20)},{math.floor(y/20)}',[])
    best=None
    for index in candidates:
        road=terrain['road_profiles'][index]
        distance,_,_,_=project_line(road['points'],x,y)
        if distance>=road['width']/2+6:continue
        if best is None or distance<best[0]:best=(distance,road)
    if best:
        distance,road=best;blend=max(0,min(1,(road['width']/2+6-distance)/6))
        base+=(profile_at(road,x,y)[0]-base)*blend
    for ramp in terrain.get('embankments', []):
        distance, station, _, _ = project_line(ramp['points'], x, y)
        # Do not extend an approach beyond either endpoint.
        endpoint = min(math.dist((x,y), ramp['points'][0]), math.dist((x,y), ramp['points'][-1]))
        half = ramp['width']/2
        if distance >= half+8 or (station in (0, ramp['profile'][-1][0]) and endpoint > half):
            continue
        z, _, _ = profile_at(ramp, x, y)
        blend = max(0, min(1, (half+8-distance)/8))
        base += (z-base)*blend
    return base


def gradient(terrain, x, y):
    e = .5
    return ((height_at(terrain,x+e,y)-height_at(terrain,x-e,y))/(2*e),
            (height_at(terrain,x,y+e)-height_at(terrain,x,y-e))/(2*e))
