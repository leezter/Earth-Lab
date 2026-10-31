const assert=require('assert/strict'),{pathToFileURL}=require('url'),path=require('path');
(async()=>{
 const {clearSpawn}=await import(pathToFileURL(path.join(__dirname,'web/spawn.js')).href);
 const roads=[{drive:true,width:7,lines:[[[-60,0],[60,0]]]}];
 const obstacle=(x0,y0,x1,y1)=>({id:'boundary',parts:[[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]]});
 const clear=clearSpawn(roads,[],0,0,4.5,2.4);assert.equal(clear.x,0);
 const shifted=clearSpawn(roads,[obstacle(-.2,-8,.2,8)],0,0,4.5,2.4);assert(shifted&&Math.abs(shifted.x)>3.5,'Recovery must clear a boundary across the road');
 assert.equal(clearSpawn(roads,[obstacle(-80,-80,80,80)],0,0,4.5,2.4),null,'No car-sized space must produce a clean spawn failure');
 const gap=clearSpawn(roads,[obstacle(-.2,-8,.2,-2),obstacle(-.2,2,.2,8)],0,0,4.5,2.4);assert.equal(gap.x,0,'A sufficiently wide gate opening stays usable');
 console.log('PASS 4 spawn/clearance checks');
})().catch(e=>{console.error(e);process.exitCode=1});
