const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const probe=JSON.parse(fs.readFileSync(path.join(__dirname,'ground-probe.json')));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:47849/?site='+probe.site);
  await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  await page.evaluate(p=>{const car=earthLab.car;Object.assign(car,{x:p[0]*10,y:p[1]*10,vx:0,vy:0,speed:0,gearbox:null});RacerPhysics.initCar(car,car.kind);RacerPhysics.rebuildPlanckWorld({cars:[car]});},probe.point);
  await page.waitForFunction(expected=>earthLab.state.surface.surfaceType===expected&&document.querySelector('#surface').textContent.includes('Mapped site'),probe.expectedSurfaceType);
  const result={checked_utc:new Date().toISOString(),probe,surface:await page.evaluate(()=>earthLab.state.surface),hud:await page.locator('#surface').textContent()};
  fs.writeFileSync(path.join(__dirname,'ground-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
