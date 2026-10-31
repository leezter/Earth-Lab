const assert=require('assert/strict'),{pathToFileURL}=require('url'),path=require('path');
(async()=>{
 const {siteGroundAt}=await import(pathToFileURL(path.join(__dirname,'web/ground.js')).href);
 const part=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]];
 const scene=family=>({site_surfaces:{test:[part]},site_report:{materials:{test:{family}}}});
 assert.equal(siteGroundAt(scene('asphalt'),2,2).grip,'asphalt');
 assert.equal(siteGroundAt(scene('asphalt'),5,5),null,'A hole is not a parking surface');
 assert.equal(siteGroundAt(scene('gravel'),2,2).grip,'gravel');
 assert.equal(siteGroundAt(scene('paving_blocks'),2,2).grip,'concrete');
 assert.equal(siteGroundAt(scene('grass'),2,2).grip,'dirt');
 assert.equal(siteGroundAt(scene('asphalt'),20,20),null,'Unknown ground keeps existing behaviour');
 console.log('PASS 6 site grip/hole checks');
})().catch(e=>{console.error(e);process.exitCode=1});
