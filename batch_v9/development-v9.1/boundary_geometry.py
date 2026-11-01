"""Small clipping helper shared with Blender's standard-library-only runtime."""


def clipped_segments(points, half=155):
    for a,b in zip(points,points[1:]):
        dx=b[0]-a[0];dy=b[1]-a[1];low=0.;high=1.;valid=True
        if dx*dx+dy*dy<1e-12:
            continue
        for p,q in ((-dx,a[0]+half),(dx,half-a[0]),(-dy,a[1]+half),(dy,half-a[1])):
            if abs(p)<1e-12:
                if q<0:
                    valid=False;break
            else:
                t=q/p
                if p<0:
                    low=max(low,t)
                else:
                    high=min(high,t)
        if valid and high>low:
            yield [(a[0]+low*dx,a[1]+low*dy),(a[0]+high*dx,a[1]+high*dy)]
