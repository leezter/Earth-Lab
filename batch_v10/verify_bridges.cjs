// Fresh Edge driving, height collisions, rendering/lifecycle and flat handling.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),cp=require('child_process');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47852',root=__dirname;
async function main(){
 const identity=JSON.parse(fs.readFileSync(path.join(root,'freeze.json'),'utf8')).id;
 const sites=(await(await fetch(url+'/api/sites')).json()).filter(s=>s.renderer_freeze===identity),over=sites.find(s=>s.fixture==='overpass'&&s.status==='built');
 assert(over,'A completed synthetic overpass build is required');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results={started_utc:new Date().toISOString(),renderer:over.renderer_freeze,synthetic:[],mapped:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>results.errors.push(e.message));
  await page.addInitScript(()=>{
   window.testNow=1000;performance.now=()=>testNow;let id=0;const callbacks=new Map();
   requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};cancelAnimationFrame=id=>callbacks.delete(id);
   window.testFrame=now=>{const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback(now);};
  });
  await page.goto(url+'/?site='+over.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
  const synthetic=await page.evaluate(()=>{
   const results=[],key=(code,on)=>dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
   const frame=()=>{testNow+=1000/60+1e-7;testFrame(testNow);};
   const orient=angle=>{const c=earthLab.car;c.angle=angle;c.physics.planckBody.setTransform(planck.Vec2(c.x/30,c.y/30),angle);};
   const speed=(vx,vy)=>{const c=earthLab.car;c.physics.planckBody.setLinearVelocity(planck.Vec2(vx*10/30,vy*10/30));c.vx=c.physics.vx=vx*10;c.vy=c.physics.vy=vy*10;};
   for(const kind of ['GT','F1','Bubble','Truck']){
    document.querySelector('#vehicle').value=kind;
    for(const direction of [-1,1]){
     earthLab.spawn([-direction*65,0],direction>0?'approach-a':'approach-b');orient(direction>0?0:Math.PI);
     const body=earthLab.car.physics.planckBody;let replaced=0,maxHeight=0,visited=new Set(),count=0;
     key('KeyW',true);
     while(direction*earthLab.car.x/10<60&&count++<1800){frame();visited.add(earthLab.car.surfaceId);maxHeight=Math.max(maxHeight,earthLab.car.z);if(earthLab.car.physics.planckBody!==body)replaced++;}
     key('KeyW',false);
     results.push({kind,direction,route:'upper',frames:count,replaced,maxHeight,visited:[...visited],x:earthLab.car.x/10,recoveries:earthLab.state.recoveries});
    }
    for(const direction of [-1,1]){
     earthLab.spawn([0,-direction*55],'lower');orient(direction>0?Math.PI/2:-Math.PI/2);
     const body=earthLab.car.physics.planckBody;let count=0,min=Infinity,max=-Infinity,replaced=0;
     key('KeyW',true);
     while(direction*earthLab.car.y/10<50&&count++<1200){frame();min=Math.min(min,earthLab.car.z);max=Math.max(max,earthLab.car.z);if(earthLab.car.physics.planckBody!==body)replaced++;}
     key('KeyW',false);results.push({kind,direction,route:'lower',frames:count,min,max,replaced,y:earthLab.car.y/10,surface:earthLab.car.surfaceId});
    }
    // A ground-level abutment blocks lower traffic at its real height.
    earthLab.spawn([-28,-15],'lower'); // constrained spawn starts on lower road
    const c=earthLab.car;c.x=-120;c.y=-150;c.angle=Math.PI/2;c.surfaceId='terrain';
    c.physics.planckBody.setTransform(planck.Vec2(c.x/30,c.y/30),c.angle);speed(0,10);
    let hit=0;c.physics.planckBody.getWorld().on('post-solve',(contact,impulse)=>{if(impulse.normalImpulses.some(x=>x>.001))hit++;});
    key('KeyW',true);for(let i=0;i<400&&hit===0;i++)frame();key('KeyW',false);
    results.push({kind,route:'support-collision',hit,y:earthLab.car.y/10});
    // Lateral deck rail collision keeps the car on the bridge.
    earthLab.spawn([0,0],'bridge-fixture');orient(Math.PI/2);speed(0,8);
    let railHits=0;earthLab.car.physics.planckBody.getWorld().on('post-solve',(contact,impulse)=>{if(impulse.normalImpulses.some(x=>x>.001))railHits++;});
    key('KeyW',true);for(let i=0;i<300&&railHits===0;i++)frame();key('KeyW',false);
    results.push({kind,route:'rail-collision',hit:railHits,y:earthLab.car.y/10,surface:earthLab.car.surfaceId});
    earthLab.spawn([-17,0],'bridge-fixture');const upperCar=earthLab.car;
    upperCar.y=30;upperCar.angle=0;upperCar.physics.planckBody.setTransform(planck.Vec2(upperCar.x/30,1),0);
    upperCar.safePose={x:upperCar.x,y:30,angle:0,surfaceId:upperCar.surfaceId,z:upperCar.z};
    let upperHits=0;upperCar.physics.planckBody.getWorld().on('post-solve',(contact,impulse)=>{if(impulse.normalImpulses.some(x=>x>.001))upperHits++;});
    key('KeyW',true);let upperFrames=0;while(upperCar.x/10< -7&&upperFrames++<300)frame();key('KeyW',false);
    results.push({kind,route:'above-support',hit:upperHits,x:upperCar.x/10,surface:upperCar.surfaceId});
    earthLab.spawn([0,0],'bridge-fixture');const z=earthLab.car.z;document.querySelector('#recover').click();
    results.push({kind,route:'recovery',height:earthLab.car.z,surface:earthLab.car.surfaceId,originalHeight:z});
    document.querySelector('#pause').click();const x=earthLab.car.x,y=earthLab.car.y;for(let i=0;i<60;i++)frame();
    results.push({kind,route:'pause',unchanged:earthLab.car.x===x&&earthLab.car.y===y,paused:earthLab.state.paused});document.querySelector('#pause').click();
   }
   return results;
  });
  fs.mkdirSync(path.join(root,'cache'),{recursive:true});fs.writeFileSync(path.join(root,'cache/last-browser-probe.json'),JSON.stringify(synthetic,null,2));
  for(const r of synthetic){
   if(r.route==='upper'){assert(r.frames<1800,JSON.stringify(r));assert.equal(r.replaced,0);assert(r.maxHeight>5);assert(r.visited.includes('bridge-fixture'));assert(r.direction*r.x>=60);}
   if(r.route==='lower'){assert(r.frames<1200,JSON.stringify(r));assert.equal(r.replaced,0);assert.equal(r.min,0);assert.equal(r.max,0);assert.equal(r.surface,'lower');}
   if(r.route.endsWith('collision'))assert(r.hit>0,JSON.stringify(r));
   if(r.route==='above-support'){assert.equal(r.hit,0,JSON.stringify(r));assert(r.x>=-7);assert.equal(r.surface,'bridge-fixture');}
   if(r.route==='rail-collision')assert.equal(r.surface,'bridge-fixture');
   if(r.route==='recovery'){assert.equal(r.surface,'bridge-fixture');assert.equal(r.height,r.originalHeight);}
   if(r.route==='pause')assert(r.unchanged&&r.paused);
  }
  results.synthetic=synthetic;
  results.occlusion=await page.evaluate(()=>{
   const capture=(kind,surface)=>{
    document.querySelector('#vehicle').value=kind;earthLab.spawn([0,0],surface);testNow+=17;testFrame(testNow);
    const canvas=document.querySelector('#world');return canvas.getContext('2d').getImageData(canvas.width/2-18,canvas.height/2-18,36,36).data;
   };
   const lowerA=capture('GT','lower'),lowerB=capture('Bubble','lower'),upperA=capture('GT','bridge-fixture'),upperB=capture('Bubble','bridge-fixture');
   return {lowerDifferentBytes:lowerA.reduce((n,v,i)=>n+(v!==lowerB[i]),0),upperDifferentBytes:upperA.reduce((n,v,i)=>n+(v!==upperB[i]),0)};
  });
  assert.equal(results.occlusion.lowerDifferentBytes,0,'A car below the deck must be fully occluded');
  assert(results.occlusion.upperDifferentBytes>0,'The car on the deck must remain visible');
  await page.evaluate(()=>{document.querySelector('#vehicle').value='GT';earthLab.spawn([0,0],'bridge-fixture');testNow+=17;testFrame(testNow);});
  fs.mkdirSync(path.join(root,'web/reviews'),{recursive:true});await page.screenshot({path:path.join(root,'web/reviews/overpass-upper.png')});
  await page.evaluate(()=>{earthLab.spawn([0,0],'lower');testNow+=17;testFrame(testNow);});await page.screenshot({path:path.join(root,'web/reviews/overpass-lower.png')});
  results.overpassState=await page.evaluate(()=>earthLab.state);
  const flatSite=sites.find(s=>s.fixture==='flat'&&s.status==='built'),hillSite=sites.find(s=>s.fixture==='hills'&&s.status==='built');
  if(flatSite&&hillSite){
   results.slopes=[];
   for(const kind of ['GT','F1','Bubble','Truck']){
    const measurements={kind};
    for(const [name,site,direction]of [['flat',flatSite,1],['uphill',hillSite,1],['downhill',hillSite,-1]]){
     await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
     measurements[name]=await page.evaluate(({kind,direction})=>{
      document.querySelector('#vehicle').value=kind;earthLab.spawn([direction>0?-30:30,0],'hill-road');
      const c=earthLab.car;c.angle=direction>0?0:Math.PI;c.physics.planckBody.setTransform(planck.Vec2(c.x/30,c.y/30),c.angle);
      const x=c.x;dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));
      for(let i=0;i<90;i++){testNow+=1000/60+1e-7;testFrame(testNow);}
      dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));
      return {distance:Math.abs(c.x-x)/10,speed:Math.hypot(c.vx,c.vy)/10,grade:c.grade};
     },{kind,direction});
    }
    assert(measurements.uphill.distance<measurements.flat.distance,JSON.stringify(measurements));
    assert(measurements.downhill.distance>measurements.flat.distance,JSON.stringify(measurements));results.slopes.push(measurements);
   }
   // Compare the unmodified copied vehicle engine in a separate browser realm.
   const files=['physics.js','gearbox.js','src/gearbox.js','physics/planckWorld.js','physics/trackSurface.js','trackCollision.js','weather_conditions.js','assets/vehicles/vehicle_colliders.js'];
   await page.route('**/reference/**',r=>{
    const file=new URL(r.request().url()).pathname.slice('/reference/'.length);
    if(file==='index.html')return r.fulfill({contentType:'text/html',body:'<script>window.RACING_VIBES_BUILD={devToolsEnabled:false};window.planck=parent.planck;</script><script src="assets/vehicles/vehicle_colliders.js"></script><script type="module" src="physics.js"></script>'});
    assert(files.includes(file));return r.fulfill({body:fs.readFileSync(path.join(root,'../web/rv',file)),contentType:'text/javascript'});
   });
   await page.goto(url+'/?site='+flatSite.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
   await page.evaluate(()=>{const f=document.createElement('iframe');f.id='reference';f.src='/reference/index.html';document.body.append(f);});
   const frame=page.frame({url:url+'/reference/index.html'})||await page.waitForEvent('framenavigated');await frame.waitForFunction(()=>window.RacerPhysics,{},{polling:50});
   results.flatBaseline=await page.evaluate(async()=>{
    const {profiles}=await import('./driving.js'),P=RacerPhysics,w=document.querySelector('#reference').contentWindow,Q=w.RacerPhysics;
    const update=P.updateCar,step=P.planckStep;let target,maximum=0,replaced=0,body,checks=0;
    P.updateCar=(c,input,surface,dt)=>{Q.planckBeginStep(dt,[target]);Q.updateCar(target,input,{onRoad:true,surfaceType:'tarmac-pro'},dt);return update(c,input,surface,dt);};
    P.planckStep=()=>{step();Q.planckStep();for(const k of ['x','y','angle','vx','vy'])maximum=Math.max(maximum,Math.abs(earthLab.car[k]-target[k]));if(earthLab.car.physics.planckBody!==body)replaced++;checks++;};
    const results=[],key=(code,on)=>dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
    const advance=n=>{for(let i=0;i<n;i++){testNow+=1000/60+1e-7;testFrame(testNow);}};
    for(const kind of Object.keys(profiles)){
     document.querySelector('#vehicle').value=kind;earthLab.spawn([-60,0],'hill-road');
     const c=earthLab.car;target={kind,steeringMode:'touch',...profiles[kind],x:c.x,y:c.y,angle:c.angle,vx:0,vy:0,speed:0};
     w.RacingVibesVehicleColliders.apply(target);Q.initCar(target,kind);Q.configureTrackCollision([],{ppm:30});Q.configureDecorCollision([],[]);Q.rebuildPlanckWorld({cars:[target]});
     maximum=0;replaced=0;checks=0;body=c.physics.planckBody;
     key('KeyW',true);advance(75);key('KeyW',false);key('KeyS',true);advance(180);key('KeyS',false);
     results.push({kind,checks,maxError:maximum,bodyReplacements:replaced});
    }
    P.updateCar=update;P.planckStep=step;return results;
   });
   for(const r of results.flatBaseline){assert(r.maxError<1e-8,JSON.stringify(r));assert.equal(r.bodyReplacements,0);}
  }
  // Fresh real-time browser interactions (no test clock) on every completed site.
  const real=await browser.newPage({viewport:{width:1440,height:1000}});real.on('pageerror',e=>results.errors.push(e.message));
  for(const site of sites.filter(s=>s.status==='built')){
   await real.goto(url+'/?site='+site.id);await real.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
   const start=await real.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,z:earthLab.car.z,state:earthLab.state}));
   await real.locator('#world').click({position:{x:1100,y:600}});await real.keyboard.down('ArrowUp');await real.waitForTimeout(1200);await real.keyboard.up('ArrowUp');
   const driven=await real.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,z:earthLab.car.z}));
   assert(Math.hypot(driven.x-start.x,driven.y-start.y)>1,site.name+' ordinary keyboard drive');
   await real.locator('#pause').click();const p1=await real.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await real.waitForTimeout(250);const p2=await real.evaluate(()=>[earthLab.car.x,earthLab.car.y]);assert.deepEqual(p1,p2);
   await real.locator('#recover').click();await real.locator('#vehicle').selectOption('Truck');
   await real.reload();await real.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
   const state=await real.evaluate(()=>earthLab.state);assert.equal(state.renderedTiles,9);
   const image='site-'+site.id+'.png';await real.screenshot({path:path.join(root,'web/reviews',image)});
   results.mapped.push({id:site.id,name:site.name,synthetic:!!site.fixture,ordinaryDriveMetres:Math.hypot(driven.x-start.x,driven.y-start.y)/10,state,image});
  }
  // Failed patch loading must release staged images and permit a successful retry.
  let fail=true;await real.route('**/baked/**/bridge-*.webp',r=>fail?r.fulfill({status:404,body:'missing test patch'}):r.continue());
  await real.goto(url+'/?site='+over.id);await real.waitForFunction(()=>document.querySelector('#status').textContent.includes('Area unavailable'),{},{polling:50});
  fail=false;await real.locator('#visit').click();await real.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
  results.patchRetry=true;assert.equal(results.errors.length,0,results.errors.join('\n'));
  results.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
