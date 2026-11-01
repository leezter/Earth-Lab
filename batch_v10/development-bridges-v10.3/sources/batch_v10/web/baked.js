import {profileAt} from './elevation.js';
export class DistrictRenderer{
 constructor(scene){
  this.scene=scene;this.cache=new Map();this.patches=new Map();this.controller=new AbortController();this.atlas=null;this.decodedBytes=0;
  const load=async(url)=>{
   const r=await fetch(url,{signal:this.controller.signal});if(!r.ok)throw Error('Missing baked image: '+url);
   return createImageBitmap(await r.blob());
  };
  this.ready=Promise.all([
   ...Array.from({length:9},async(_,i)=>{
    const x=i%3,y=Math.floor(i/3),im=await load(`${scene.bake.tile_url}${x}_${y}.webp`);
    if(this.controller.signal.aborted){im.close();return;}
    if(im.width!==2048||im.height!==2048){im.close();throw Error('Invalid ground tile dimensions');}
    this.cache.set(`${x},${y}`,im);
   }),
   ...(scene.bake.patches||[]).map(async patch=>{
    const im=await load(scene.bake.tile_url+patch.name);
    if(this.controller.signal.aborted){im.close();return;}
    if(im.width!==patch.width||im.height!==patch.height){im.close();throw Error('Invalid bridge pass dimensions');}
    this.patches.set(patch.id,{...patch,image:im});
   })
  ]).then(()=>{
   if(this.controller.signal.aborted)return;
   const atlas=document.createElement('canvas');atlas.width=atlas.height=6144;const ctx=atlas.getContext('2d');
   for(const [key,im]of this.cache){const [x,y]=key.split(',').map(Number);ctx.drawImage(im,x*2048,y*2048);im.close();this.cache.set(key,{ready:true});}
   this.atlas=atlas;this.decodedBytes=6144*6144*4+[...this.patches.values()].reduce((n,p)=>n+p.width*p.height*4,0);
  }).catch(e=>{this.dispose();throw e;});
 }
 draw(ctx){ctx.fillStyle='#807f71';ctx.fillRect(-96,-96,192,192);if(this.atlas)ctx.drawImage(this.atlas,-96,-96,192,192);}
 drawDecks(ctx,car,above){
  for(const p of this.patches.values()){
   const s=this.scene.surface_network.surfaces.find(s=>s.id===p.id),height=profileAt(s,car.x/10,car.y/10).z;
   if((car.surfaceId!==p.id&&height>car.z+.15)!==above)continue;
   const [x0,y0,x1,y1]=p.bounds;ctx.drawImage(p.image,x0,y0,x1-x0,y1-y0);
  }
 }
 drawRails(ctx,car){
  for(const ob of this.scene.surface_network.obstacles){
   if(ob.kind!=='rail'||ob.surface_id!==car.surfaceId)continue;
   ctx.beginPath();ctx.moveTo(...ob.a);ctx.lineTo(...ob.b);ctx.lineWidth=.22;ctx.strokeStyle='#b3b3a5';ctx.stroke();
  }
 }
 dispose(){
  this.controller.abort();for(const im of this.cache.values())im.close?.();this.cache.clear();
  for(const p of this.patches.values())p.image.close();this.patches.clear();
  if(this.atlas){this.atlas.width=this.atlas.height=1;this.atlas=null;}this.decodedBytes=0;
 }
}
