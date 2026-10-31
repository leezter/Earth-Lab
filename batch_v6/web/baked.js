export class DistrictRenderer {
 constructor(scene){this.cache=new Map();this.buildMs=[];this.controller=new AbortController();this.errors=[];this.ready=Promise.all(Array.from({length:9},async(_,i)=>{const x=i%3,y=Math.floor(i/3);try{const response=await fetch(`${scene.bake.tile_url}${x}_${y}.webp`,{signal:this.controller.signal});if(!response.ok)throw Error('Missing baked tile');const image=await createImageBitmap(await response.blob());if(this.controller.signal.aborted){image.close();return;}this.cache.set(`${x},${y}`,image);}catch(e){this.errors.push(e.message);throw e;}}));}
 dispose(){this.controller.abort();for(const image of this.cache.values())image.close();this.cache.clear();}
 draw(ctx){ctx.fillStyle='#807f71';ctx.fillRect(-96,-96,192,192);for(const [key,image]of this.cache){const[x,y]=key.split(',').map(Number);ctx.drawImage(image,-96+x*64,-96+y*64,64.015,64.015);}}
}
