// Deterministic browser regression against the separate, read-only RacingVibes
// checkout. Uses a straight-road fixture to isolate integration from map obstacles,
// followed by an ordinary keyboard drive on a real baked scene.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47851';
const reference=process.env.RACINGVIBES_REFERENCE||path.resolve(__dirname,'../../RacingVibes');
const referenceFiles=['physics.js','gearbox.js','src/gearbox.js','physics/planckWorld.js','physics/trackSurface.js','trackCollision.js','weather_conditions.js','vendor/planck/planck.min.js','assets/vehicles/vehicle_colliders.js'];
const expectedProfiles={GT:{width:24,length:45,colliderWidth:20,colliderLength:39},F1:{width:24,length:44,colliderWidth:18,colliderLength:42},Bubble:{width:16,length:40,colliderWidth:16,colliderLength:38},Truck:{width:29,length:60,colliderWidth:22,colliderLength:58}};
(async()=>{
 const {sampleContact}=await import(require('url').pathToFileURL(path.join(__dirname,'web/driving.js')).href);
 const probe={x:0,y:0,angle:0,length:45,width:24};
 const strip=(x,y)=>({onRoad:Math.abs(y)<=1,surfaceType:'tarmac-pro'});
 assert.equal(sampleContact(probe,10,strip).onRoad,false,'Centre alone must not count as road contact');
 assert.equal(sampleContact({...probe,width:16},10,strip).onRoad,true,'Four corners and centre on road');
 assert.equal(sampleContact({...probe,angle:Math.PI/2},10,strip).onRoad,false,'Contact follows rotated vehicle');
 assert.equal(sampleContact({...probe,y:30},10,strip).onRoad,false,'Off-road contact');
 const racer=fs.readFileSync(path.join(reference,'racer.html'),'utf8');
 for(const [kind,profile]of Object.entries(expectedProfiles)){
  const block=racer.match(new RegExp('^        '+kind+': \\{([\\s\\S]*?)^        \\},','m'));
  assert(block,'Missing reference profile '+kind);
  for(const [key,value]of Object.entries(profile))assert.equal(Number(block[1].match(new RegExp('\\b'+key+': ([0-9.]+)'))?.[1]),value,kind+' '+key+' must match racer.html');
 }
 for(const file of referenceFiles){
  assert(fs.readFileSync(path.join(reference,file)).equals(fs.readFileSync(path.join(__dirname,'../web/rv',file))),file+' copied runtime must match RacingVibes');
 }
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const sites=await(await fetch(url+'/api/sites')).json(),site=sites.find(s=>s.status==='built');
  assert(site,'Requires one completed local scene; no generation is submitted');
  const data=await(await fetch(url+'/api/data?id='+site.id)).json();
  const rad=Math.PI/180,R=6378137,lat=site.actual_lat,lon=site.actual_lon;
  const geo=(x,y)=>[lon+x/(rad*R*Math.cos(lat*rad)),lat-y/(rad*R)];
  const fixture=structuredClone(data);
  fixture.roads=[{id:'straight',class:'residential',width:12,surface:'asphalt',parts:[[[geo(-96,0),geo(96,0)]]]}];
  fixture.scene.roads=[[[[-96,-6],[96,-6],[96,6],[-96,6],[-96,-6]]]];
  fixture.buildings=[];fixture.scene.boundary_solids=[];fixture.scene.site_surfaces={};fixture.scene.traffic_hardware=[];
  await page.route('**/api/data?**',r=>r.fulfill({json:fixture}));
  if(process.env.EARTH_DRIVING_BASELINE){
   const original=require('child_process').execFileSync('git',['show','HEAD:batch_v9/web/app.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
   await page.route('**/app.js',r=>r.fulfill({body:original,contentType:'text/javascript'}));
  }
  await page.route('**/reference/**',r=>{
   const file=new URL(r.request().url()).pathname.slice('/reference/'.length);
   if(file==='index.html')return r.fulfill({contentType:'text/html',body:'<script>window.RACING_VIBES_BUILD={devToolsEnabled:false}</script><script src="vendor/planck/planck.min.js"></script><script src="assets/vehicles/vehicle_colliders.js"></script><script type="module" src="physics.js"></script>'});
   assert(referenceFiles.includes(file),'Unexpected reference import '+file);
   return r.fulfill({body:fs.readFileSync(path.join(reference,file)),contentType:'text/javascript'});
  });
  await page.addInitScript(()=>{
   window.testNow=1000;performance.now=()=>window.testNow;
   requestAnimationFrame=cb=>{window.testFrame=cb;return 1;};
  });
  await page.goto(url+'/?site='+site.id);
  await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
  await page.evaluate(()=>{const f=document.createElement('iframe');f.id='reference';f.src='/reference/index.html';document.body.append(f);});
  const ref=page.frame({url:url+'/reference/index.html'})||await page.waitForEvent('framenavigated');
  await ref.waitForFunction(()=>window.RacerPhysics,{},{polling:50});
  const results=await page.evaluate(profiles=>{
   const P=RacerPhysics,ref=document.querySelector('#reference').contentWindow,Q=ref.RacerPhysics;
   const update=P.updateCar,step=P.planckStep;
   let target,body,checks=0,maxError=0,bodyReplacements=0,surfaceMismatch=0;
   const compare=()=>{
    const c=earthLab.car;
    if(c.physics.planckBody!==body){bodyReplacements++;body=c.physics.planckBody;}
    for(const key of ['x','y','angle','vx','vy'])maxError=Math.max(maxError,Math.abs(c[key]-target[key]));
    checks++;
   };
   P.updateCar=(car,input,surface,dt)=>{
    // Independent RacingVibes five-point on-road rule for the fixture.
    const c=Math.cos(target.angle),s=Math.sin(target.angle),l=target.length/2,w=target.width/2;
    const points=[[0,0],[l,-w],[l,w],[-l,w],[-l,-w]];
    const onRoad=points.filter(([a,b])=>Math.abs((target.y+a*s+b*c)/10)<=6).length>=3;
    if(surface.onRoad!==onRoad)surfaceMismatch++;
    Q.planckBeginStep(dt,[target]);Q.updateCar(target,input,{onRoad,surfaceType:'tarmac-pro'},dt);
    return update(car,input,surface,dt);
   };
   P.planckStep=()=>{step();Q.planckStep();compare();};
   const key=(code,down)=>dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));
   const frames=n=>{for(let i=0;i<n;i++){testNow+=1000/60+1e-7;testFrame(testNow);}};
   const results=[];
   for(const kind of Object.keys(profiles)){
    document.querySelector('#vehicle').value=kind;earthLab.spawn([-65,0]);
    const c=earthLab.car;
    target={kind,steeringMode:'touch',...profiles[kind],x:c.x,y:c.y,angle:c.angle,vx:0,vy:0,speed:0};
    ref.RacingVibesVehicleColliders.apply(target);Q.initCar(target,kind);
    Q.configureTrackCollision([],{ppm:30});Q.configureDecorCollision([],[]);Q.rebuildPlanckWorld({cars:[target]});
    body=c.physics.planckBody;checks=0;maxError=0;bodyReplacements=0;surfaceMismatch=0;
    key('KeyW',true);frames(90);key('KeyW',false);
    const acceleratedX=c.x/10,speed=c.speed;
    key('KeyD',true);frames(15);key('KeyD',false);frames(15);
    key('KeyS',true);frames(180);key('KeyS',false);
    const reversed=target.physics.dir<0;
    const result={kind,checks,maxError,bodyReplacements,surfaceMismatch,acceleratedX,speed,reversed,finalSpeed:c.speed,finalX:c.x/10,finalY:c.y/10,gear:c.gearbox.gear};
    results.push(result);
    // Keep running all vehicles so a baseline failure provides useful evidence.
   }
   P.updateCar=update;P.planckStep=step;
   return results;
  },expectedProfiles);
  console.log(JSON.stringify({fixtureResults:results},null,2));
  for(const r of results){
   assert(r.acceleratedX> -60,`${r.kind}: must cross the former collision grid boundary`);
   assert.equal(r.bodyReplacements,0,`${r.kind}: must retain the moving physics body`);
   assert.equal(r.surfaceMismatch,0,`${r.kind}: ground must be sampled each tick`);
   assert(r.maxError<1e-7,`${r.kind}: trajectory must match RacingVibes (error ${r.maxError})`);
   assert(r.reversed||r.finalSpeed<r.speed,`${r.kind}: braking must slow the car or enter reverse`);
   assert(r.checks>=299,`${r.kind}: all fixed ticks executed`);
  }
  fixture.scene.boundary_solids=[[[[0,-10],[.2,-10],[.2,10],[0,10],[0,-10]]]];
  await page.reload();
  await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
  const collision=await page.evaluate(()=>{
   earthLab.spawn([-40,0]);
   dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));
   let maxX=-Infinity;
   for(let i=0;i<180;i++){testNow+=1000/60+1e-7;testFrame(testNow);maxX=Math.max(maxX,earthLab.car.x/10);}
   dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));
   return {maxX};
  });
  assert(collision.maxX> -10&&collision.maxX< -1,'Static boundary collision must stop the car before the wall');
  console.log(JSON.stringify({staticBoundaryCollision:collision}));
  await page.close();
  const live=await browser.newPage({viewport:{width:1280,height:900}});
  live.on('pageerror',e=>errors.push(e.message));
  await live.goto(url+'/?site='+site.id);
  await live.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  await live.locator('canvas').click({position:{x:1000,y:600}});
  const before=await live.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));
  await live.keyboard.down('w');await live.waitForTimeout(1800);await live.keyboard.up('w');
  const distance=await live.evaluate(p=>Math.hypot(earthLab.car.x-p.x,earthLab.car.y-p.y)/10,before);
  assert(distance>.5,'Ordinary keyboard drive on actual scene');
  await live.locator('#pause').click();
  const paused=await live.evaluate(()=>[earthLab.car.x,earthLab.car.y]);
  await live.waitForTimeout(200);assert.deepEqual(await live.evaluate(()=>[earthLab.car.x,earthLab.car.y]),paused);
  await live.locator('#recover').click();assert(await live.evaluate(()=>earthLab.car.speed===0));
  await live.reload();await live.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({actualScene:site.name,distanceMetres:distance,pause:true,recovery:true,reload:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});



