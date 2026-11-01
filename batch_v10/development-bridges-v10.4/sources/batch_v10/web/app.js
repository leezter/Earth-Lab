import {profiles,sampleContact} from './driving.js';
import {clearSpawn} from './spawn.js';
import {containsPart,siteGroundAt} from './ground.js';
import {SignalLayer} from './signals.js';
import {DistrictRenderer} from './baked.js';
import {ElevationSystem,profileAt,projectLine,vehicleHeights} from './elevation.js';
import {installCollision,obstacleInterval,verticalOverlap} from './bridge-collision.js';
import './rv/physics.js';

const $=id=>document.getElementById(id),P=window.RacerPhysics,C=$('world'),ctx=C.getContext('2d'),U=10;
const rad=Math.PI/180,R=6378137,sites=window.EARTH_BATCH_SITES;
let car=null,scene=null,elevation=null,district=null,signals=null,collisions=null,origin=null;
let paused=false,loading=false,epoch=0,aborter=null,previous=null,acc=0,last=performance.now(),clock=last,frames=0,fps=0;
let surface={onRoad:false,surfaceType:'gravel-rally'},keys=new Set(),zoom=9,autoPaused=false;
const sprites={};
for(const [k,p]of Object.entries(profiles)){
 const im=new Image();im.src='rv/assets/vehicles/'+p.asset;sprites[k]=im;
 im.onload=()=>{
  const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
  const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0);const data=g.getImageData(0,0,c.width,c.height).data;
  let x0=c.width,y0=c.height,x1=0,y1=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]>80){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  im.crop=[x0,y0,x1-x0+1,y1-y0+1];
 };
}
const status=t=>$('status').textContent=t;
const route=document.createElement('select');route.id='start-route';route.setAttribute('aria-label','Start on bridge or road below');route.hidden=true;
$('vehicle').after(route);
function routeOptions(){
 route.replaceChildren();const seen=new Set();
 for(const record of scene.bridge_report.records){
  for(const [id,label]of [[record.id,'Bridge'],...(record.crossings||[]).map(c=>[c.surface_id,'Road below'])]){
   if(seen.has(id))continue;seen.add(id);const s=elevation.surfaces.get(id);if(!s)continue;
   const p=projectLine(s.points,0,0);if(Math.abs(p.x)>80||Math.abs(p.y)>80)continue;
   const o=document.createElement('option');o.value=id;o.textContent=label+' · '+s.name;route.append(o);
  }
 }
 route.hidden=route.options.length<2;
 if([...route.options].some(o=>o.value===car?.surfaceId))route.value=car.surfaceId;
}
route.onchange=()=>{const s=elevation.surfaces.get(route.value),p=projectLine(s.points,0,0);try{spawn([p.x,p.y],s.id);}catch(e){status(e.message);}};
function material(s){return /gravel|compacted/.test(s)?'gravel':/earth|dirt|sand|grass/.test(s)?'dirt':/concrete|sett|cobble|paving/.test(s)?'concrete':'asphalt';}
function nearest(x,y){
 let best=null;for(const s of elevation?.nearby(x,y)||[]){const p=projectLine(s.points,x,y);if(!best||p.distance<best.d)best={...p,d:p.distance,road:s};}return best;
}
function spawn(at=null,requestedSurface=null){
 if(!elevation)return;
 const kind=$('vehicle').value,profile=profiles[kind],x=at?at[0]:car?car.x/U:scene.spawn?.x||0,y=at?at[1]:car?car.y/U:scene.spawn?.y||0;
 const wanted=requestedSurface||(at?null:car?.surfaceId)||scene.spawn?.surface_id;
 const current=elevation.surfaces.get(wanted),all=[...elevation.surfaces.values()];
 const groups=current?[[current],all.filter(s=>current.connections.includes(s.id))]:[all.filter(s=>s.kind!=='deck'),all.filter(s=>s.kind==='deck')];
 let n=null;
 for(const group of groups){
  const roads=group.map(s=>({drive:true,width:s.width,lines:[s.points],surfaceId:s.id}));
  const solids=[];
  for(const b of scene.buildings||[]){
   const p=b.parts[0][0][0],base=elevation.ground(...p).z;
   const target=current?profileAt(current,x,y).z:elevation.ground(x,y).z;
   if(verticalOverlap(target,target+vehicleHeights[kind],base-.3,base+Math.min(26,Math.max(5,b.height))))solids.push(b);
  }
  for(const part of scene.boundary_solids||[]){
   const target=current?profileAt(current,x,y).z:elevation.ground(x,y).z,base=elevation.ground(...part[0][0]).z;
   if(verticalOverlap(target,target+vehicleHeights[kind],base-.3,base+3.5))solids.push({parts:[part]});
  }
  for(const obstacle of elevation.network.obstacles){
   if(!obstacle.parts)continue;
   const z=current?profileAt(current,x,y).z:elevation.ground(x,y).z,[lo,hi]=obstacleInterval(obstacle,x,y,elevation.terrain);
   if(verticalOverlap(z,z+vehicleHeights[kind],lo,hi))solids.push({parts:obstacle.parts});
  }
  const candidate=clearSpawn(roads,solids,x,y,profile.length/U,profile.width/U,candidate=>{
   const probe={...profile,x:candidate.x*U,y:candidate.y*U,angle:candidate.angle,surfaceId:candidate.road.surfaceId};
   return elevation.supportFootprint(probe,U);
  });
  if(!candidate)continue;
  const probe={...profile,x:candidate.x*U,y:candidate.y*U,angle:candidate.angle,surfaceId:candidate.road.surfaceId};
  if(elevation.supportFootprint(probe,U)){n=candidate;break;}
 }
 if(!n)throw Error('No safe car-sized spawn on this connected level. Select another area or vehicle.');
 car={kind,steeringMode:'touch',...profile,x:n.x*U,y:n.y*U,angle:n.angle,speed:0,vx:0,vy:0,surfaceId:n.road.surfaceId};
 window.RacingVibesVehicleColliders?.apply(car);P.initCar(car,kind);
 P.configureTrackCollision([],{ppm:30});P.configureDecorCollision([],[]);P.rebuildPlanckWorld({cars:[car]});
 collisions=installCollision(car,elevation,scene.buildings||[],(scene.boundary_solids||[]).map(part=>({parts:[part]})),U);
 elevation.sample(car,U);car.safePose={x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z};
 previous={...car.safePose};sample();acc=0;last=performance.now();
}
async function json(url,signal){const r=await fetch(url,{signal});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
async function open(lat,lon,label){
 aborter?.abort();aborter=new AbortController();const mine=++epoch;loading=true;keys.clear();status('Loading '+(label||'area')+'…');
 let next=null;
 try{
  const data=await json('/api/data?id='+encodeURIComponent($('presets').value),aborter.signal);
  if(mine!==epoch)return;
  next=new DistrictRenderer(data.scene);await next.ready;
  if(mine!==epoch){next.dispose();return;}
  const old={scene,elevation,district,signals,car,origin};
  scene=data.scene;elevation=new ElevationSystem(scene);signals=new SignalLayer(scene.traffic_hardware||[]);district=next;origin=scene.origin;car=null;
  try{spawn();}catch(e){scene=old.scene;elevation=old.elevation;district=old.district;signals=old.signals;car=old.car;origin=old.origin;next.dispose();throw e;}
  old.district?.dispose();loading=false;routeOptions();
  const count=scene.bridge_report.records.length;
  status(`${label||'Area'} · 192 m · ${count} fixed bridge${count===1?'':'s'} · ${scene.terrain.source.status==='available'?'relative terrain heights':'flat terrain fallback'}`);
  $('pavement-source').textContent='Mapped bridge topology; inferred deck heights, approaches and generic structures. Signal phases are illustrative.';
  $('credit').textContent='Map: Overture / OSM · Terrain: Mapterhorn / upstream providers · Materials: Poly Haven';
  history.replaceState(null,'','?site='+encodeURIComponent($('presets').value));
 }catch(e){
  if(mine!==epoch)return;next?.dispose();loading=false;
  status('Area unavailable: '+e.message+' — press Explore to retry.');
 }
}
function groundAt(x,y){
 const c=elevation.resolve(x,y,car.surfaceId),s=c.surface;
 const road=c.supported&&((s&&s.kind!=='ground')||scene.roads.some(p=>containsPart([x,y],p))),site=road?null:siteGroundAt(scene,x,y);
 const mat=material(s?.surface||site?.grip||'gravel');
 return {onRoad:!!road||!!site,surfaceType:{asphalt:'tarmac-pro',concrete:'concrete-oval',gravel:'gravel-rally',dirt:'dirt-oval'}[mat],
  label:s?`${s.kind==='deck'?'Bridge':s.kind==='approach'?'Approach':'Road'} · ${s.name}`:'Off road · terrain'};
}
function sample(hud=false){
 if(!car||!elevation)return;
 const contact=sampleContact(car,U,groundAt);surface={onRoad:contact.onRoad,surfaceType:contact.surfaceType};
 if(hud)$('surface').textContent=contact.label+` · ${car.z.toFixed(1)} m local · ${Math.round((car.grade||0)*100)}% grade`;
}
function drawCar(pose){
 ctx.save();ctx.translate(pose.x/U,pose.y/U);ctx.rotate(pose.angle+Math.PI/2);
 ctx.save();ctx.translate(.2,.4);ctx.fillStyle='#0b221d55';ctx.fillRect(-car.width/U/2,-car.length/U/2,car.width/U,car.length/U);ctx.restore();
 const im=sprites[car.kind];if(im.complete&&im.naturalWidth)ctx.drawImage(im,...(im.crop||[0,0,im.naturalWidth,im.naturalHeight]),-car.width/U/2,-car.length/U/2,car.width/U,car.length/U);
 ctx.restore();
}
function render(now){
 requestAnimationFrame(render);const elapsed=Math.min(.1,(now-last)/1000);last=now;
 signals?.advance(elapsed,paused||loading);acc+=paused||loading?0:elapsed;let steps=0;
 while(car&&!paused&&!loading&&acc>=1/60&&steps++<4){
  previous={x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z};
  const input={throttle:keys.has('KeyW')||keys.has('ArrowUp')?1:0,brake:keys.has('KeyS')||keys.has('ArrowDown')||keys.has('Space')?1:0,
   steer:(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)};
  elevation.sample(car,U);sample();P.planckBeginStep(1/75,[car]);P.updateCar(car,input,surface,1/75);elevation.applyGrade(car,U);P.planckStep();
  if(!elevation.afterStep(car,previous,U)){previous={...car.safePose};status('Unsupported edge — returned to the last safe position on this level.');}
  acc-=1/60;
 }
 if(steps>=4)acc=0;
 if(car&&(Math.abs(car.x/U)>85||Math.abs(car.y/U)>85)){
  try{spawn([Math.max(-78,Math.min(78,car.x/U)),Math.max(-78,Math.min(78,car.y/U))],car.surfaceId);status('Scene edge — returned to a safe position on this connected road.');}catch(e){status(e.message);if(!paused)togglePause();}
 }
 const dpr=Math.min(devicePixelRatio,2);
 if(C.width!==Math.round(innerWidth*dpr)||C.height!==Math.round(innerHeight*dpr)){C.width=Math.round(innerWidth*dpr);C.height=Math.round(innerHeight*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#23333b';ctx.fillRect(0,0,innerWidth,innerHeight);
 const alpha=Math.min(1,acc*60),pose=car&&previous?{x:previous.x+(car.x-previous.x)*alpha,y:previous.y+(car.y-previous.y)*alpha,
  angle:previous.angle+Math.atan2(Math.sin(car.angle-previous.angle),Math.cos(car.angle-previous.angle))*alpha}:car;
 zoom=Math.max(+$('zoom').value,innerWidth/180,innerHeight/180);
 let cx=pose?pose.x/U:0,cy=pose?pose.y/U:0;
 cx=Math.max(-96+innerWidth/zoom/2,Math.min(96-innerWidth/zoom/2,cx));cy=Math.max(-96+innerHeight/zoom/2,Math.min(96-innerHeight/zoom/2,cy));
 ctx.translate(innerWidth/2,innerHeight/2);ctx.scale(zoom,zoom);ctx.translate(-cx,-cy);
 district?.draw(ctx);if($('signals').checked)signals?.draw(ctx);
 if(pose){district.drawDecks(ctx,car,false);drawCar(pose);district.drawDecks(ctx,car,true);district.drawRails(ctx,car);}
 frames++;
 if(now-clock>500){
  fps=frames*1000/(now-clock);frames=0;clock=now;
  if(car){
   sample(true);const c=elevation.resolve(car.x/U,car.y/U,car.surfaceId),vz=(car.vx||0)*(c.gx||0)+(car.vy||0)*(c.gy||0);
   $('speed').textContent=Math.round(Math.hypot(car.vx||0,car.vy||0,vz)/U*3.6);
   $('position').textContent=`${(origin[0]-car.y/U/R/rad).toFixed(5)}, ${(origin[1]+car.x/U/(R*Math.cos(origin[0]*rad))/rad).toFixed(5)}`;
   $('perf').textContent=`${Math.round(fps)} fps · 9 tiles + ${district.patches.size} bridge passes · ${paused?'paused':'free drive'}`;
  }
 }
}
function togglePause(){paused=!paused;$('pause').textContent=paused?'Resume':'Pause';keys.clear();acc=0;previous=car?{x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z}:null;}
function recover(){try{spawn();}catch(e){status(e.message);}}
addEventListener('keydown',e=>{
 if(['INPUT','SELECT','BUTTON','TEXTAREA'].includes(e.target.tagName)||e.target.closest?.('.leaflet-container'))return;
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);
 if(!e.repeat&&e.code==='KeyR')recover();if(!e.repeat&&e.code==='KeyP')togglePause();
});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());
document.addEventListener('visibilitychange',()=>{keys.clear();if(document.hidden&&!paused){togglePause();autoPaused=true;}else if(!document.hidden&&autoPaused){togglePause();autoPaused=false;}last=performance.now();acc=0;});
for(const b of document.querySelectorAll('[data-key]')){b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);};b.onpointerup=b.onpointercancel=()=>keys.delete(b.dataset.key);}
$('pause').onclick=togglePause;$('recover').onclick=recover;$('vehicle').onchange=recover;
$('visit').onclick=()=>{const s=sites.find(s=>s.id===$('presets').value);if(s)open(s.actual_lat,s.actual_lon,s.name);};
function addOption(s){let o=[...$('presets').options].find(o=>o.value===s.id);if(!o){o=document.createElement('option');o.value=s.id;$('presets').append(o);}o.textContent=s.name+(s.status==='built'?'':' — '+s.status);o.disabled=s.status!=='built';}
$('presets').replaceChildren();sites.forEach(addOption);
window.earthLab={get car(){return car;},get elevation(){return elevation;},get scene(){return scene;},get district(){return district;},spawn,nearest,open,
 async addSite(s){const old=sites.findIndex(d=>d.id===s.id);if(old<0)sites.push(s);else sites[old]=s;addOption(s);$('presets').value=s.id;await open(s.actual_lat,s.actual_lon,s.name);},
 get boundarySolids(){return scene?.boundary_solids||[];},
 get state(){return {loading,paused,fps,epoch,surface,rendererFreeze:scene?.renderer_freeze,renderedTiles:district?.cache.size||0,
  bridgePatches:district?.patches.size||0,decodedBytes:district?.decodedBytes||0,bridgeCount:scene?.bridge_report.records.length||0,
  collisionFixtures:collisions?.fixtures||0,recoveries:elevation?.recoveries||0,activeSurface:car?.surfaceId,height:car?.z,grade:car?.grade,origin};}};
const preferred=new URLSearchParams(location.search).get('site'),first=sites.find(s=>s.id===preferred&&s.status==='built')||sites.find(s=>!s.fixture&&s.status==='built'&&s.bridge_count>0)||sites.find(s=>s.status==='built');
requestAnimationFrame(render);if(first){$('presets').value=first.id;$('visit').click();}else status('Search or select a map location to generate a bridge-aware scene.');
