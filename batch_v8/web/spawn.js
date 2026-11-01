// Shared runtime rule: place a car-sized clearance envelope on a driveable road.
// No site IDs, coordinate overrides or changes to baked geometry.
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function intersects(a,b,c,d){if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;}
function inside(point,ring){let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;}
export function clearSpawn(roads,buildings,x,y,length,width){
 const candidates=[];
 for(const road of roads){if(!road.drive||road.width<width+.15)continue;for(const line of road.lines)for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.2)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(len*len)));for(const shift of [0,-4,4,-8,8,-16,16]){const u=Math.max(0,Math.min(1,t+shift/len)),px=a[0]+u*dx,py=a[1]+u*dy,d=Math.hypot(px-x,py-y);if(d<70&&Math.abs(px)<82&&Math.abs(py)<82)candidates.push({x:px,y:py,d,angle:Math.atan2(dy,dx),road});}}}
 candidates.sort((a,b)=>a.d-b.d);
 const footprint=buildings.flatMap(b=>b.parts.map(part=>({part,minX:Math.min(...part[0].map(p=>p[0])),maxX:Math.max(...part[0].map(p=>p[0])),minY:Math.min(...part[0].map(p=>p[1])),maxY:Math.max(...part[0].map(p=>p[1]))})));
 for(const n of candidates){const cs=Math.cos(n.angle),sn=Math.sin(n.angle),l=length/2+1.2,w=width/2+.2;const rect=[[-l,-w],[l,-w],[l,w],[-l,w]].map(([a,b])=>[n.x+a*cs-b*sn,n.y+a*sn+b*cs]);let blocked=false;
  for(const f of footprint){if(f.minX>n.x+l+w||f.maxX<n.x-l-w||f.minY>n.y+l+w||f.maxY<n.y-l-w)continue;const solid=p=>inside(p,f.part[0])&&!f.part.slice(1).some(r=>inside(p,r));if(rect.some(solid)||solid([n.x,n.y])||f.part[0].some(p=>inside(p,rect))){blocked=true;break;}for(const ring of f.part){for(let i=1;i<ring.length;i++)for(let j=0;j<4;j++)if(intersects(ring[i-1],ring[i],rect[j],rect[(j+1)%4])){blocked=true;break;}if(blocked)break;}if(blocked)break;}
  if(!blocked)return n;
 }
 return null;
}
