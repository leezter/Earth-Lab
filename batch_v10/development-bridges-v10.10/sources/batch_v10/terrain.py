"""Shared metre-space terrain/profile sampling; also runs inside Blender."""
import math
from terrain_surface import inside as in_surface,sample as surface_height,canonical_grid


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
    grid=terrain.get('surface_grid')
    if grid and in_surface(grid,x,y):return surface_height(grid,x,y)
    return model_height(terrain,x,y)


def model_height(terrain,x,y):
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


def finalize(terrain,network):
    terrain['surface_grid']=canonical_grid(lambda x,y:model_height(terrain,x,y))
    fit_shared_grid(terrain,network)
    # Ground network reports use the actual shared ground planes as well.
    for road in network['surfaces']:
        if road['kind']=='ground':
            for row in road['profile']:
                station=row[0];remaining=station
                for a,b in zip(road['points'],road['points'][1:]):
                    length=math.dist(a,b)
                    if remaining<=length+1e-8:
                        t=max(0,min(1,remaining/max(length,1e-9)))
                        x=a[0]+t*(b[0]-a[0]);y=a[1]+t*(b[1]-a[1])
                        if max(abs(x),abs(y))<=160:row[1]=height_at(terrain,x,y)
                        break
                    remaining-=length


def point_at(surface,station):
    for a,b in zip(surface['points'],surface['points'][1:]):
        length=math.dist(a,b)
        if station<=length+1e-8:
            t=max(0,min(1,station/max(length,1e-9)))
            return a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])
        station-=length
    return surface['points'][-1]


def fit_shared_grid(terrain,network):
    """Fit one ground plane field to the constrained road profiles.

    Sampling a narrow road onto a raster can pick up an adjacent bank. A local
    least-squares projection retains the road profile on the canonical mesh,
    rather than permitting a new steep bump between road sample stations.
    """
    import numpy as np
    import hashlib,json
    grid=terrain['surface_grid'];array=np.asarray(grid['heights'],dtype=float)
    width=array.shape[1];indices=[];weights=[];expected=[]
    for road in network['surfaces']:
        if road['kind']=='deck':continue
        stations=[row[0]for row in road['profile']]
        stations += [(a[0]+b[0])/2 for a,b in zip(road['profile'],road['profile'][1:])]
        for station in stations:
            x,y=point_at(road,station)
            if max(abs(x),abs(y))>160:continue
            z=profile_at(road,x,y)[0]
            fx=(x-grid['origin'][0])/grid['step'];fy=(y-grid['origin'][1])/grid['step']
            ix,iy=int(fx),int(fy);u,v=fx-ix,fy-iy;k=iy*width+ix
            if u+v<=1:indices.append([k,k+1,k+width]);weights.append([1-u-v,u,v])
            else:indices.append([k+width+1,k+width,k+1]);weights.append([u+v-1,1-u,1-v])
            expected.append(z)
    if not indices:return
    indices=np.asarray(indices);weights=np.asarray(weights);expected=np.asarray(expected)
    values=array.ravel().copy();original=values.copy();denominator=np.zeros_like(values)
    np.add.at(denominator,indices.ravel(),(weights*weights).ravel())
    for iteration in range(120):
        residual=expected-np.sum(values[indices]*weights,axis=1)
        if np.max(np.abs(residual))<1e-8:break
        correction=np.zeros_like(values)
        np.add.at(correction,indices.ravel(),(weights*residual[:,None]).ravel())
        values+=.5*correction/(denominator+.025)
    grid['heights']=np.round(values.reshape(array.shape),6).tolist()
    grid['sha256']=hashlib.sha256(json.dumps(grid['heights'],separators=(',',':')).encode()).hexdigest()
    terrain['roadbed_projection']={'policy':'shared-road-plane-fit-v1','iterations':iteration+1,
        'max_profile_error_m':float(np.max(np.abs(residual))),'mean_profile_error_m':float(np.mean(np.abs(residual))),
        'max_grid_adjustment_m':float(np.max(np.abs(values-original))),'numpy_version':np.__version__,'inferred':True}


def gradient(terrain, x, y):
    e = .5
    return ((height_at(terrain,x+e,y)-height_at(terrain,x-e,y))/(2*e),
            (height_at(terrain,x,y+e)-height_at(terrain,x,y-e))/(2*e))
