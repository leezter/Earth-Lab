const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{const url='http://127.0.0.1:47852',ready=await(await fetch(url+'/api/job?id=place-b22396e333e0a3d4')).json(),browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const results={deliveryRenderer:JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id,scope:'Real cached Ostkreuz fallback; new-candidate terminal statuses mocked; no new Blender render'};
try{
 const open=async()=>{const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.goto(url+'/?site='+ready.id);await p.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);return p;};
 const choose=async(p,text='52.5031523, 13.4695776')=>{await p.locator('#query').fill(text);await p.locator('#query').press('Enter');await p.locator('#generate').click();};
 // Real failed request and real validated nearby area; no new build submitted.
 const actual=await open();await choose(actual);await actual.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Using an available area'));
 const text=await actual.locator('#generation').textContent();assert(text.includes('72 m'));await actual.waitForFunction(()=>!earthLab.state.loading&&!!earthLab.car);results.realOstkreuzFallback={text,activeScene:await actual.evaluate(()=>earthLab.scene.bake.tile_url)};await actual.close();
 // Fresh-candidate search: failed initial request, failed first candidate, built second.
 const p=await open();let calls=0;
 await p.route('**/api/generate',r=>{calls++;return r.fulfill({json:calls<3?{id:'mock-'+calls,status:'queued'}:ready});});
 await p.route('**/api/job?id=mock-*',r=>r.fulfill({json:{status:'failed',error:'Unsupported geometry',retryable:false}}));
 await p.route('**/api/nearby?*',r=>r.fulfill({json:{ready:null,candidates:[{lat:52.503,lon:13.47,distance_m:50},{lat:52.504,lon:13.47,distance_m:100}]}}));
 await choose(p);await p.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Using an available area'));assert.equal(calls,3);results.failedCandidateThenSuccess=true;await p.close();
 // Exhaustion must stop, leave the old drive available, and permit a new choice.
 const exhausted=await open();let attempts=0;
 await exhausted.route('**/api/generate',r=>{attempts++;return r.fulfill({json:{id:'exhaust-'+attempts,status:'queued'}});});
 await exhausted.route('**/api/job?id=exhaust-*',r=>r.fulfill({json:{status:'failed',error:'Invalid geometry'}}));
 await exhausted.route('**/api/nearby?*',r=>r.fulfill({json:{ready:null,candidates:Array.from({length:12},(_,i)=>({lat:52.503+i*.0001,lon:13.47,distance_m:50+i*20}))}}));
 await choose(exhausted);await exhausted.waitForFunction(()=>document.querySelector('#generation').textContent.includes('No playable alternative'));
 assert.equal(attempts,9);assert(await exhausted.locator('#generate').isHidden());assert(await exhausted.evaluate(()=>!!earthLab.car&&!earthLab.state.loading));results.eightAttemptLimit=true;results.oldDriveRetained=true;await exhausted.close();
 // Changing the selection while lookup is pending must not relocate the car.
 const stale=await open();let release;const gate=new Promise(r=>release=r);
 await stale.route('**/api/generate',r=>r.fulfill({json:{id:'stale-failure'}}));await stale.route('**/api/job?id=stale-failure',r=>r.fulfill({json:{status:'failed',error:'Geometry'}}));
 await stale.route('**/api/nearby?*',async r=>{await gate;await r.fulfill({json:{ready,candidates:[]}});});
 await choose(stale);await stale.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Finding the closest'));
 const beforeDrive=await stale.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await stale.locator('#world').click({position:{x:1100,y:600}});await stale.keyboard.down('ArrowUp');await stale.waitForTimeout(800);await stale.keyboard.up('ArrowUp');const afterDrive=await stale.evaluate(()=>[earthLab.car.x,earthLab.car.y]);
 const moved=Math.hypot(afterDrive[0]-beforeDrive[0],afterDrive[1]-beforeDrive[1])/10;assert(moved>.1);results.drivingWhileSearchingMetres=moved;
 await stale.locator('#query').fill('52.6, 13.5');await stale.locator('#query').press('Enter');release();await stale.waitForTimeout(300);assert((await stale.locator('#generation').textContent()).startsWith('Selected: 52.6, 13.5'));results.staleSelectionIgnored=true;await stale.close();
 // Resume a pending candidate after reload without resetting the attempt budget.
 const resume=await open();let submissions=0,pending=true;
 await resume.route('**/api/generate',r=>{submissions++;return r.fulfill({json:submissions===1?{id:'resume-original'}:submissions===2?{id:'resume-candidate'}:ready});});
 await resume.route('**/api/job?id=resume-*',r=>r.fulfill({json:{status:r.request().url().includes('resume-candidate')&&pending?'rendering':'failed',error:'Geometry'}}));
 await resume.route('**/api/nearby?*',r=>r.fulfill({json:{ready:null,candidates:[{lat:52.503,lon:13.47,distance_m:50},{lat:52.504,lon:13.47,distance_m:100}]}}));
 await choose(resume);await resume.waitForFunction(()=>!!sessionStorage.getItem('earth-nearby'));
 pending=false;await resume.reload();await resume.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Using an available area'));
 assert.equal(submissions,3);assert.equal(await resume.evaluate(()=>sessionStorage.getItem('earth-nearby')),null);results.reloadResumesOriginalSearch=true;await resume.close();
 results.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'nearby-verification.json'),JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
