// Mapped bank -> deck -> opposite bank, using keyboard throttle/brake/steering only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const root=__dirname,url='http://127.0.0.1:47852',identity=JSON.parse(fs.readFileSync(path.join(root,'freeze.json'))).id;
 const sites=(await(await fetch(url+'/api/sites')).json()).filter(s=>s.renderer_freeze===identity&&s.status==='built'&&s.name.includes('deck portals'));
 assert.equal(sites.length,2,'Both mapped generation cases must finish');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={renderer:identity,sites:[],errors:[],scope:'Actual mapped bank/deck transitions; initial pose only, ordinary keyboard controls thereafter'};
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>report.errors.push(e.message));
  await p.addInitScript(()=>{let now=1000,id=0;const callbacks=new Map();performance.now=()=>now;requestAnimationFrame=cb=>{callbacks.set(++id,cb);return id;};window.frame=()=>{now+=1000/60+1e-7;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(now));};});
  for(const site of sites){
   await p.goto(url+'/?site='+site.id);await p.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading,{},{polling:50});
   const results=await p.evaluate(()=>{
    const surfaces=earthLab.scene.surface_network.surfaces,byId=new Map(surfaces.map(s=>[s.id,s]));
    const key=(code,on)=>dispatchEvent(new KeyboardEvent(on?'keydown':'keyup',{code,bubbles:true}));
    function edge(deck,index){
     const node=deck.nodes[index],bank=deck.connections.map(id=>byId.get(id)).find(s=>s.kind!=='deck'&&s.nodes.includes(node));
     if(!bank)return null;
     const line=bank.nodes[0]===node?bank.points:bank.points.slice().reverse();let left=6,points=[line[0]];
     for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length>=left){points.push([a[0]+(b[0]-a[0])*left/length,a[1]+(b[1]-a[1])*left/length]);break;}points.push(b);left-=length;}
     return {bank,points};
    }
    function projection(line,x,y){let best=null,station=0;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<1e-6)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(l*l))),px=a[0]+t*dx,py=a[1]+t*dy,d=Math.hypot(x-px,y-py);if(!best||d<best.d)best={d,station:station+t*l,x:px,y:py,tx:dx/l,ty:dy/l};station+=l;}return best;}
    const results=[];
    for(const deck of surfaces.filter(s=>s.kind==='deck')){
     const first=edge(deck,0),last=edge(deck,1);if(!first||!last)continue;
     const full=[...first.points.slice().reverse(),...deck.points.slice(1),...last.points.slice(1)];
     if(full.some(p=>Math.max(Math.abs(p[0]),Math.abs(p[1]))>79))continue;
     for(const kind of ['GT','F1','Bubble','Truck'])for(const reverse of [false,true]){
      const line=reverse?full.slice().reverse():full,enter=reverse?last.bank:first.bank,exit=reverse?first.bank:last.bank;
      document.querySelector('#vehicle').value=kind;earthLab.spawn(line[0],enter.id);
      const car=earthLab.car,body=car.physics.planckBody,angle=Math.atan2(line[1][1]-line[0][1],line[1][0]-line[0][0]);car.angle=angle;body.setTransform(planck.Vec2(car.x/30,car.y/30),angle);
      const before=earthLab.state.recoveries,visited=new Set([car.surfaceId]);let length=0;for(let i=1;i<line.length;i++)length+=Math.hypot(line[i][0]-line[i-1][0],line[i][1]-line[i-1][1]);
      let frames=0,progress=0;
      while(frames++<2400){
       const q=projection(line,car.x/10,car.y/10);progress=q.station;if(progress>=length-.5)break;
       const cross=-(car.x/10-q.x)*q.ty+(car.y/10-q.y)*q.tx,desired=Math.atan2(q.ty,q.tx)-Math.atan(cross*.25),error=Math.atan2(Math.sin(desired-car.angle),Math.cos(desired-car.angle));
       const speed=Math.hypot(car.vx||0,car.vy||0)/10;
       key('KeyW',speed<10);key('KeyS',speed>12);key('KeyD',error>.012);key('KeyA',error<-.012);frame();visited.add(car.surfaceId);
      }
      for(const code of ['KeyW','KeyS','KeyD','KeyA'])key(code,false);
      results.push({deck:deck.id,kind,reverse,completed:progress>=length-.5,progress,length,visited:[...visited],expected:[enter.id,deck.id,exit.id],recoveries:earthLab.state.recoveries-before,bodyPreserved:body===earthLab.car.physics.planckBody,final:[car.x/10,car.y/10]});
     }
    }
    return results;
   });
   assert(results.length>=8,'At least one complete mapped bank/deck route required per site');
   report.sites.push({id:site.id,name:site.name,results});
   fs.writeFileSync(path.join(root,'bridge-portals-driving.json'),JSON.stringify(report,null,2));
   for(const r of results){assert(r.completed,JSON.stringify(r));assert(r.bodyPreserved);assert.equal(r.recoveries,0,JSON.stringify(r));for(const id of r.expected)assert(r.visited.includes(id),JSON.stringify(r));}
   if(site.name.startsWith('Oberbaum')){
    const visibility=await p.evaluate(()=>{
     const decks=earthLab.scene.surface_network.surfaces.filter(s=>s.kind==='deck'),owner=decks.find(s=>s.structure_parts),peer=decks.find(s=>s.id!==owner.id);
     function bluePixels(){
      const car=earthLab.car,canvas=document.querySelector('#world'),zoom=Math.max(+document.querySelector('#zoom').value,innerWidth/180,innerHeight/180),x=car.x/10,y=car.y/10;
      const cx=Math.max(-96+innerWidth/zoom/2,Math.min(96-innerWidth/zoom/2,x)),cy=Math.max(-96+innerHeight/zoom/2,Math.min(96-innerHeight/zoom/2,y));
      const dpr=Math.min(devicePixelRatio,2),px=(innerWidth/2+(x-cx)*zoom)*dpr,py=(innerHeight/2+(y-cy)*zoom)*dpr,r=Math.ceil(24*dpr),data=canvas.getContext('2d').getImageData(Math.round(px-r),Math.round(py-r),r*2,r*2).data;
      let count=0;for(let i=0;i<data.length;i+=4)if(data[i+2]>70&&data[i+2]>data[i]*1.8&&data[i+2]>data[i+1]*1.25)count++;return count;
     }
     document.querySelector('#vehicle').value='GT';earthLab.spawn(null,owner.id);
     // Initial pose for the rendering probe only; route tests above use controls.
     const a=peer.points[0],b=peer.points.at(-1),c=earthLab.car;
     c.x=(a[0]+(b[0]-a[0])*.73)*10;c.y=(a[1]+(b[1]-a[1])*.73)*10;
     c.physics.planckBody.setTransform(planck.Vec2(c.x/30,c.y/30),c.angle);for(let i=0;i<40;i++)frame();
     const sharedDeck=bluePixels();
     const bank=owner.connections.map(id=>earthLab.elevation.surfaces.get(id)).find(s=>s.kind!=='deck');
     const node=owner.nodes.find(n=>bank.nodes.includes(n)),points=bank.nodes[0]===node?bank.points:bank.points.slice().reverse(),a0=points[0],b0=points[1],l=Math.hypot(b0[0]-a0[0],b0[1]-a0[1]),t=Math.min(6,l)/l;
     earthLab.spawn([a0[0]+t*(b0[0]-a0[0]),a0[1]+t*(b0[1]-a0[1])],bank.id);for(let i=0;i<40;i++)frame();
     const bankPortal=bluePixels();
     const building=earthLab.scene.buildings.find(b=>b.bridge_passage),ring=building.bridge_passage.parts[0][0],x=ring.reduce((s,p)=>s+p[0],0)/ring.length,y=ring.reduce((s,p)=>s+p[1],0)/ring.length;
     earthLab.spawn([x,y],owner.id);for(let i=0;i<40;i++)frame();
     return {sharedDeck,bankPortal,underRoof:bluePixels()};
    });
    report.sites.at(-1).visibility=visibility;assert(visibility.sharedDeck>10,JSON.stringify(visibility));assert(visibility.bankPortal>10,JSON.stringify(visibility));assert.equal(visibility.underRoof,0,JSON.stringify(visibility));
   }
   await p.evaluate(()=>{document.querySelector('#vehicle').value='GT';earthLab.spawn();for(let i=0;i<40;i++)frame();});await p.locator('#hide-menu').click();
   await p.screenshot({path:path.join(root,'web/reviews',site.name.startsWith('Oberbaum')?'bridge-portals-oberbaum.png':'bridge-portals-hornsey.png')});
  }
  assert.deepEqual(report.errors,[]);report.finished_utc=new Date().toISOString();fs.writeFileSync(path.join(root,'bridge-portals-driving.json'),JSON.stringify(report,null,2));console.log(report.sites.map(s=>({id:s.id,routes:s.results.length})));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
