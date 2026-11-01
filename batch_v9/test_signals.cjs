const assert=require('assert/strict'),{pathToFileURL}=require('url'),path=require('path');
(async()=>{
 const {phase,SignalLayer}=await import(pathToFileURL(path.join(__dirname,'web/signals.js')).href);
 for(let t=0;t<48;t+=.1)assert(!(phase(0,t)==='green'&&phase(1,t)==='green'),'Conflicting axes never both green');
 assert.equal(phase(0,0),'green');assert.equal(phase(0,9),'amber');assert.equal(phase(1,13),'green');assert.equal(phase(0,11),'red');assert.equal(phase(1,11),'red');
 const layer=new SignalLayer([{id:'a',kind:'signal',axis:0},{id:'b',kind:'stop'}]);layer.advance(9,false);assert.equal(layer.states()[0].state,'amber');layer.advance(10,true);assert.equal(layer.seconds,9);layer.advance(4,false);assert.equal(layer.states()[0].state,'red');assert.equal(new SignalLayer().seconds,0);
 console.log('PASS signal phase conflicts, transitions, pause and reset');
})().catch(e=>{console.error(e);process.exitCode=1});
