// Guided ordinary control inputs on mapped bridge corridors. These deterministic
// traversals complement (not replace) real-time keyboard/performance checks.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const url='http://127.0.0.1:47852',identity=JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'),'utf8')).id;
 const sites=(await(await fetch(url+'/api/sites')).json()).filter(s=>s.status==='built'&&!s.fixture&&s.acceptance?.patches>0&&s.renderer_freeze===identity);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={renderer:identity,method:'Guided keyboard inputs, deterministic frame clock; no pose changes after spawn',sites:[]};
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.addInitScript(()=>{
   window.testNow=1000;performance.now=()=>testNow;let id=0;const callbacks=new Map();
   requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};cancelAnimationFrame=id=>callbacks.delete(id);
   window.testFrame=now=>{const pending=[...callbacks.values()];callbacks.clear();for(const callback of pending)callback(now);};
  });
  for(const site of sites){
   await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
   const results=await page.evaluate(async()=>{
    const {projectLine}=await import('./elevation.js');
    const {containsPart}=await import('./ground.js');
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const intersects=(a,b,c,d)=>{
     if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
     return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
    };
    const underDeck=(car,parts)=>{
     const cs=Math.cos(car.angle),sn=Math.sin(car.angle),l=car.length/20,w=car.width/20;
     const rect=[[-l,-w],[l,-w],[l,w],[-l,w]].map(([a,b])=>[car.x/10+a*cs-b*sn,car.y/10+a*sn+b*cs]);rect.push(rect[0]);
     for(const part of parts){
      if(rect.some(p=>containsPart(p,part))||part[0].some(p=>containsPart(p,[rect])))return true;
      for(const ring of part)for(let i=1;i<ring.length;i++)for(let j=1;j<rect.length;j++)if(intersects(ring[i-1],ring[i],rect[j-1],rect[j]))return true;
     }
     return false;
    };
    const system=earthLab.elevation,originalAfter=system.afterStep.bind(system);
    system.afterStep=(car,before,units)=>{
     const centre=system.resolve(car.x/units,car.y/units,car.surfaceId),cs=Math.cos(car.angle),sn=Math.sin(car.angle);
     const l=(car.colliderLength||car.length)/units/2,w=(car.colliderWidth||car.width)/units/2;
     const corners=[[l,-w],[l,w],[-l,w],[-l,-w]].map(([a,b])=>{
      const x=car.x/units+a*cs-b*sn,y=car.y/units+a*sn+b*cs,c=system.resolve(x,y,centre.id);
      return {x,y,id:c.id,z:c.z,supported:c.supported};
     });
     const proposal={x:car.x/units,y:car.y/units,angle:car.angle,id:car.surfaceId,centre:{id:centre.id,z:centre.z,supported:centre.supported},corners};
     const ok=originalAfter(car,before,units);if(!ok)window.lastCorridorFailure=proposal;return ok;
    };
    const at=(points,station)=>{
     for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(station<=length)return [a[0]+(b[0]-a[0])*station/length,a[1]+(b[1]-a[1])*station/length];station-=length;}
     return points.at(-1);
    };
    const length=points=>points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
    const routes=[];window.croppedBelowRoutes=[];
    for(const record of earthLab.scene.bridge_report.records){
     const deck=earthLab.elevation.surfaces.get(record.id);if(!deck)continue;
     let points=deck.points.map(p=>[...p]),startSurface=deck.id,endSurface=deck.id;
     for(const side of [0,1]){
      const node=deck.nodes[side],endpoint=deck.points[side?deck.points.length-1:0],inner=deck.points[side?deck.points.length-2:1];
      const dx=endpoint[0]-inner[0],dy=endpoint[1]-inner[1];let best=null;
      for(const id of deck.connections){
       const other=earthLab.elevation.surfaces.get(id);if(!other?.nodes.includes(node))continue;
       const total=length(other.points),distance=Math.min(8,total-.1);if(distance<4)continue;
       const p=at(other.points,other.nodes[0]===node?distance:total-distance),vx=p[0]-endpoint[0],vy=p[1]-endpoint[1];
       const alignment=(vx*dx+vy*dy)/Math.max(1e-9,Math.hypot(vx,vy)*Math.hypot(dx,dy));
       if(alignment>.75&&(!best||alignment>best.alignment))best={point:p,id:other.id,alignment};
      }
      if(best){if(side){points.push(best.point);endSurface=best.id;}else{points.unshift(best.point);startSurface=best.id;}}
     }
     const lineLength=length(points),valid=[];
     for(let s=4;s<lineLength-3;s+=1){const p=at(points,s);if(Math.max(...p.map(Math.abs))<70)valid.push(s);}
     if(valid.length>=8)routes.push({id:deck.id,kind:'deck',points,start:valid[0],end:valid.at(-1),startSurface,endSurface});
     for(const crossing of record.crossings){
      const lower=earthLab.elevation.surfaces.get(crossing.surface_id);if(!lower)continue;
      let belowPoints=lower.points.map(p=>[...p]),startSurface=lower.id,endSurface=lower.id;
      const allowed=new Set([lower.id]);
      for(const side of [0,1]){
       let current=lower;
       for(let hop=0;hop<3;hop++){
        const endpoint=side?belowPoints.at(-1):belowPoints[0],inner=side?belowPoints.at(-2):belowPoints[1];
        const node=current.nodes.find(n=>{const p=current.points[current.nodes[0]===n?0:current.points.length-1];return Math.hypot(p[0]-endpoint[0],p[1]-endpoint[1])<.05;});
        if(!node)break;let best=null;
        for(const id of current.connections){const next=earthLab.elevation.surfaces.get(id);if(!next||allowed.has(id)||!next.nodes.includes(node)||(next.kind==='deck')!==(lower.kind==='deck'))continue;
         const oriented=next.nodes[0]===node?next.points:[...next.points].reverse(),p=at(oriented,Math.min(5,length(oriented)));
         const dx=endpoint[0]-inner[0],dy=endpoint[1]-inner[1],vx=p[0]-endpoint[0],vy=p[1]-endpoint[1],score=(dx*vx+dy*vy)/Math.max(.001,Math.hypot(dx,dy)*Math.hypot(vx,vy));
         if(score>.25&&(!best||score>best.score))best={next,oriented,score};
        }
        if(!best)break;allowed.add(best.next.id);current=best.next;
        if(side){belowPoints.push(...best.oriented.slice(1));endSurface=current.id;}
        else{belowPoints=[...best.oriented.slice(1).reverse(),...belowPoints];startSurface=current.id;}
       }
      }
      let station=projectLine(belowPoints,...crossing.point).station;const total=length(belowPoints),covered=d=>deck.parts.some(p=>containsPart(at(belowPoints,d),p));
      if(!covered(station)){const options=[];for(let d=Math.max(0,station-20);d<=Math.min(total,station+20);d+=.5)if(covered(d))options.push(d);
       if(!options.length){window.croppedBelowRoutes.push({id:lower.id,under:deck.id,reason:'Only carriageway edges overlap; this driving centreline does not pass beneath the deck'});continue;}
       station=options.sort((a,b)=>Math.abs(a-station)-Math.abs(b-station))[0];
      }
      let first=station,last=station;
      while(first>0&&covered(first))first=Math.max(0,first-.5);
      while(last<total&&covered(last))last=Math.min(total,last+.5);
      const start=Math.max(4,first-8),end=Math.min(total-4,last+8),a=at(belowPoints,start),b=at(belowPoints,end);
      if(end-start<8||first-start<5||end-last<5||Math.max(...a.map(Math.abs),...b.map(Math.abs))>=76){window.croppedBelowRoutes.push({id:lower.id,under:deck.id,reason:'Full vehicle entry/clearance extends outside this bounded test crop'});continue;}
      const surfaceAt=p=>[...allowed].find(id=>earthLab.elevation.inside(earthLab.elevation.surfaces.get(id),...p))||lower.id;
      routes.push({id:lower.id,kind:'below',lowerKind:lower.kind,points:belowPoints,start,end,startSurface:surfaceAt(a),endSurface:surfaceAt(b),allowed:[...allowed],deckParts:deck.parts,crossingStation:station});
     }
    }
    const keys=new Set(),key=(code,on)=>{if(keys.has(code)===on)return;if(on)keys.add(code);else keys.delete(code);dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));};
    const results=[];
    for(const route of routes)for(const kind of ['GT','F1','Bubble','Truck'])for(const direction of [1,-1]){
     const start=direction>0?route.start:route.end,target=direction>0?route.end:route.start,p=at(route.points,start),q=at(route.points,start+direction);
     const expectedStart=direction>0?route.startSurface:route.endSurface;
     const preferred=earthLab.elevation.surfaces.get(expectedStart);
     const startId=preferred&&earthLab.elevation.inside(preferred,...p)?expectedStart:route.id;
     document.querySelector('#vehicle').value=kind;earthLab.spawn(p,startId);
     const car=earthLab.car;car.angle=Math.atan2(q[1]-p[1],q[0]-p[0]);car.physics.planckBody.setTransform(planck.Vec2(car.x/30,car.y/30),car.angle);
     car.safePose={x:car.x,y:car.y,angle:car.angle,surfaceId:car.surfaceId,z:car.z};
     const body=car.physics.planckBody,recoveries=earthLab.state.recoveries,visited=new Set([car.surfaceId]);let steps=0,replacements=0,wrongLevel=0,progress=start,seenUnder=false,cleared=false;
     while((route.kind==='below'?!cleared:direction*(target-progress)>.8)&&steps++<5000){
      const x=car.x/10,y=car.y/10,station=projectLine(route.points,x,y).station,speed=Math.hypot(car.vx||0,car.vy||0)/10;
      const look=at(route.points,Math.max(0,Math.min(length(route.points),station+direction*(3+speed*.3))));
      const desired=Math.atan2(look[1]-y,look[0]-x),error=Math.atan2(Math.sin(desired-car.angle),Math.cos(desired-car.angle));
      const targetSpeed=Math.abs(error)>.2?2.5:4;
      key('KeyW',speed<targetSpeed);key('KeyS',speed>targetSpeed+1.5);key('KeyD',error>.015);key('KeyA',error<-.015);
      testNow+=1000/60+1e-7;testFrame(testNow);
      if(car.physics.planckBody!==body||earthLab.car!==car){replacements++;break;}
      if(route.kind==='below'&&route.lowerKind!=='deck'&&earthLab.elevation.surfaces.get(car.surfaceId)?.kind==='deck')wrongLevel++;
      if(route.kind==='below'&&route.lowerKind==='deck'&&!route.allowed.includes(car.surfaceId))wrongLevel++;
      visited.add(car.surfaceId);
      progress=projectLine(route.points,car.x/10,car.y/10).station;
      if(route.kind==='below'){
       const underneath=underDeck(car,route.deckParts);if(underneath)seenUnder=true;
       if(seenUnder&&!underneath&&direction*(progress-route.crossingStation)>0)cleared=true;
      }
      if(earthLab.state.recoveries>recoveries)break;
     }
     for(const code of [...keys])key(code,false);
     results.push({surface:route.id,route:route.kind,kind,direction,steps,progress,target,
      reached:route.kind==='below'?cleared:direction*(target-progress)<=.8,seenUnder,cleared,replacements,wrongLevel,recoveries:earthLab.state.recoveries-recoveries,height:car.z,visited:[...visited],position:[car.x/10,car.y/10],angle:car.angle,speed:Math.hypot(car.vx,car.vy)/10,contact:earthLab.state.surface,failure:earthLab.state.recoveries>recoveries?window.lastCorridorFailure:null});
    }
    return {routes:results,croppedBelowRoutes:window.croppedBelowRoutes};
   });
   report.sites.push({id:site.id,name:site.name,...results});
   fs.writeFileSync(path.join(__dirname,'mapped-route-verification.json'),JSON.stringify(report,null,2));
   for(const r of results.routes){assert(r.reached,site.name+' '+JSON.stringify(r));assert.equal(r.replacements,0);assert.equal(r.wrongLevel,0);assert.equal(r.recoveries,0);}
   console.log(site.name,results.routes.length?results.routes.length+' mapped corridor traversals passed':'No complete bridge corridor within this crop; ordinary driving checked separately');
  }
  report.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(__dirname,'mapped-route-verification.json'),JSON.stringify(report,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
