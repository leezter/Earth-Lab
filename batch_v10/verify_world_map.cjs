const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47852',out=path.join(__dirname,'custom/map-picker-check');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const sites=await(await fetch(url+'/api/sites')).json(),site=sites.find(s=>s.status==='built'&&!s.fixture&&s.renderer_freeze===JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id);assert(site);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9,null,{timeout:90000});
  await page.goto(url+'/?site='+site.id);await ready();await page.locator('#location-map .leaflet-tile-loaded').first().waitFor({timeout:30000});
  assert(await page.locator('.leaflet-control-attribution').isVisible());
  const epoch=await page.evaluate(()=>earthLab.state.epoch);
  await page.locator('#location-map').click({position:{x:270,y:110}});
  await page.waitForFunction(()=>document.querySelector('#generation').textContent.startsWith('Selected: Map location'));
  assert(await page.locator('#generate').isEnabled());assert.equal(await page.evaluate(()=>earthLab.state.epoch),epoch);
  await page.locator('#location-map').focus();
  const paused=await page.evaluate(()=>earthLab.state.paused);await page.keyboard.press('p');assert.equal(await page.evaluate(()=>earthLab.state.paused),paused);
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);await page.locator('#map-centre').click();
  await page.screenshot({path:path.join(out,'world-map.png')});
  // Existing built coordinates exercise the real API and all nine cached tiles.
  await page.locator('#query').fill(`${site.lat}, ${site.lon}`);await page.locator('#search').evaluate(f=>f.requestSubmit());
  await page.locator('#map-centre').click();await page.locator('#generate').click();
  await page.waitForFunction(()=>document.querySelector('#generate').textContent==='Drive generated area');
  await page.locator('#generate').click();await ready();assert.equal(await page.evaluate(()=>earthLab.state.renderedTiles),9);
  // A deferred response must not overwrite a newer map selection.
  let release;const deferred=new Promise(r=>release=r);
  await page.route('**/api/generate',async r=>{await deferred;await r.fulfill({json:{id:'place-0000000000000000',status:'queued'}});});
  await page.locator('#map-centre').click();await page.locator('#generate').click();
  await page.locator('#location-map').click({position:{x:280,y:100}});const selection=await page.locator('#generation').textContent();release();
  await page.waitForTimeout(250);assert.equal(await page.locator('#generation').textContent(),selection);assert(await page.locator('#generate').isEnabled());
  await page.unroute('**/api/generate');
  let calls=0;
  await page.route('**/api/generate',r=>{calls++;return r.fulfill({json:{id:'place-0000000000000000',status:'queued'}})});
  await page.route('**/api/job?id=place-0000000000000000',r=>r.fulfill({json:{name:'Map fixture',status:calls===1?'rendering':'failed',error:'Controlled map failure'}}));
  await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('rendering'));
  await page.locator('#map-picker summary').click();
  if(await page.evaluate(()=>earthLab.state.paused))await page.locator('#pause').click();
  const before=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));
  await page.locator('#world').click({position:{x:1100,y:650}});await page.keyboard.down('w');await page.waitForTimeout(800);await page.keyboard.up('w');
  assert(await page.evaluate(p=>Math.hypot(earthLab.car.x-p.x,earthLab.car.y-p.y)>2,before));
  await page.locator('#pause').click();const pos=await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]),pos);await page.locator('#recover').click();
  await page.locator('#map-picker summary').click();await page.locator('#map-centre').click();await page.locator('#generate').click();
  await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Controlled map failure'));assert(await page.locator('#generate').isEnabled());
  await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Controlled map failure'));assert.equal(calls,3);
  await page.unroute('**/api/generate');await page.unroute('**/api/job?id=place-0000000000000000');
  await page.locator('#query').fill('85, 0');await page.locator('#search').evaluate(f=>f.requestSubmit());assert((await page.locator('#generation').textContent()).includes('84°'));
  // Search placement, plus offline basemap fallback.
  await page.route('**/api/search?*',r=>r.fulfill({json:[{lat:site.lat,lon:site.lon,label:'Search map fixture'}]}));
  await page.locator('#query').fill('fixture');await page.locator('#search').evaluate(f=>f.requestSubmit());await page.locator('#results button').click();
  assert((await page.locator('#generation').textContent()).includes('Search map fixture'));
  await page.screenshot({path:path.join(out,'street-selection.png')});
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort());await page.locator('#map-world').click();await page.locator('.leaflet-control-zoom-in').click();
  await page.waitForFunction(()=>document.querySelector('#map-notice').textContent.includes('could not load'));
  await page.setViewportSize({width:390,height:740});await page.screenshot({path:path.join(out,'narrow-picker.png')});
  assert(await page.locator('.leaflet-control-attribution').isVisible());
  const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert(dims.width<=dims.viewport);
  await page.reload();await ready();assert(await page.locator('#map-picker').isVisible());
  const next=sites.find(s=>s.status==='built'&&s.id!==site.id);if(next){await page.selectOption('#presets',next.id);await page.locator('#visit').click();await ready();}
  assert.deepEqual(errors,[]);
  const freeze=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json')));
  for(const [name,hash]of Object.entries(freeze.source_hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name))).digest('hex'),hash,name);
  const report={checkedUTC:new Date().toISOString(),mapTilesLoaded:true,mapClick:true,keyboardSelection:true,realCachedGeneration:site.id,nineTiles:true,staleResponseGuard:true,mockedPendingFailureRetry:true,drivingWhilePending:true,pauseRecovery:true,searchPlacement:true,offlineFallback:true,narrowLayout:true,reloadSceneSwitch:true,frozenInputsUnchanged:true,errors};
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));console.log(report);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
