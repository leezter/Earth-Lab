export class DistrictRenderer {
 constructor(){this.cache=new Map();this.buildMs=[];this.errors=[];for(let y=0;y<3;y++)for(let x=0;x<3;x++){const image=new Image();image.onload=()=>this.cache.set(`${x},${y}`,image);image.onerror=()=>this.errors.push(`${x},${y}`);image.src=`/baked/tiles/${x}_${y}.webp`;}}
 draw(ctx){ctx.fillStyle='#807f71';ctx.fillRect(-96,-96,192,192);for(const [key,image]of this.cache){const [x,y]=key.split(',').map(Number);ctx.drawImage(image,-96+x*64,-96+y*64,64.015,64.015);}}
}
