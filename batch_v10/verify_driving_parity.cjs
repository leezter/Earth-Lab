const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const reference=path.resolve('../RacingVibes');const referenceFiles=['physics.js','gearbox.js','src/gearbox.js','physics/planckWorld.js','physics/trackSurface.js','trackCollision.js','weather_conditions.js','vendor/planck/planck.min.js','assets/vehicles/vehicle_colliders.js'];
const url='http://127.0.0.1:47852';
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{const page=await browser.newPage();
  await page.route('**/reference/**',r=>{
   const file=new URL(r.request().url()).pathname.slice('/reference/'.length);
   if(file==='index.html')return r.fulfill({contentType:'text/html',body:'<script>window.RACING_VIBES_BUILD={devToolsEnabled:false}</script><script src="vendor/planck/planck.min.js"></script><script src="assets/vehicles/vehicle_colliders.js"></script><script type="module" src="physics.js"></script>'});
   assert(referenceFiles.includes(file),'Unexpected reference import '+file);
   return r.fulfill({body:fs.readFileSync(path.join(reference,file)),contentType:'text/javascript'});
  });

await page.addInitScript(()=>{requestAnimationFrame=cb=>{window.testFrame=cb;return 1;};});
await page.goto(url+'/?site=place-93119e68f0e402b3');await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,null,{polling:50});
await page.evaluate(()=>{const f=document.createElement('iframe');f.id='reference';f.src='/reference/index.html';document.body.append(f);});
const ref=await page.waitForSelector('#reference');await page.waitForFunction(()=>document.querySelector('#reference').contentWindow.RacerPhysics,null,{polling:50});
const results=await page.evaluate(()=>{const Q=document.querySelector('#reference').contentWindow.RacerPhysics,R=document.querySelector('#reference').contentWindow;
const profiles={GT:[24,45,20,39],F1:[24,44,18,42],Bubble:[16,40,16,38],Truck:[29,60,22,58]},out=[];
for(const [kind,[width,length,colliderWidth,colliderLength]]of Object.entries(profiles)){
document.querySelector('#vehicle').value=kind;earthLab.spawn([0,0]);const car=earthLab.car;
const target={kind,width,length,colliderWidth,colliderLength,steeringMode:'touch',x:car.x,y:car.y,angle:car.angle,speed:0,vx:0,vy:0};
R.RacingVibesVehicleColliders.apply(target);Q.initCar(target,kind);Q.configureTrackCollision([],{ppm:30});Q.configureDecorCollision([],[]);Q.rebuildPlanckWorld({cars:[target]});
const world=car.physics.planckBody.getWorld();for(let b=world.getBodyList();b;){const n=b.getNext();if(b!==car.physics.planckBody)world.destroyBody(b);b=n;}
let error=0;const body=car.physics.planckBody;
for(let i=0;i<600;i++){const input={throttle:i<260?1:0,brake:i>=330?1:0,steer:i>=240&&i<300?.6:0},surface={onRoad:true,surfaceType:'tarmac-pro'};
RacerPhysics.planckBeginStep(1/75,[car]);RacerPhysics.updateCar(car,input,surface,1/75);RacerPhysics.planckStep();Q.planckBeginStep(1/75,[target]);Q.updateCar(target,input,surface,1/75);Q.planckStep();
for(const k of ['x','y','vx','vy','angle'])error=Math.max(error,Math.abs(car[k]-target[k]));}
out.push({kind,ticks:600,maxError:error,bodyPreserved:body===car.physics.planckBody,inertia:[car.inertiaWidth,car.inertiaLength]});}return out;});
console.log(results);for(const r of results){assert(r.maxError<1e-7);assert(r.bodyPreserved);}fs.writeFileSync('batch_v10/custom/driving-parity-v10.33.json',JSON.stringify(results,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});


