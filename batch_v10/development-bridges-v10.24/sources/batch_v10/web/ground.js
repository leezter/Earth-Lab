function inside(point,ring){let v=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;}
export function containsPart(point,part){return inside(point,part[0])&&!part.slice(1).some(r=>inside(point,r));}
export function siteGroundAt(scene,x,y){
 for(const [key,parts]of Object.entries(scene?.site_surfaces||{})){
  if(!parts.some(part=>containsPart([x,y],part)))continue;
  const family=scene.site_report.materials[key].family;
  const grip=['compacted','gravel'].includes(family)?'gravel':['earth','sand','grass'].includes(family)?'dirt':family==='asphalt'?'asphalt':'concrete';
  return {family,grip};
 }
 return null;
}
