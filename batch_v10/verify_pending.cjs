const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const url='http://127.0.0.1:47852',sites=await(await fetch(url+'/api/sites')).json();
 const jobs=fs.readdirSync(path.join(__dirname,'custom'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>{
  const file=path.join(__dirname,'custom',e.name,'job.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
 }).filter(Boolean);
 const current=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'),'utf8')).id;
 const pending=jobs.find(s=>s.renderer_freeze===current&&!s.fixture&&!['built','failed'].includes(s.status)),ready=sites.find(s=>s.fixture==='overpass'&&s.status==='built');
 assert(pending&&ready,'Requires a real pending map job and a retained completed fixture; submits no new job');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/?site='+ready.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);
  const before=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,renderer:earthLab.state.rendererFreeze}));
  await page.locator('#world').click({position:{x:1100,y:600}});await page.keyboard.down('ArrowUp');await page.waitForTimeout(1000);await page.keyboard.up('ArrowUp');
  const after=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y,renderer:earthLab.state.rendererFreeze}));
  assert(Math.hypot(after.x-before.x,after.y-before.y)>1);assert.equal(before.renderer,after.renderer);assert.equal(errors.length,0);
  const actual=await(await fetch(url+'/api/job?id='+pending.id)).json();
  const result={pendingJob:pending.id,statusBefore:pending.status,statusAfter:actual.status,submittedByCheck:false,
   continuedDrivingMetres:Math.hypot(after.x-before.x,after.y-before.y)/10,renderer:after.renderer,errors};
  fs.writeFileSync(path.join(__dirname,'pending-verification.json'),JSON.stringify(result,null,2));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
