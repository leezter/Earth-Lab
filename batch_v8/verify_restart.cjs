const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const url='http://127.0.0.1:47850',sites=await(await fetch(url+'/api/sites')).json();
 assert.equal(sites.length,4);assert(sites.every(s=>s.status==='built'&&s.renderer_freeze==='geometry-v8.2'));
 const credits=await(await fetch(url+'/api/credits')).json();assert(credits.sites_and_boundaries);assert(credits.road_markings_and_signals);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
  for(const site of sites){
   await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
   await page.waitForTimeout(2000);const fps=[];for(let i=0;i<4;i++){await page.waitForTimeout(500);fps.push(await page.evaluate(()=>earthLab.state.fps));}
   const label=site.name.includes('Berlin')?'berlin':site.name.includes('City Hall')?'city-hall':site.name.includes('New York')?'new-york':'london';
   await page.screenshot({path:path.join(__dirname,'web/reviews',label+'-overview.png')});await page.locator('#zoom').fill('16');await page.locator('#zoom').dispatchEvent('input');await page.waitForTimeout(300);await page.screenshot({path:path.join(__dirname,'web/reviews',label+'-close.png')});
   results.push({id:site.id,nineCachedTilesRenderedAfterRestart:true,stationaryFpsSamples:fps});
  }
  assert.deepEqual(errors,[]);const result={checked_utc:new Date().toISOString(),renderer:'geometry-v8.2',completedScenesRetained:sites.length,creditsAvailable:true,results,errors,
   note:'Stationary desktop samples after settling; not a driving performance benchmark or Android acceptance.'};
  fs.writeFileSync(path.join(__dirname,'restart-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
