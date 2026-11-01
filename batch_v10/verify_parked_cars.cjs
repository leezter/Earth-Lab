// Actual mapped build, sprite loading, static contacts and viewer lifecycle.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47852';
(async()=>{
 const sites=await(await fetch(url+'/api/sites')).json();
 const current=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id;
 const target=sites.find(s=>s.renderer_freeze===current&&s.status==='built'&&!s.fixture&&s.name.includes('parked cars'));
 assert(target,'A completed mapped parked-cars acceptance build is required');
 const other=sites.find(s=>s.fixture==='overpass'&&s.status==='built');assert(other);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const results={renderer:current,site:target.id,synthetic:false,errors:[],contacts:[],
  bridgeRegressionFixture:{id:other.id,renderer:other.renderer_freeze,synthetic:true,imagesRerendered:false}};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>results.errors.push(e.message));
  await page.addInitScript(()=>{
   window.testNow=1000;performance.now=()=>testNow;let id=0;const callbacks=new Map();
   requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};
   window.frame=()=>{testNow+=1000/60+1e-7;const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(testNow);};
  });
  async function ready(){await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});}
  await page.goto(url+'/?site='+target.id);await ready();
  const signature=await page.evaluate(()=>JSON.stringify(earthLab.scene.parked_cars));
  results.parked=await page.evaluate(()=>({count:earthLab.state.parkedCars,decodedBytes:earthLab.state.parkedDecodedBytes,report:earthLab.scene.parked_cars_report}));
  assert(results.parked.count>0);assert(results.parked.decodedBytes>0);
  results.contacts=await page.evaluate(()=>{
   const key=(code,on)=>dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
   const target=earthLab.scene.parked_cars.find(c=>Math.abs(c.x)<60&&Math.abs(c.y)<60);if(!target)throw Error('No central parked car for contact checks');
   const results=[];
   for(const kind of ['GT','F1','Bubble','Truck']){
    document.querySelector('#vehicle').value=kind;
    const angle=target.angle,tx=Math.cos(angle),ty=Math.sin(angle);
    earthLab.spawn([target.x-10*tx,target.y-10*ty]);
    const car=earthLab.car,body=car.physics.planckBody;
    // Test initial pose only; all subsequent motion uses ordinary throttle.
    car.x=(target.x-9*tx)*10;car.y=(target.y-9*ty)*10;car.angle=angle;
    body.setTransform(planck.Vec2(car.x/30,car.y/30),angle);
    const start=[car.x,car.y];let minimum=Infinity;key('KeyW',true);
    for(let i=0;i<260;i++){
     frame();const gap=(target.x-car.x/10)*tx+(target.y-car.y/10)*ty;
     minimum=Math.min(minimum,gap);
    }
    key('KeyW',false);
    results.push({kind,minimumCentreGap:minimum,moved:Math.hypot(car.x-start[0],car.y-start[1])/10,
      bodyPreserved:body===earthLab.car.physics.planckBody,recoveries:earthLab.state.recoveries});
   }
   return results;
  });
  for(const row of results.contacts){assert(row.moved>.1);assert(row.minimumCentreGap>1);assert(row.bodyPreserved);assert.equal(row.recoveries,0);}
  await page.evaluate(()=>{document.querySelector('#vehicle').value='GT';earthLab.spawn();frame();});
  const before=await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]);
  await page.evaluate(()=>{document.querySelector('#pause').click();for(let i=0;i<50;i++)frame();});
  assert.deepEqual(await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]),before);results.pause=true;
  await page.evaluate(()=>{document.querySelector('#pause').click();document.querySelector('#recover').click();frame();});results.recover=true;
  await page.evaluate(async id=>{document.querySelector('#presets').value=id;await earthLab.open();frame();},other.id);await ready();
  assert.equal(await page.evaluate(()=>earthLab.state.parkedCars),0);results.sceneDisposal=true;
  results.bridgeRegression=await page.evaluate(()=>{
   const results=[];document.querySelector('#vehicle').value='GT';
   for(const elevated of [true,false])for(const direction of [-1,1]){
    const at=elevated?[-direction*65,0]:[0,-direction*65];
    earthLab.spawn(at,elevated?(direction>0?'approach-a':'approach-b'):'lower');
    const car=earthLab.car,body=car.physics.planckBody;
    const angle=elevated?(direction>0?0:Math.PI):(direction>0?Math.PI/2:-Math.PI/2);
    car.angle=angle;body.setTransform(planck.Vec2(car.x/30,car.y/30),angle);
    const surfaces=new Set();let count=0;
    dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));
    while(direction*(elevated?car.x:car.y)/10<55&&count++<1800){frame();surfaces.add(car.surfaceId);}
    dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));
    results.push({elevated,direction,completed:count<1800,surfaces:[...surfaces],
      bodyPreserved:body===earthLab.car.physics.planckBody,recoveries:earthLab.state.recoveries});
   }
   return results;
  });
  for(const row of results.bridgeRegression){assert(row.completed);assert(row.bodyPreserved);assert.equal(row.recoveries,0);if(row.elevated)assert(row.surfaces.includes('bridge-fixture'));else assert.deepEqual(row.surfaces,['lower']);}
  const asset=JSON.parse(signature)[0].asset;
  await page.route('**/'+asset,r=>r.fulfill({status:503,body:'Test missing sprite'}));
  await page.evaluate(async id=>{document.querySelector('#presets').value=id;await earthLab.open();},target.id);
  assert.equal(await page.evaluate(()=>earthLab.state.parkedCars),0);
  assert((await page.locator('#status').textContent()).includes('artwork unavailable'));results.failedSpritePreservesScene=true;
  await page.unroute('**/'+asset);
  await page.evaluate(async id=>{document.querySelector('#presets').value=id;await earthLab.open();frame();},target.id);await ready();
  assert.equal(await page.evaluate(()=>JSON.stringify(earthLab.scene.parked_cars)),signature);results.retry=true;
  await page.reload();await ready();await page.evaluate(()=>frame());
  assert.equal(await page.evaluate(()=>JSON.stringify(earthLab.scene.parked_cars)),signature);results.reloadDeterministic=true;
  await page.locator('#hide-menu').click();
  await page.screenshot({path:path.join(__dirname,'web/reviews/parked-cars.png')});
  assert.deepEqual(results.errors,[]);results.finished_utc=new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'parked-cars-verification.json'),JSON.stringify(results,null,2));console.log(results);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
