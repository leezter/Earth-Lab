// Shared surface rules: metres, south-positive Y; no global OSM layer floors.
import {containsPart} from './ground.js';
export const vehicleHeights={GT:1.5,F1:.95,Bubble:1.6,Truck:3.8}; // Inferred conservative bounds, not sprite dimensions.

export function projectLine(points,x,y){
 let best={distance:Infinity,station:0,tx:1,ty:0},station=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  if(length<1e-9)continue;
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(length*length)));
  const distance=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
  if(distance<best.distance)best={distance,station:station+t*length,tx:dx/length,ty:dy/length,x:a[0]+t*dx,y:a[1]+t*dy};
  station+=length;
 }
 return best;
}
export function profileAt(surface,x,y){
 const p=projectLine(surface.points,x,y),samples=surface.profile;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i];if(p.station>b[0]+1e-8)continue;
  const length=b[0]-a[0],t=Math.max(0,Math.min(1,(p.station-a[0])/Math.max(length,1e-9))),grade=(b[1]-a[1])/Math.max(length,1e-9);
  return {z:a[1]+t*(b[1]-a[1]),gx:grade*p.tx,gy:grade*p.ty};
 }
 return {z:samples.at(-1)[1],gx:0,gy:0};
}
export function rasterHeight(terrain,x,y){
 const g=terrain.heights,[x0,y0]=terrain.origin;
 const fx=Math.max(0,Math.min(g[0].length-1.00000001,(x-x0)/terrain.step)),fy=Math.max(0,Math.min(g.length-1.00000001,(y-y0)/terrain.step));
 const ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy;
 return ((1-u)*g[iy][ix]+u*g[iy][ix+1])*(1-v)+((1-u)*g[iy+1][ix]+u*g[iy+1][ix+1])*v;
}
export function terrainHeight(terrain,x,y){
 const grid=terrain.surface_grid;
 if(grid){
  const g=grid.heights,[x0,y0]=grid.origin,step=grid.step;
  if(x>=x0&&y>=y0&&x<=x0+(g[0].length-1)*step&&y<=y0+(g.length-1)*step){
   const fx=Math.max(0,Math.min(g[0].length-1.00000001,(x-x0)/step)),fy=Math.max(0,Math.min(g.length-1.00000001,(y-y0)/step));
   const ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,a=g[iy][ix],b=g[iy][ix+1],c=g[iy+1][ix],d=g[iy+1][ix+1];
   return u+v<=1?a+u*(b-a)+v*(c-a):d+(1-u)*(c-d)+(1-v)*(b-d);
  }
 }
 let base=rasterHeight(terrain,x,y);
 let best=null;
 for(const i of terrain.road_profile_grid?.[`${Math.floor(x/20)},${Math.floor(y/20)}`]||[]){
  const road=terrain.road_profiles[i],p=projectLine(road.points,x,y);
  if(p.distance>=road.width/2+6)continue;
  if(!best||p.distance<best.distance)best={distance:p.distance,road};
 }
 if(best){const blend=Math.max(0,Math.min(1,(best.road.width/2+6-best.distance)/6));base+=(profileAt(best.road,x,y).z-base)*blend;}
 for(const ramp of terrain.embankments||[]){
  const p=projectLine(ramp.points,x,y),half=ramp.width/2;
  const endpoint=Math.min(Math.hypot(x-ramp.points[0][0],y-ramp.points[0][1]),Math.hypot(x-ramp.points.at(-1)[0],y-ramp.points.at(-1)[1]));
  if(p.distance>=half+8||([0,ramp.profile.at(-1)[0]].includes(p.station)&&endpoint>half))continue;
  const blend=Math.max(0,Math.min(1,(half+8-p.distance)/8));base+=(profileAt(ramp,x,y).z-base)*blend;
 }
 return base;
}
export class ElevationSystem{
 constructor(scene){
  this.scene=scene;this.terrain=scene.terrain;this.network=scene.surface_network;
  this.surfaces=new Map(this.network.surfaces.map(s=>[s.id,s]));this.grid=new Map();this.recoveries=0;
  for(const s of this.surfaces.values()){
   const points=s.parts.flat(2),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),margin=1;
   for(let x=Math.floor((Math.min(...xs)-margin)/20);x<=Math.floor((Math.max(...xs)+margin)/20);x++)
    for(let y=Math.floor((Math.min(...ys)-margin)/20);y<=Math.floor((Math.max(...ys)+margin)/20);y++){
     const k=`${x},${y}`;if(!this.grid.has(k))this.grid.set(k,[]);this.grid.get(k).push(s);
    }
  }
 }
 nearby(x,y){return this.grid.get(`${Math.floor(x/20)},${Math.floor(y/20)}`)||[];}
 inside(s,x,y){
  if(s.blocked_parts?.some(p=>containsPart([x,y],p)))return false;
  if((s.structural_owner&&this.surfaces.get(s.structural_owner)?.structure_parts?.some(p=>containsPart([x,y],p)))||s.parts.some(p=>containsPart([x,y],p))||projectLine(s.points,x,y).distance<1e-6)return true;
  // Planck edge contacts permit centimetre-scale penetration before resolving.
  // Keep contact support within that tolerance while the barrier stops the body.
  if(s.kind==='deck'||s.kind==='approach')for(const part of s.parts)for(const ring of part)
   for(let i=1;i<ring.length;i++)if(projectLine([ring[i-1],ring[i]],x,y).distance<=.06)return true;
  return false;
 }
 ground(x,y){
  const z=terrainHeight(this.terrain,x,y),e=.5;
  return {id:'terrain',kind:'terrain',z,gx:(terrainHeight(this.terrain,x+e,y)-terrainHeight(this.terrain,x-e,y))/(2*e),
   gy:(terrainHeight(this.terrain,x,y+e)-terrainHeight(this.terrain,x,y-e))/(2*e),supported:true};
 }
 contact(s,x,y){return {id:s.id,kind:s.kind,...(s.kind==='ground'?this.ground(x,y):profileAt(s,x,y)),id:s.id,kind:s.kind,supported:true,surface:s};}
 connectedAt(a,b,x,y){
  for(const node of a.nodes){
   if(!b.nodes.includes(node))continue;
   const p=a.points[a.nodes[0]===node?0:a.points.length-1],q=b.points[b.nodes[0]===node?0:b.points.length-1];
   const radius=Math.max(4,a.width/2,b.width/2,a.junction_reach?.[node]||0,b.junction_reach?.[node]||0)+3;
   if(Math.hypot(x-p[0],y-p[1])>radius||Math.hypot(p[0]-q[0],p[1]-q[1])>.05)continue;
   // Continuity belongs at the shared endpoint. A rear wheel on a steep
   // approach can legitimately be higher than the centre already on the deck.
   if(Math.abs(profileAt(a,...p).z-profileAt(b,...q).z)<.18)return true;
  }
  return false;
 }
 joinSeam(a,b,x,y){
  for(const node of a.nodes){
   if(!b.nodes.includes(node))continue;
   const ai=a.nodes[0]===node?0:a.points.length-1,bi=b.nodes[0]===node?0:b.points.length-1;
   const p=a.points[ai],u=a.points[ai===0?1:ai-1],v=b.points[bi===0?1:bi-1];
   const adx=u[0]-p[0],ady=u[1]-p[1],bdx=v[0]-p[0],bdy=v[1]-p[1],dx=x-p[0],dy=y-p[1];
   const da=(dx*adx+dy*ady)/Math.max(1e-9,Math.hypot(adx,ady)),db=(dx*bdx+dy*bdy)/Math.max(1e-9,Math.hypot(bdx,bdy));
   // A small turn between two butt caps leaves a thin wedge. Close only that
   // endpoint seam, within both widths; lateral bridge edges remain unsupported.
   if(da>=-.25&&da<=.01&&db>=-.25&&db<=.01&&Math.hypot(dx,dy)<=Math.min(a.width,b.width)/2+.02)return true;
  }
  return false;
 }
 resolve(x,y,id='terrain'){
  const current=this.surfaces.get(id);
  if(current&&this.inside(current,x,y))return this.contact(current,x,y);
  if(current){
   const candidates=[],pending=[current],seen=new Set([current.id]);
   while(pending.length){const a=pending.shift();for(const cid of a.connections){
    const b=this.surfaces.get(cid);if(!b||seen.has(cid)||!this.connectedAt(a,b,x,y))continue;seen.add(cid);pending.push(b);candidates.push(b);
   }}
   for(const candidate of candidates){
    if(candidate){
     if(this.inside(candidate,x,y))return this.contact(candidate,x,y);
     if(this.joinSeam(current,candidate,x,y))return {id:candidate.id,kind:candidate.kind,...profileAt(candidate,x,y),supported:true,surface:candidate,joinSeam:true};
    }
   }
   // Source ribbons have butt caps; turns at connected bridge ends can leave
   // wedges that the mapped ground carriageway fills. Permit only that shared
   // endpoint portal, never an unrelated road at an XY crossing.
   const onGroundRoad=this.scene.roads.some(p=>containsPart([x,y],p))&&!this.scene.water?.some(p=>containsPart([x,y],p));
   if(onGroundRoad)for(const cid of current.connections){
    const other=this.surfaces.get(cid);if(!other)continue;
    const shared=current.nodes.filter(n=>other.nodes.includes(n));
    for(const n of shared){
     const end=current.points[current.nodes[0]===n?0:current.points.length-1];
     if(Math.hypot(x-end[0],y-end[1])>Math.max(current.width,other.width)/2+.3)continue;
     if(Math.abs(profileAt(current,x,y).z-this.ground(x,y).z)>.25)continue;
     if(current.kind==='ground')return this.contact(current,x,y);
     if(other.kind==='ground')return this.contact(other,x,y);
    }
   }
   if(current.kind==='deck')return {id,z:profileAt(current,x,y).z,supported:false};
   if(current.kind==='approach'&&Math.abs(profileAt(current,x,y).z-this.ground(x,y).z)>.18)return {id,supported:false};
  }
  // Ground can enter a mapped approach only at its ground end. It never picks
  // the nearest elevated deck at a grade-separated crossing.
  const ground=this.ground(x,y);
  for(const s of this.nearby(x,y)){
   if(s.kind==='deck'||!this.inside(s,x,y))continue;
   if(s.kind==='approach'&&Math.abs(profileAt(s,x,y).z-ground.z)>.12)continue;
   if(s.kind==='approach'){
    const end=s.points.at(-1);if(Math.hypot(x-end[0],y-end[1])>3&&current?.kind!=='approach')continue;
   }
   return this.contact(s,x,y);
  }
  if(this.scene.water?.some(p=>containsPart([x,y],p)))return {id:'terrain',z:ground.z,supported:false};
  return ground;
 }
 sample(car,units=10){
  const x=car.x/units,y=car.y/units,c=this.resolve(x,y,car.surfaceId);
  if(c.supported){car.surfaceId=c.id;car.z=c.z;car.grade=Math.hypot(c.gx,c.gy);}
  return c;
 }
 supportFootprint(car,units=10){
  const x=car.x/units,y=car.y/units,cs=Math.cos(car.angle),sn=Math.sin(car.angle),l=(car.colliderLength||car.length)/units/2,w=(car.colliderWidth||car.width)/units/2;
  const centre=this.resolve(x,y,car.surfaceId);if(!centre.supported)return false;
  if(car.colliderPolygons&&car._supportPolygons!==car.colliderPolygons){car._supportPolygons=car.colliderPolygons;car._supportVertices=[...new Map(car.colliderPolygons.flat().map(p=>[p.x+','+p.y,[p.x/units,p.y/units]])).values()];}
  const footprint=car._supportVertices||[[l,-w],[l,w],[-l,w],[-l,-w]];
  for(const [a,b]of footprint){
   const q=this.resolve(x+a*cs-b*sn,y+a*sn+b*cs,centre.id);
   // Supporting surfaces and shared-endpoint continuity establish support.
   // A fixed height difference across a long vehicle incorrectly rejects
   // continuous hills/camber; this surface-constrained model has no suspension.
   if(!q.supported)return false;
  }
  return true;
 }
 applyGrade(car,units=10){
  const body=car.physics?.planckBody;if(!body)return;
  const c=this.sample(car,units);if(!c.supported)return;
  const scale=units/30,denom=1+c.gx*c.gx+c.gy*c.gy;
  if(Math.hypot(c.gx,c.gy)>1e-7)body.applyForce(window.planck.Vec2(-9.80665*c.gx/denom*scale*body.getMass(),-9.80665*c.gy/denom*scale*body.getMass()),body.getWorldCenter(),true);
 }
 afterStep(car,before,units=10){
  const dx=(car.x-before.x)/units,dy=(car.y-before.y)/units,n=Math.max(1,Math.ceil(Math.hypot(dx,dy)/.5));let id=before.surfaceId;
  let ok=true;
  for(let i=1;i<=n;i++){
   const c=this.resolve(before.x/units+dx*i/n,before.y/units+dy*i/n,id);
   if(!c.supported){ok=false;break;}id=c.id;
  }
  car.surfaceId=id;this.sample(car,units);
  if(ok&&this.supportFootprint(car,units)){
   car.safePose={x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z};return true;
  }
  const safe=car.safePose||before;Object.assign(car,safe,{vx:0,vy:0,speed:0});
  const body=car.physics.planckBody;body.setTransform(window.planck.Vec2(car.x/30,car.y/30),car.angle);
  body.setLinearVelocity(window.planck.Vec2(0,0));body.setAngularVelocity(0);
  car.physics.vx=car.physics.vy=car.physics.r=0;this.recoveries++;return false;
 }
}
