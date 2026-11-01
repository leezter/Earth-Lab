// Real completed Berlin builds: exact selection, no fallback, and both bridge carriageways.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const url='http://127.0.0.1:47852';
(async()=>{
 const identity=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id;
 const sites=await(await fetch(url+'/api/sites')).json();
 const targets=[[52.500576,13.440578],[52.50175,13.44563]];
 const builds=targets.map(([lat,lon])=>sites.find(s=>s.renderer_freeze===identity&&s.status==='built'&&Math.abs(s.lat-lat)<1e-7&&Math.abs(s.lon-lon)<1e-7));
 assert(builds.every(Boolean),'Both repaired Berlin scenes must complete generation first');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={renderer:identity,source:'Newly generated real mapped scenes; no mocked generation responses',selections:[],traversals:[],errors:[]};
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});
  p.on('pageerror',e=>report.errors.push(e.message));let fallbacks=0;
  p.on('request',r=>{if(r.url().includes('/api/nearby?'))fallbacks++;});
  for(let i=0;i<builds.length;i++){
   const b=builds[i];await p.goto(url+'/?site='+b.id);await p.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);
   await p.locator('#query').fill(targets[i].join(', '));await p.locator('#query').press('Enter');await p.locator('#generate').click();
   await p.waitForFunction(()=>document.querySelector('#generate').textContent==='Drive generated area');
   await p.locator('#generate').click();await p.waitForFunction(()=>document.querySelector('#menu-panel').hidden&&!earthLab.state.loading);
   assert(p.url().includes(b.id));assert.equal(await p.evaluate(()=>document.activeElement.id),'world');
   const before=await p.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await p.keyboard.down('ArrowUp');await p.waitForTimeout(900);await p.keyboard.up('ArrowUp');
   const moved=await p.evaluate(([x,y])=>Math.hypot(earthLab.car.x-x,earthLab.car.y-y)/10,before);assert(moved>.1);
   await p.keyboard.press('KeyP');const stopped=await p.evaluate(()=>[earthLab.car.x,earthLab.car.y]);await p.waitForTimeout(200);
   assert.deepEqual(await p.evaluate(()=>[earthLab.car.x,earthLab.car.y]),stopped);await p.keyboard.press('KeyP');await p.keyboard.press('KeyR');
   await p.reload();await p.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);
   report.selections.push({id:b.id,requested:targets[i],actual:await p.evaluate(()=>earthLab.scene.origin),movedMetres:moved,tiles:await p.evaluate(()=>earthLab.state.renderedTiles),patches:await p.evaluate(()=>earthLab.state.bridgePatches),pauseRecoveryReload:true});
   await p.locator('#hide-menu').click();await p.screenshot({path:path.join(__dirname,'web/reviews',i?'oberbaum-repaired.png':'schlesische-strasse-repaired.png')});
  }
  assert.equal(fallbacks,0);report.fallbackRequests=fallbacks;
  // Deterministic input clock for mapped deck driving; initial spawn/heading only.
  await p.addInitScript(()=>{
   window.testNow=1000;performance.now=()=>testNow;let id=0;const callbacks=new Map();
   requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};
   window.frame=()=>{testNow+=1000/60+1e-7;const pending=[...callbacks.values()];callbacks.clear();for(const cb of pending)cb(testNow);};
  });
  await p.reload();await p.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
  report.traversals=await p.evaluate(()=>{
   const decks=earthLab.scene.surface_network.surfaces.filter(s=>s.kind==='deck'&&s.source_ids.some(id=>['4686103','4686104'].includes(id)));
   if(decks.length!==2)throw Error('Both mapped Oberbaum carriageways are required');
   const results=[];
   for(const deck of decks){
    const a=deck.points[0],b=deck.points.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]),tx=(b[0]-a[0])/length,ty=(b[1]-a[1])/length;
    const project=p=>(p[0]-a[0])*tx+(p[1]-a[1])*ty;
    let intervals=[[10,length-10]];
    for(const part of deck.blocked_parts||[]){
     const stations=part[0].map(project),lo=Math.min(...stations)-8,hi=Math.max(...stations)+8;
     intervals=intervals.flatMap(([x,y])=>hi<x||lo>y?[[x,y]]:[[x,Math.min(y,lo)],[Math.max(x,hi),y]].filter(([x,y])=>y-x>12));
    }
    if(intervals.length<2)throw Error('Both sides of the blocked mapped structure must remain driveable');
    for(const [begin,end]of intervals)for(const kind of ['GT','F1','Bubble','Truck'])for(const direction of [-1,1]){
    document.querySelector('#vehicle').value=kind;
    const start=direction>0?begin:end,target=direction>0?end:begin;
    earthLab.spawn([a[0]+start*tx,a[1]+start*ty],deck.id);
    const car=earthLab.car,body=car.physics.planckBody,angle=Math.atan2(direction*ty,direction*tx);
    car.angle=angle;body.setTransform(planck.Vec2(car.x/30,car.y/30),angle);
    let count=0,wrongLevel=false;dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));
    while(direction*((car.x/10-a[0])*tx+(car.y/10-a[1])*ty-target)<0&&count++<1800){frame();if(car.surfaceId!==deck.id)wrongLevel=true;}
    dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',bubbles:true}));
    results.push({surface:deck.id,kind,direction,segment:[begin,end],width:deck.width,completed:count<1800,wrongLevel,bodyPreserved:body===earthLab.car.physics.planckBody,recoveries:earthLab.state.recoveries});
    }
   }
   return results;
  });
  assert.equal(report.traversals.length,32);report.buildingPassage='Mapped structure remains blocked; these are separate road stretches, not full bridge traversals';
  for(const r of report.traversals){assert(r.completed,JSON.stringify(r));assert(!r.wrongLevel,JSON.stringify(r));assert(r.bodyPreserved);assert.equal(r.recoveries,0);}
  assert.deepEqual(report.errors,[]);report.finished_utc=new Date().toISOString();
  fs.writeFileSync(path.join(__dirname,'oberbaum-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
