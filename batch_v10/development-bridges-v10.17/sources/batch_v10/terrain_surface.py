"""One piecewise-planar ground field for every rendered surface and the car.

Independent tessellations of a curved height function intersect even when given
small Z offsets. All overlays must instead clip to the same triangle planes.
This module is dependency-free so Blender and the browser can share its format.
"""
import hashlib,json,math


def canonical_grid(calculate,half=162,step=2):
    n=round(half*2/step)+1
    heights=[[round(calculate(-half+x*step,-half+y*step),6)for x in range(n)]for y in range(n)]
    digest=hashlib.sha256(json.dumps(heights,separators=(',',':')).encode()).hexdigest()
    return {'origin':[-half,-half],'step':step,'heights':heights,
            'policy':'shared-triangle-ground-v1','sha256':digest}


def inside(grid,x,y):
    x0,y0=grid['origin'];step=grid['step']
    return x0<=x<=x0+(len(grid['heights'][0])-1)*step and y0<=y<=y0+(len(grid['heights'])-1)*step


def sample(grid,x,y):
    heights=grid['heights'];x0,y0=grid['origin'];step=grid['step']
    fx=max(0,min(len(heights[0])-1.00000001,(x-x0)/step));fy=max(0,min(len(heights)-1.00000001,(y-y0)/step))
    ix,iy=int(fx),int(fy);u,v=fx-ix,fy-iy
    a,b=heights[iy][ix],heights[iy][ix+1];c,d=heights[iy+1][ix],heights[iy+1][ix+1]
    if u+v<=1:return a+u*(b-a)+v*(c-a)
    return d+(1-u)*(c-d)+(1-v)*(b-d)


def cell_triangles(x,y,step):
    x0,y0=x*step,y*step;x1,y1=x0+step,y0+step
    return (((x0,y0),(x1,y0),(x0,y1)),((x1,y1),(x0,y1),(x1,y0)))
