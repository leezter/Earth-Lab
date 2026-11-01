const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47851',out=path.join(__dirname,'web/reviews');
(async()=>{
 const sites=await(await fetch(url+'/api/sites')).json();
 const renderer=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'),'utf8')).id;
 assert(sites.length>=2&&sites.every(s=>s.status==='built'&&s.renderer_freeze===renderer),'Wait for all current-renderer local builds to finish');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  fs.mkdirSync(out,{recursive:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],results=[];let aerial=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/image'))aerial++});
  const ready=()=>page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9,null,{timeout:90000});
  for(const [i,site]of sites.entries()){
   const start=Date.now();await page.goto(url+'/?site='+site.id,{waitUntil:'domcontentloaded'});await ready();
   const sceneReadySeconds=(Date.now()-start)/1000;
   if(await page.evaluate(()=>earthLab.state.paused))await page.locator('#pause').click();
   assert(Math.abs((await page.evaluate(()=>earthLab.state.origin))[0]-site.actual_lat)<1e-8);
   const label=site.id; // Unique per scene/cache identity, including repeated city names.
   await page.screenshot({path:path.join(out,label+'-overview.png')});
   await page.locator('#zoom').fill('16');await page.locator('#zoom').dispatchEvent('input');await page.waitForTimeout(250);
   await page.screenshot({path:path.join(out,label+'-close.png')});
   await page.locator('canvas').click({position:{x:1100,y:650}});
   const before=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));
   await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');
   const distance=await page.evaluate(p=>Math.hypot(earthLab.car.x-p.x,earthLab.car.y-p.y)/10,before);assert(distance>.5,'Actual vehicle movement');
   await page.locator('#pause').click();const paused=await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await page.waitForTimeout(250);
   assert.deepEqual(await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]),paused);
   await page.locator('#recover').click();assert(await page.evaluate(()=>Number.isFinite(earthLab.car.x)&&Math.hypot(earthLab.car.vx||0,earthLab.car.vy||0)<.01));
   for(const vehicle of ['F1','Bubble','Truck','GT']){await page.selectOption('#vehicle',vehicle);assert.equal(await page.evaluate(()=>earthLab.car.kind),vehicle);}
   await page.reload({waitUntil:'domcontentloaded'});await ready();
   const origin=await page.evaluate(()=>earthLab.state.origin);
   const cacheStart=Date.now();const cached=await page.evaluate(async s=>{const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:s.lat,lon:s.lon,name:s.name})});return r.json();},site);
   const cachedReuseSeconds=(Date.now()-cacheStart)/1000;
   assert.equal(cached.id,site.id);assert.equal(cached.status,'built');assert.deepEqual(await page.evaluate(()=>earthLab.state.origin),origin);
   results.push({id:site.id,name:site.name,sceneReadySeconds,cachedReuseSeconds,load_and_checks_seconds:(Date.now()-start)/1000,distanceDrivenMetres:distance,pause:true,recovery:true,vehicles:4,reload:true,cachedReuse:true,screenshots:2});
  }
  await page.selectOption('#presets',sites[0].id);await page.locator('#visit').click();await ready();
  await page.route('**/baked/**',r=>r.fulfill({status:503,body:'Simulated outage'}));await page.locator('#visit').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Missing baked tile'));
  await page.unroute('**/baked/**');await page.locator('#visit').click();await ready();
  // Exercise the picker while a job is pending, then a failed job and retry.
  let generationCalls=0;
  await page.route('**/api/generate',r=>{generationCalls++;return r.fulfill({json:{id:'place-0000000000000000',name:'Picker fixture',status:'queued'}})});
  await page.route('**/api/job?id=place-0000000000000000',r=>r.fulfill({json:{id:'place-0000000000000000',name:'Picker fixture',status:generationCalls===1?'rendering':'failed',error:'Controlled generation failure'}}));
  await page.locator('#query').fill('52.4971, 13.44561');await page.locator('#search').evaluate(form=>form.requestSubmit());
  const epoch=await page.evaluate(()=>earthLab.state.epoch);await page.locator('#generate').click();
  await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('rendering'));
  assert.equal(await page.evaluate(()=>earthLab.state.epoch),epoch);assert(await page.evaluate(()=>!!earthLab.car&&!earthLab.state.loading));
  const pendingBefore=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));
  await page.locator('canvas').click({position:{x:1100,y:650}});await page.keyboard.down('w');await page.waitForTimeout(700);await page.keyboard.up('w');
  assert(await page.evaluate(p=>Math.hypot(earthLab.car.x-p.x,earthLab.car.y-p.y)/10>.2,pendingBefore),'Driving while a job is pending');
  // Re-select to obtain a retryable generation button, and expose the failure.
  await page.locator('#search').evaluate(form=>form.requestSubmit());await page.locator('#generate').click();
  await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Controlled generation failure'));
  assert.equal(await page.locator('#generate').isEnabled(),true);await page.locator('#generate').click();
  await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Controlled generation failure'));
  assert.equal(generationCalls,3);
  await page.unroute('**/api/generate');await page.unroute('**/api/job?id=place-0000000000000000');
  const searchEpoch=await page.evaluate(()=>earthLab.state.epoch);
  await page.locator('#query').fill('new york');await page.locator('#search').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.querySelectorAll('#results button').length>0);
  assert((await page.locator('#results button').allTextContents()).some(t=>/new york/i.test(t)));
  await page.locator('#results button').first().click();assert(await page.locator('#generate').isVisible());assert.equal(await page.evaluate(()=>earthLab.state.epoch),searchEpoch);
  await page.goto(url+'/gallery.html',{waitUntil:'networkidle'});assert.equal(await page.locator('#sites li').count(),sites.length);
  for(const image of await page.locator('img').all())assert(await image.evaluate(im=>im.complete&&im.naturalWidth>0));
  await page.screenshot({path:path.join(out,'gallery.png')});assert.equal(aerial,0);assert.deepEqual(errors,[]);
  const viewerHashes=Object.fromEntries(['app.js','driving.js','spawn.js','ground.js','signals.js'].map(name=>[name,require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'web',name))).digest('hex')]));
  const report={viewer_source_hashes:viewerHashes,checked_utc:new Date().toISOString(),desktopBrowser:'Edge headless',results,errors,aerialRequests:aerial,livePlaceSearch:true,sceneSwitching:true,missingTileFailureRetry:true,pickerPendingKeepsScene:true,pickerFailureRetry:true,pickerLifecycleUsesMockJob:true,gallery:true};
  fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
