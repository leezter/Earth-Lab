const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const url='http://127.0.0.1:47849',sites=(await(await fetch(url+'/api/sites')).json()).filter(s=>s.status==='built');assert(sites.length);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/?site='+sites[0].id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);
  const before=await page.evaluate(()=>({t:earthLab.state.signalSeconds,states:earthLab.state.signalStates}));assert(before.states.length,'Sample must contain signals');
  await page.locator('#pause').click();const paused=await page.evaluate(()=>earthLab.state.signalSeconds);await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>earthLab.state.signalSeconds),paused);
  await page.locator('#pause').click();await page.waitForTimeout(13000);const after=await page.evaluate(()=>({t:earthLab.state.signalSeconds,states:earthLab.state.signalStates}));assert(after.t>before.t+10);assert(before.states.some((s,i)=>s.state!==after.states[i].state));
  const groups=new Map();for(const s of after.states)if(s.state==='green'){if(!groups.has(s.group))groups.set(s.group,new Set());groups.get(s.group).add(s.axis);}assert([...groups.values()].every(g=>g.size<=1));
  await page.locator('#signals').uncheck();assert.equal(await page.locator('#signals').isChecked(),false);await page.locator('#signals').check();
  if(sites.length>1){await page.selectOption('#presets',sites[1].id);await page.locator('#visit').click();await page.waitForFunction(()=>earthLab.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);assert((await page.evaluate(()=>earthLab.state.signalSeconds))<3);}
  await page.reload();await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.state.renderedTiles===9);assert((await page.evaluate(()=>earthLab.state.signalSeconds))<3);assert.deepEqual(errors,[]);
  const report={checked_utc:new Date().toISOString(),signalCount:before.states.length,pauseFreezesClock:true,illustrativePhaseChanges:true,noConflictingGreenAxes:true,toggle:true,sceneSwitchResets:sites.length>1,reloadResets:true,errors};fs.writeFileSync(path.join(__dirname,'signal-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
