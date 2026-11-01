import {terrainHeight,profileAt,vehicleHeights,projectLine} from './elevation.js';

export function verticalOverlap(a0,a1,b0,b1){return a1>b0+.01&&b1>a0+.01;}
export function obstacleInterval(obstacle,x,y,terrain){
 if(obstacle.kind==='rail'){
  const p=projectLine([obstacle.a,obstacle.b],x,y),length=Math.hypot(obstacle.b[0]-obstacle.a[0],obstacle.b[1]-obstacle.a[1]);
  const t=p.station/Math.max(length,1e-9),base=obstacle.za+(obstacle.zb-obstacle.za)*t;return [base-.05,base+obstacle.height];
 }
 if(obstacle.kind==='ground'){
  const z=terrainHeight(terrain,x,y);return [z-.3,z+obstacle.height];
 }
 return [obstacle.zmin,obstacle.zmax];
}
export function installCollision(car,elevation,buildings,boundarySolids,units=10){
 const pl=window.planck,world=car.physics.planckBody.getWorld(),body=world.createBody({type:'static'});
 const obstacles=[...elevation.network.obstacles];
 for(const b of buildings)obstacles.push({kind:'ground',parts:b.parts,height:Math.min(26,Math.max(5,b.height||12))});
 for(const b of boundarySolids)obstacles.push({kind:'ground',parts:b.parts,height:b.height||3.5});
 let count=0;
 const edge=(a,b,obstacle)=>{
  if(Math.min(a[0],b[0])>102||Math.max(a[0],b[0])< -102||Math.min(a[1],b[1])>102||Math.max(a[1],b[1])< -102)return;
  if(Math.hypot(a[0]-b[0],a[1]-b[1])<.001)return;
  const fixture=body.createFixture(pl.Edge(pl.Vec2(a[0]*units/30,a[1]*units/30),pl.Vec2(b[0]*units/30,b[1]*units/30)),{friction:.5,restitution:.12});
  fixture.setUserData({earthObstacle:obstacle});count++;
 };
 for(const obstacle of obstacles){
  if(obstacle.kind==='rail')edge(obstacle.a,obstacle.b,obstacle);
  else for(const part of obstacle.parts||[])for(const ring of part)for(let i=1;i<ring.length;i++)edge(ring[i-1],ring[i],obstacle);
 }
 world.on('pre-solve',contact=>{
  const a=contact.getFixtureA(),b=contact.getFixtureB(),obstacle=a.getUserData()?.earthObstacle||b.getUserData()?.earthObstacle;
  if(!obstacle)return;
  const vehicleBody=a.getUserData()?.earthObstacle?b.getBody():a.getBody();
  if(vehicleBody!==car.physics.planckBody)return;
  const pos=vehicleBody.getPosition(),x=pos.x*30/units,y=pos.y*30/units;
  const support=elevation.resolve(x,y,car.surfaceId);const z=Number.isFinite(support.z)?support.z:car.z;
  const [lo,hi]=obstacleInterval(obstacle,x,y,elevation.terrain);
  if(!verticalOverlap(z,z+vehicleHeights[car.kind],lo,hi))contact.setEnabled(false);
 });
 car.physics.planckBody.setBullet(true);
 return {fixtures:count,body};
}
