const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
const url='http://127.0.0.1:47852',freeze=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id;
const all=await(await fetch(url+'/api/sites')).json();
const selected=all.filter(s=>s.status==='built'&&(process.env.EARTH_LAYERED_SITE?s.id===process.env.EARTH_LAYERED_SITE:s.renderer_freeze===freeze)&&(s.fixture==='junctions'||!s.fixture));assert(selected.length);
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const report={renderer:freeze,modelOverride:process.env.EARTH_LAYERED_MODEL||null,method:'Guided keyboard inputs after spawn; deterministic frame clock',sites:[]};
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(()=>{window.testNow=1000;performance.now=()=>testNow;let id=0;const callbacks=new Map();requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};cancelAnimationFrame=id=>callbacks.delete(id);window.testFrame=now=>{const batch=[...callbacks.values()];callbacks.clear();for(const cb of batch)cb(now);};});
if(process.env.EARTH_LAYERED_MODEL)await page.route('**/api/data?**',r=>r.fulfill({json:JSON.parse(fs.readFileSync(process.env.EARTH_LAYERED_MODEL))}));
for(const site of selected){
 await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,null,{polling:50});
 const result=await page.evaluate(async()=>{
 const {projectLine,profileAt}=await import('./elevation.js'),surfaces=[...earthLab.elevation.surfaces.values()];
 const len=pts=>pts.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
 const at=(pts,s)=>{for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(s<=d)return [a[0]+(b[0]-a[0])*s/d,a[1]+(b[1]-a[1])*s/d];s-=d;}return pts.at(-1);};
 const inView=p=>Math.max(...p.map(Math.abs))<78;
 const routes=[],excluded=[],junctions=earthLab.scene.bridge_report.junctions||{};
 for(const [node,ids]of Object.entries(junctions)){
  const gs=ids.map(id=>earthLab.elevation.surfaces.get(id)).filter(s=>s?.kind==='deck');if(gs.length<3)continue;
  for(const a of gs)for(const b of gs){if(a===b)continue;
   const ap=a.nodes[0]===node?a.points:[...a.points].reverse(),bp=b.nodes[0]===node?b.points:[...b.points].reverse();
   const before=at(ap,Math.min(24,len(ap)-2)),after=at(bp,Math.min(24,len(bp)-2));
   if(![before,ap[0],after].every(inView))continue;
   const points=[];for(let d=Math.min(24,len(ap)-2);d>0;d-=1)points.push(at(ap,d));points.push(ap[0]);for(let d=1;d<Math.min(24,len(bp)-2);d+=1)points.push(at(bp,d));points.push(after);
   if(points.some(p=>!earthLab.elevation.inside(a,...p)&&!earthLab.elevation.inside(b,...p))){excluded.push({node,from:a.id,to:b.id,reason:'Route intersects an omitted/blocked deck section'});continue;}
   routes.push({id:node+':'+a.id+'>'+b.id,points,start:a.id,end:b.id,kind:'junction'});
  }
 }
 // Individual visible deck paths include stacked crossings without transferring levels.
 for(const s of surfaces.filter(s=>s.kind==='deck')){
  const runs=[];let visible=[];
  for(let d=5;d<len(s.points)-4;d+=1){const p=at(s.points,d);
   if(inView(p)&&earthLab.elevation.inside(s,...p))visible.push(p);
   else{if(visible.length>=10)runs.push(visible);visible=[];}
  }
  if(visible.length>=10)runs.push(visible);
  for(const [index,points]of runs.entries())for(const direction of [1,-1])routes.push({id:s.id+':'+index+':'+direction,points:direction>0?points:[...points].reverse(),start:s.id,end:s.id,kind:'deck'});
 }
 const system=earthLab.elevation,after=system.afterStep.bind(system);
 system.afterStep=(car,before,units)=>{
  const c=system.resolve(car.x/units,car.y/units,car.surfaceId),cs=Math.cos(car.angle),sn=Math.sin(car.angle),l=car.colliderLength/units/2,w=car.colliderWidth/units/2;
  const details=[[l,-w],[l,w],[-l,w],[-l,-w]].map(([a,b])=>{const x=car.x/units+a*cs-b*sn,y=car.y/units+a*sn+b*cs,q=system.resolve(x,y,c.id);return {x,y,id:q.id,supported:q.supported};});
  const ok=after(car,before,units);if(!ok)window.contactFailure={centre:c.id,corners:details,angle:car.angle};return ok;
 };
 const results=[],keys=new Set(),key=(code,on)=>{if(keys.has(code)===on)return;if(on)keys.add(code);else keys.delete(code);dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));};
 for(const route of routes)for(const kind of ['GT','F1','Bubble','Truck']){
  for(const code of [...keys])key(code,false);
  const total=len(route.points),p=route.points[0],q=at(route.points,1);
  document.querySelector('#vehicle').value=kind;earthLab.spawn(p,route.start);
  const car=earthLab.car;car.angle=Math.atan2(q[1]-p[1],q[0]-p[0]);car.physics.planckBody.setTransform(planck.Vec2(car.x/30,car.y/30),car.angle);car.safePose={x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z};
  const body=car.physics.planckBody,recoveries=earthLab.state.recoveries,visited=new Set([car.surfaceId]);let progress=0,steps=0,replaced=false,stall=0,reverseTicks=0,manoeuvres=0,lastX=car.x/10,lastY=car.y/10,best=0,stagnation=0,driveSign=1,lastChange=0,wrongLevel=0,maxHeightStep=0,lastHeight=car.z;
  while(total-progress>.8&&steps++<12000){
   const station=projectLine(route.points,car.x/10,car.y/10).station,speed=Math.hypot(car.vx,car.vy)/10;
   const look=at(route.points,Math.min(total,station+(route.kind==='junction'?8+speed*.8:3+speed*.3)));const desired=Math.atan2(look[1]-car.y/10,look[0]-car.x/10),err=Math.atan2(Math.sin(desired-car.angle),Math.cos(desired-car.angle));
   const target=route.kind==='junction'?2:Math.abs(err)>.15?2:3.5;
   if(progress>best+.1){best=progress;stagnation=0;}else stagnation++;
   if(stagnation>300&&steps-lastChange>300){driveSign*=-1;manoeuvres++;lastChange=steps;stagnation=0;}
   const steerError=driveSign>0?err:Math.atan2(Math.sin(desired+Math.PI-car.angle),Math.cos(desired+Math.PI-car.angle));
   if(driveSign<0){key('KeyW',speed>target+1);key('KeyS',speed<target);key('KeyD',steerError<-.015);key('KeyA',steerError>.015);}
   else{key('KeyW',speed<target);key('KeyS',speed>target+1);key('KeyD',steerError>.015);key('KeyA',steerError<-.015);}
   testNow+=1000/60+1e-7;testFrame(testNow);progress=projectLine(route.points,car.x/10,car.y/10).station;visited.add(car.surfaceId);
   maxHeightStep=Math.max(maxHeightStep,Math.abs(car.z-lastHeight));lastHeight=car.z;
   const active=earthLab.elevation.surfaces.get(car.surfaceId);
   const permitted=[route.start,route.end].some(id=>{const expected=earthLab.elevation.surfaces.get(id);return id===car.surfaceId||(active&&earthLab.elevation.connectedAt(active,expected,car.x/10,car.y/10)&&earthLab.elevation.inside(expected,car.x/10,car.y/10)&&Math.abs(profileAt(expected,car.x/10,car.y/10).z-car.z)<.18);});
   if(!permitted)wrongLevel++;
   if(earthLab.car!==car||car.physics.planckBody!==body){replaced=true;break;}if(earthLab.state.recoveries>recoveries)break;
  }
  for(const code of [...keys])key(code,false);
  const expected=earthLab.elevation.surfaces.get(route.end),active=earthLab.elevation.surfaces.get(car.surfaceId);
  const equivalentEnd=active&&expected&&earthLab.elevation.connectedAt(active,expected,car.x/10,car.y/10)&&earthLab.elevation.inside(expected,car.x/10,car.y/10)&&Math.abs(profileAt(expected,car.x/10,car.y/10).z-car.z)<.18;
  results.push({id:route.id,equivalentEnd,kind,route:route.kind,reached:total-progress<=.8,wrongLevel,maxHeightStep,manoeuvres,steps,progress,total,replaced,recoveries:earthLab.state.recoveries-recoveries,visited:[...visited],end:car.surfaceId,expected:route.end,position:[car.x/10,car.y/10],height:car.z,angle:car.angle,failure:earthLab.state.recoveries>recoveries?window.contactFailure:null});
 }
 return {routes:results,excluded};
 });
 report.sites.push({id:site.id,name:site.name,geometryRenderer:site.renderer_freeze,...result});fs.writeFileSync(path.join(__dirname,'layered-route-verification.json'),JSON.stringify(report,null,2));
 if(site.fixture==='junctions')assert(result.routes.length);for(const r of result.routes){assert(r.reached,site.name+' '+JSON.stringify(r));assert(!r.replaced);assert.equal(r.recoveries,0);assert.equal(r.wrongLevel,0,JSON.stringify(r));assert(r.maxHeightStep<.25,JSON.stringify(r));assert(r.end===r.expected||r.equivalentEnd,JSON.stringify(r));}
 console.log(site.name,result.routes.length?result.routes.length+' layered route traversals passed':'No complete elevated corridor inside this crop');
}
report.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'layered-route-verification.json'),JSON.stringify(report,null,2));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
