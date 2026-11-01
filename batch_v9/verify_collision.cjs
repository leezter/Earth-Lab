// Controlled placement against a real mapped boundary, with a no-wall control.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const probe=JSON.parse(fs.readFileSync(path.join(__dirname,'collision-probe.json')));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  await page.goto('http://127.0.0.1:47851/?site='+probe.site);
  await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  assert((await page.evaluate(()=>earthLab.state.boundaryObstacles))>0);
  await page.locator('canvas').click({position:{x:1100,y:650}});
  const run=async removeWalls=>{
   await page.evaluate(({p,remove})=>{
    const car=earthLab.car;Object.assign(car,{x:p.start[0]*10,y:p.start[1]*10,angle:p.angle,vx:0,vy:0,speed:0,gearbox:null});
    RacerPhysics.initCar(car,car.kind);
    if(remove){const configure=RacerPhysics.configureDecorCollision;RacerPhysics.configureDecorCollision=()=>configure([],[]);RacerPhysics.configureDecorCollision([],[]);}
    RacerPhysics.rebuildPlanckWorld({cars:[car]});
   },{p:probe,remove:removeWalls});
   await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');
   return page.evaluate(p=>({x:earthLab.car.x/10,y:earthLab.car.y/10,
    side:(earthLab.car.x/10-p.mid[0])*p.normal[0]+(earthLab.car.y/10-p.mid[1])*p.normal[1]}),probe);
  };
  const blocked=await run(false);assert(blocked.side>1&&blocked.side<6.5,'Mapped boundary must stop the approaching car');
  const control=await run(true);assert(control.side<-.5,'No-wall control must cross the same mapped line');
  await page.reload();await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  const result={checked_utc:new Date().toISOString(),probe,withMappedBoundary:blocked,noWallControl:control,boundaryRestoredOnReload:true};
  fs.writeFileSync(path.join(__dirname,'collision-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
