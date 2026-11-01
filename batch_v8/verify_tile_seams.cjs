const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.EARTH_PLAYWRIGHT||'C:/Users/leezt/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:47850/gallery.html');
  const result=await page.evaluate(async()=>{
   const {DistrictRenderer}=await import('/baked.js');
   const blobs=[];let requests=0;
   for(let y=0;y<3;y++)for(let x=0;x<3;x++){
    const tile=document.createElement('canvas');tile.width=tile.height=4;
    const c=tile.getContext('2d');c.fillStyle=`rgb(${x*80},${y*80},100)`;c.fillRect(0,0,4,4);
    blobs.push(await new Promise(resolve=>tile.toBlob(resolve)));
   }
   const original=window.fetch;
   window.fetch=async(url,options)=>{
    if(!String(url).startsWith('/seam-fixture/'))return original(url,options);
    const match=String(url).match(/(\d)_(\d)\.webp$/);requests++;
    return new Response(blobs[Number(match[2])*3+Number(match[1])]);
   };
   const renderer=new DistrictRenderer({bake:{tile_url:'/seam-fixture/'}});
   try{
    await renderer.ready;
    // A known continuous reference raster, sampled once at a fractional zoom.
    const reference=document.createElement('canvas');reference.width=reference.height=6144;
    const rc=reference.getContext('2d');
    for(let i=0;i<9;i++){const bitmap=await createImageBitmap(blobs[i]);rc.drawImage(bitmap,(i%3)*2048,Math.floor(i/3)*2048,2048,2048);bitmap.close();}
    const frames=[];
    for(const kind of ['actual','reference']){
     const canvas=document.createElement('canvas');canvas.width=canvas.height=640;
     const context=canvas.getContext('2d',{willReadFrequently:true});context.translate(320.27,320.41);context.scale(3.137,3.137);
     if(kind==='actual')renderer.draw(context);
     else{context.fillStyle='#807f71';context.fillRect(-96,-96,192,192);context.drawImage(reference,-96,-96,192,192);}
     frames.push(context.getImageData(0,0,640,640).data);
    }
    let maxDelta=0;for(let i=0;i<frames[0].length;i++)maxDelta=Math.max(maxDelta,Math.abs(frames[0][i]-frames[1][i]));
    if(maxDelta!==0)throw Error('Tile joins differ from the continuous reference raster: '+maxDelta);
    if(requests!==9||renderer.cache.size!==9)throw Error('Expected nine source tiles');
    reference.width=reference.height=1;renderer.dispose();
    if(renderer.cache.size||renderer.atlas)throw Error('Scene disposal retained tile resources');
    return {sourceTiles:requests,fractionalZoom:3.137,maxPixelDelta:maxDelta,disposal:true};
   }finally{window.fetch=original;renderer.dispose();}
  });
  assert.equal(result.maxPixelDelta,0);
  const report={checked_utc:new Date().toISOString(),...result,
   viewer_source_sha256:require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'web/baked.js'))).digest('hex')};
  fs.writeFileSync(path.join(__dirname,'tile-seam-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
