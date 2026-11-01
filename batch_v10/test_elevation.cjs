const assert=require('assert/strict'),fs=require('fs'),path=require('path'),cp=require('child_process'),{pathToFileURL}=require('url');
(async()=>{
 const python=process.env.EARTH_PYTHON||path.join(process.env.LOCALAPPDATA,'Programs/BeamNG.Earth.Berlin.Realism/.venv/Scripts/python.exe');
 const prepare="import sys,json;from pathlib import Path;root=Path(sys.argv[1]);sys.path.insert(0,str(root));sys.path.insert(0,str(root.parent));from fixtures import scene;cache=root/'cache';cache.mkdir(exist_ok=True);(cache/'test-fixtures.json').write_text(json.dumps({n:scene(n)['scene']for n in ('overpass','hills','flat')}))";
 cp.execFileSync(python,['-c',prepare,__dirname],{cwd:path.dirname(__dirname)});
 const base=pathToFileURL(path.join(__dirname,'web/elevation.js')).href;
 const {ElevationSystem,profileAt,terrainHeight,vehicleHeights}=await import(base);
 const {verticalOverlap,obstacleInterval}=await import(pathToFileURL(path.join(__dirname,'web/bridge-collision.js')).href);
 const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'cache/test-fixtures.json'),'utf8'));
 const e=new ElevationSystem(fixtures.overpass);
 assert.equal(e.resolve(0,0,'lower').id,'lower');assert.equal(e.resolve(0,0,'lower').z,0);
 assert.equal(e.resolve(0,0,'bridge-fixture').id,'bridge-fixture');assert.equal(e.resolve(0,0,'bridge-fixture').z,5.05);
 assert.equal(e.resolve(0,0,'terrain').id,'lower','XY overlap must not select the deck');
 assert.equal(e.resolve(0,10,'bridge-fixture').supported,false,'Unprotected elevated edge');
 const bank=structuredClone(fixtures.flat);
 bank.terrain={origin:[-30,-20],step:2,embankments:[],heights:Array.from({length:21},()=>Array.from({length:31},(_,i)=>i*2-30<=0?.14*(i*2-30):-6))};
 const box=(x0,x1)=>[[[[x0,-6],[x1,-6],[x1,6],[x0,6],[x0,-6]]]];
 bank.roads=box(-20,0);bank.water=[];
 bank.surface_network={surfaces:[
  {id:'bank',kind:'ground',points:[[-20,0],[0,0]],nodes:['outer','join'],width:12,parts:box(-20,0),profile:[[0,-2.8],[20,0]],connections:['deck']},
  {id:'deck',kind:'deck',points:[[0,0],[20,0]],nodes:['join','far'],width:12,parts:box(0,20),profile:[[0,0],[20,0]],connections:['bank']}
 ],obstacles:[]};
 const slopeJoin=new ElevationSystem(bank),rear=slopeJoin.resolve(-2.9,0,'deck');
 assert(rear.supported,'Rear wheels on a sloped bank must connect to a flat deck');assert.equal(rear.id,'bank');assert(Math.abs(rear.z+.406)<1e-6);
 assert(slopeJoin.supportFootprint({x:2,y:0,angle:0,length:60,width:29,colliderLength:58,colliderWidth:22,surfaceId:'deck'},10));
 const loop=structuredClone(bank);loop.surface_network.surfaces[0]={...loop.surface_network.surfaces[0],points:[[0,0],[0,30],[30,30],[30,0]],nodes:['join','outer'],parts:[[[[24,-6],[36,-6],[36,30],[24,30],[24,-6]]]],profile:[[0,0],[90,-8]]};
 assert.equal(new ElevationSystem(loop).resolve(30,7,'deck').supported,false,'A connected road far from its shared endpoint cannot receive an elevated-edge transfer');
 const turn=structuredClone(bank),ribbon=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len*6,ny=dx/len*6;return [[[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny],[a[0]+nx,a[1]+ny]]]];};
 turn.surface_network.surfaces[0]={...turn.surface_network.surfaces[0],points:[[-15,13.4],[0,0]],parts:ribbon([-15,13.4],[0,0]),profile:[[0,-2.8],[Math.hypot(15,13.4),0]]};
 turn.surface_network.surfaces[1]={...turn.surface_network.surfaces[1],points:[[0,0],[16.6,-11.1]],parts:ribbon([0,0],[16.6,-11.1]),profile:[[0,0],[Math.hypot(16.6,11.1),0]]};
 turn.roads=turn.surface_network.surfaces[0].parts;
 assert(new ElevationSystem(turn).resolve(-.48,-.62,'deck').supported,'A thin wedge between connected butt caps must not eject a rear wheel');
 const camber=structuredClone(fixtures.hills);delete camber.terrain.surface_grid;
 camber.terrain.heights=camber.terrain.heights.map((row,iy)=>row.map((_,ix)=>.18*(camber.terrain.origin[0]+ix*camber.terrain.step)+.24*(camber.terrain.origin[1]+iy*camber.terrain.step)));
 assert(new ElevationSystem(camber).supportFootprint({x:0,y:0,angle:0,length:60,width:29,surfaceId:'hill-road'},10),'A long vehicle on a continuous hillside must not fail an arbitrary body-height threshold');
 let id='approach-a';const visited=new Set();
 for(let x=-75;x<=75;x+=.25){const c=e.resolve(x,0,id);assert(c.supported);id=c.id;visited.add(id);}
 assert.deepEqual([...visited],['approach-a','bridge-fixture','approach-b']);
 let reverse='approach-b';for(let x=75;x>=-75;x-=.25){const c=e.resolve(x,0,reverse);assert(c.supported);reverse=c.id;}
 assert.equal(reverse,'approach-a');
 const hills=new ElevationSystem(fixtures.hills),flat=new ElevationSystem(fixtures.flat);
 assert(Math.abs(hills.resolve(0,0,'hill-road').gx-.08)<1e-9);
 assert.equal(flat.resolve(0,0,'hill-road').gx,0);
 assert(Math.abs(terrainHeight(fixtures.hills.terrain,50,0)-4)<1e-9);
 assert.equal(verticalOverlap(0,vehicleHeights.Truck,5.05,6.15),false);
 assert.equal(verticalOverlap(5.05,6.55,5.05,6.15),true);
 const rail=fixtures.overpass.surface_network.obstacles.find(o=>o.kind==='rail'&&o.surface_id==='bridge-fixture');
 assert.deepEqual(obstacleInterval(rail,0,0,e.terrain),[5,6.15]);
 const car={kind:'GT',length:45,width:24,x:600,y:0,angle:0,surfaceId:'approach-a',physics:{planckBody:{}}};
 const body=car.physics.planckBody;
 assert.equal(e.afterStep(car,{x:-600,y:0,angle:0,surfaceId:'approach-a',z:1},10),true);
 assert.equal(car.surfaceId,'approach-b');assert.equal(car.physics.planckBody,body);
 for(let y=-60;y<=60;y+=.5)assert.equal(e.resolve(0,y,'lower').id,'lower');
 let reset=0;global.window={planck:{Vec2:(x,y)=>({x,y})}};
 const danger={kind:'GT',length:45,width:24,x:0,y:100,angle:0,surfaceId:'bridge-fixture',
  safePose:{x:0,y:0,angle:0,surfaceId:'bridge-fixture',z:5.05},physics:{planckBody:{setTransform(){reset++},setLinearVelocity(){},setAngularVelocity(){}}}};
 assert.equal(e.afterStep(danger,danger.safePose,10),false);assert.equal(danger.surfaceId,'bridge-fixture');assert.equal(danger.y,0);assert.equal(reset,1);
 console.log('Surface selection, both directions, swept transitions, slope, collision height and recovery tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
