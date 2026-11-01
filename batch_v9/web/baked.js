export class DistrictRenderer {
 constructor(scene){
  this.cache=new Map();this.buildMs=[];this.controller=new AbortController();this.errors=[];this.atlas=null;
  this.ready=Promise.all(Array.from({length:9},async(_,i)=>{
   const x=i%3,y=Math.floor(i/3);
   try{
    const response=await fetch(`${scene.bake.tile_url}${x}_${y}.webp`,{signal:this.controller.signal});
    if(!response.ok)throw Error('Missing baked tile');
    const image=await createImageBitmap(await response.blob());
    if(this.controller.signal.aborted){image.close();return;}
    this.cache.set(`${x},${y}`,image);
   }catch(e){this.errors.push(e.message);throw e;}
  })).then(()=>{
   if(this.controller.signal.aborted)return;
   const atlas=document.createElement('canvas');atlas.width=atlas.height=6144;
   const context=atlas.getContext('2d');
   for(const [key,image]of this.cache){
    const[x,y]=key.split(',').map(Number);
    context.drawImage(image,x*2048,y*2048,2048,2048);
    image.close();this.cache.set(key,{x,y,ready:true});
   }
   // One shared sampling grid avoids independently rounded/stretched tile edges.
   // Release decoded tiles so the atlas replaces their steady-state allocation.
   this.atlas=atlas;
  });
 }
 dispose(){this.controller.abort();for(const image of this.cache.values())image.close?.();this.cache.clear();if(this.atlas){this.atlas.width=this.atlas.height=1;this.atlas=null;}}
 draw(ctx){ctx.fillStyle='#807f71';ctx.fillRect(-96,-96,192,192);if(this.atlas)ctx.drawImage(this.atlas,-96,-96,192,192);}
}
