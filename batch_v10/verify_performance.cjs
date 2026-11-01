// Ordinary real-time desktop driving. No simulated clock or AI driving mode.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),cp=require('child_process');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const identity=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'),'utf8')).id;
 const url='http://127.0.0.1:47852',sites=await(await fetch(url+'/api/sites')).json(),selected=sites.filter(s=>s.status==='built'&&s.renderer_freeze===identity);
 assert(selected.length);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-precise-memory-info']});
 const results={renderer:identity,started_utc:new Date().toISOString(),scope:'Desktop Edge, ordinary keyboard driving; not Android acceptance',sites:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  for(const [index,site]of selected.entries()){
   const loadStart=performance.now();
   if(index===0)await page.goto(url+'/?site='+site.id);
   else{
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.locator('#presets').selectOption(site.id);await page.locator('#visit').click();
   }
   await page.waitForFunction(id=>window.earthLab?.car&&!earthLab.state.loading&&earthLab.scene.bake.tile_url.includes('/'+id+'/'),site.id);
   const loadMilliseconds=performance.now()-loadStart;
   await page.getByRole('button',{name:'Hide menu',exact:true}).click();
   await page.locator('#world').click({position:{x:1100,y:600}});await page.waitForTimeout(1000);
   await page.evaluate(()=>{window.frameMeasurements=[];let previous=performance.now();window.profileFrames=true;
    const sample=now=>{if(!profileFrames)return;frameMeasurements.push(now-previous);previous=now;requestAnimationFrame(sample);};requestAnimationFrame(sample);});
   await page.keyboard.down('ArrowUp');await page.waitForTimeout(1200);await page.keyboard.up('ArrowUp');
   await page.keyboard.down('ArrowLeft');await page.waitForTimeout(300);await page.keyboard.up('ArrowLeft');await page.waitForTimeout(1500);
   const result=await page.evaluate(()=>{
    profileFrames=false;const values=frameMeasurements.filter(v=>v>0).sort((a,b)=>a-b),sum=values.reduce((a,b)=>a+b,0);
    return {frames:values.length,meanFps:values.length/sum*1000,p95Ms:values[Math.floor(values.length*.95)],p99Ms:values[Math.floor(values.length*.99)],
     maxMs:values.at(-1),jsHeapBytes:performance.memory?.usedJSHeapSize,state:earthLab.state};
   });
   const cdp=await browser.newBrowserCDPSession();const processes=await cdp.send('SystemInfo.getProcessInfo');await cdp.detach();
   result.browserProcessIds=processes.processInfo.map(p=>p.id);
   const ids=result.browserProcessIds.map(Number).filter(Number.isSafeInteger);
   // Short-lived browser utility processes can exit after the CDP snapshot.
   // Filter the live process inventory instead of querying now-stale IDs.
   const script='$bridgeBenchmarkPids=@('+ids.join(',')+'); Get-Process -ErrorAction Stop | Where-Object { $bridgeBenchmarkPids -contains $_.Id } | Select-Object Id,WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress';
   result.processMemory=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8'}));
   result.loadMilliseconds=loadMilliseconds;
   assert(result.frames>30);assert(result.state.decodedBytes<=256*1024**2);
   results.sites.push({id:site.id,name:site.name,...result});console.log(site.name,JSON.stringify(result));
  }
  results.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'performance-verification.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
