const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
const url='http://127.0.0.1:47852',sites=await(await fetch(url+'/api/sites')).json(),site=sites.find(s=>s.status==='built');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage();let retryable=false;
 await page.route('**/api/generate',r=>r.fulfill({json:{id:'test-layout'}}));
 await page.route('**/api/job?id=test-layout',r=>r.fulfill({json:{status:'failed',retryable,error:retryable?'Temporary source failure':'Branched elevated junction is not supported. Choose another area.'}}));
 await page.goto(url+'/?site='+site.id);await page.waitForFunction(()=>window.earthLab?.car&&!earthLab.state.loading);
 const select=async()=>{await page.locator('#query').fill('53.726589, -1.860018');await page.locator('#query').press('Enter');await page.locator('#generate').waitFor({state:'visible'});};
 await select();await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#generation').textContent.includes('Branched elevated'));
 assert(await page.locator('#generate').isHidden());assert(!await page.locator('#generation').textContent().then(s=>s.includes('retry generation')));
 assert(await page.evaluate(()=>!!earthLab.car&&!earthLab.state.loading));
 retryable=true;await select();await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#generate').textContent==='Retry generation');assert(await page.locator('#generate').isVisible());
 fs.writeFileSync(path.join(__dirname,'error-ui-verification.json'),JSON.stringify({renderer:JSON.parse(fs.readFileSync(path.join(__dirname,'freeze.json'))).id,unsupportedRetryHidden:true,newSelectionAvailable:true,transientRetryAvailable:true,currentSceneRetained:true,finished_utc:new Date().toISOString()},null,2));
 console.log('Unsupported layout and transient retry browser checks passed');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
