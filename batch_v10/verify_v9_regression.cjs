// Read-only browser check of the preserved v9 flat scene. Evidence is written
// exclusively in v10; original v9 reports, sources and tiles are untouched.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const url='http://127.0.0.1:47851',sites=await(await fetch(url+'/api/sites')).json();
 const site=sites.find(s=>s.status==='built'&&/Kreuzberg|Wrangel/i.test(s.name))||sites.find(s=>s.status==='built');assert(site);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={edition:'preserved v9',site:site.id,name:site.name,vehicles:[],errors:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);
  for(const kind of ['GT','F1','Bubble','Truck']){
   await page.locator('#vehicle').selectOption(kind);const before=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));
   await page.locator('#world').click({position:{x:1100,y:600}});await page.keyboard.down('ArrowUp');await page.waitForTimeout(1000);await page.keyboard.up('ArrowUp');
   const after=await page.evaluate(()=>({x:earthLab.car.x,y:earthLab.car.y}));assert(Math.hypot(after.x-before.x,after.y-before.y)>1);
   await page.locator('#pause').click();const paused=await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>[earthLab.car.x,earthLab.car.y]),paused);
   await page.locator('#recover').click();await page.locator('#pause').click();report.vehicles.push({kind,drivenMetres:Math.hypot(after.x-before.x,after.y-before.y)/10,pause:true,recover:true});
  }
  await page.reload();await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);report.reload=true;assert.equal(report.errors.length,0);
  report.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'v9-regression-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
