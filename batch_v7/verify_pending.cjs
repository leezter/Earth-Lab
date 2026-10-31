// Run while one real scene is built and another real generation is pending.
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),url='http://127.0.0.1:47849';
(async()=>{
 const sites=await(await fetch(url+'/api/sites')).json(),built=sites.find(s=>s.status==='built'),pending=sites.find(s=>!['built','failed'].includes(s.status));
 assert(built&&pending,'Run while one completed scene and another pending job exist');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(url+'/?site='+built.id);
  await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9,null,{timeout:60000});
  const label=built.name.includes('Berlin')?'berlin':built.name.includes('City Hall')?'city-hall':built.name.includes('New York')?'new-york':built.name.includes('London')?'london':built.id;const folder=path.join(__dirname,'web/reviews');fs.mkdirSync(folder,{recursive:true});
  await page.screenshot({path:path.join(folder,label+'-overview.png')});await page.locator('#zoom').fill('16');await page.locator('#zoom').dispatchEvent('input');await page.waitForTimeout(250);
  await page.screenshot({path:path.join(folder,label+'-close.png')});
  const before=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,epoch:earthLab.state.epoch}));
  await page.locator('canvas').click({position:{x:1100,y:650}});await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');
  const after=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,epoch:earthLab.state.epoch}));
  const distance=Math.hypot(after.x-before.x,after.y-before.y)/10;
  assert(distance>.5);assert.equal(before.epoch,after.epoch);assert.deepEqual(errors,[]);
  const end=await(await fetch(url+'/api/job?id='+pending.id)).json();
  const result={checked_utc:new Date().toISOString(),renderer:built.renderer_freeze,currentScene:built.id,
   otherJob:pending.id,otherJobStatusBefore:pending.status,otherJobStatusAfter:end.status,currentSceneStillPlayable:true,distanceDrivenMetres:distance,errors};
  fs.writeFileSync(path.join(__dirname,'pending-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
