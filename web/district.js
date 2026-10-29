// Cached, deterministic 2D district artwork. All coordinates are real map metres.
export class DistrictRenderer {
 constructor(scene){this.s=scene;this.cache=new Map();this.patterns=new Map();this.jobs=0;this.buildings=scene.buildings.map(b=>({...b,path:this.path(b.parts),innerPath:this.path(b.inner)}));this.roads=this.path(scene.roads);this.pavements=this.path(scene.pavements);this.green=this.path(scene.green);this.gardens=this.path(scene.gardens);this.water=this.path(scene.water);this.surfaces=Object.fromEntries(Object.entries(scene.surfaces).map(([k,v])=>[k,this.path(v)]));this.buildMs=[];}
 random(seed){let x=seed>>>0;return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
 path(parts){const p=new Path2D();for(const part of parts)for(const ring of part){if(!ring.length)continue;p.moveTo(...ring[0]);for(let i=1;i<ring.length;i++)p.lineTo(...ring[i]);p.closePath();}return p;}
 texture(g,type,color=''){const key=type+color;if(this.patterns.has(key))return this.patterns.get(key);const c=document.createElement('canvas');c.width=c.height=256;const h=c.getContext('2d'),rand=this.random(638193);h.fillStyle=color||({asphalt:'#525858',slate:'#666a6a',tile:'#917060',paving:'#b8b5a6',stone:'#a8a89c',grass:'#727f55',yard:'#999787',water:'#506e70'}[type]||'#848779');h.fillRect(0,0,256,256);
 const noise=type==='grass'?3600:7000;for(let i=0;i<noise;i++){h.fillStyle=rand()>.5?'rgba(255,247,218,.055)':'rgba(20,29,27,.08)';h.fillRect(rand()*256,rand()*256,rand()*2+.5,rand()*2+.5);}
 if(type==='slate'||type==='tile'){const height=type==='slate'?15:12;for(let y=0;y<256;y+=height){h.fillStyle='rgba(20,23,23,.26)';h.fillRect(0,y,256,1);h.fillStyle='rgba(248,235,208,.13)';h.fillRect(0,y+1,256,1);for(let x=-20+(Math.floor(y/height)%2)*12;x<256;x+=24){h.fillStyle='rgba(27,27,25,.24)';h.fillRect(x,y,1,height);h.fillStyle=`rgba(245,232,207,${rand()*.055})`;h.fillRect(x+1,y+2,22,height-3);}}}
 if(type==='paving'){for(let y=0;y<256;y+=64)for(let x=0;x<256;x+=64){h.strokeStyle='#747c7166';h.lineWidth=1.2;h.strokeRect(x+.6,y+.6,63,63);h.strokeStyle='#eee4cc88';h.lineWidth=1;h.strokeRect(x+2,y+2,60,60);h.fillStyle=`rgba(33,40,31,${rand()*.05})`;h.fillRect(x+3,y+3,58,58);}}
 if(type==='stone'){for(let y=0;y<256;y+=18)for(let x=-10+(Math.floor(y/18)%2)*13;x<256;x+=26){h.fillStyle=`hsl(45 5% ${48+rand()*24}%)`;h.fillRect(x+1,y+1,24,16);h.fillStyle='rgba(250,243,220,.18)';h.fillRect(x+2,y+1,22,1);}}
 if(type==='grass'){for(let i=0;i<850;i++){h.strokeStyle=rand()>.5?'#c0bd6d33':'#314b3433';const x=rand()*256,y=rand()*256;h.beginPath();h.moveTo(x,y);h.lineTo(x+1,y-3);h.stroke();}}
 const pattern=g.createPattern(c,'repeat');const scale=({asphalt:3,slate:3,tile:2.4,paving:2.4,stone:2.3,grass:7,yard:4,water:8}[type]||3)/256;pattern.setTransform(new DOMMatrix().scale(scale));this.patterns.set(key,pattern);return pattern;}
 roof(g,b){const [x0,y0,x1,y1]=b.bounds,rand=this.random(b.seed),w=x1-x0,h=y1-y0;
  // A short wall reveal and a restrained common sun direction give volume without changing the driving camera.
  g.save();g.translate(.45,.7);g.fillStyle='#5e615b';g.fill(b.path,'evenodd');g.restore();g.fillStyle='#b4b1a2';g.fill(b.path,'evenodd');
  g.save();g.clip(b.innerPath,'evenodd');const tiled=/tile|hip|gable/.test(b.roof+' '+b.material)||(!b.roof&&b.seed%5===0);let color=b.color&&CSS.supports('color',b.color)?b.color: tiled?['#977768','#9d8170','#8f6c60'][b.seed%3]:['#767b76','#6d7471','#85867c','#676e6b','#8b8a7e'][b.seed%5];const roofPattern=this.texture(g,tiled?'tile':'slate',color);const ring=b.parts[0][0];let longest=0,angle=0;for(let j=1;j<ring.length;j++){const dx=ring[j][0]-ring[j-1][0],dy=ring[j][1]-ring[j-1][1],d=dx*dx+dy*dy;if(d>longest){longest=d;angle=Math.atan2(dy,dx);}}roofPattern.setTransform(new DOMMatrix().rotate(angle*180/Math.PI).scale((tiled?2.4:3)/256));g.fillStyle=roofPattern;g.fillRect(x0-1,y0-1,w+2,h+2);
  const vertical=h>w;const ridge=vertical?(x0+x1)/2:(y0+y1)/2;const shade=g.createLinearGradient(vertical?x0:x0,vertical?y0:y0,vertical?x1:x0,vertical?y0:y1);shade.addColorStop(0,'rgba(242,227,190,.14)');shade.addColorStop(.48,'rgba(255,242,211,.07)');shade.addColorStop(.5,'rgba(30,40,38,.17)');shade.addColorStop(1,'rgba(20,34,33,.07)');g.fillStyle=shade;g.fillRect(x0,y0,w,h);
  if(w>5&&h>5){g.strokeStyle='#333e3c66';g.lineWidth=.17;g.beginPath();g.moveTo(vertical?ridge:x0,vertical?y0:ridge);g.lineTo(vertical?ridge:x1,vertical?y1:ridge);g.stroke();g.strokeStyle='#d0c7b477';g.lineWidth=.08;g.stroke();}
  // Roof fittings are illustrative and repeatable, not claimed as surveyed equipment.
  const count=Math.min(14,Math.max(1,Math.floor(w*h/160)));for(let i=0;i<count;i++){const x=x0+1+rand()*(w-2),y=y0+1+rand()*(h-2);const cp=new DOMPoint(x,y).matrixTransform(g.getTransform());if(!g.isPointInPath(b.innerPath,cp.x,cp.y,'evenodd'))continue;g.fillStyle='#16272744';g.fillRect(x+.22,y+.38,.9,1.1);g.fillStyle='#c7c0ad';g.fillRect(x,y,.8,.9);g.fillStyle='#535c58';g.fillRect(x+.1,y+.13,.6,.55);g.fillStyle='#ddd2ba';g.fillRect(x,y,.8,.1);}
  if(b.seed%4===0&&w>10&&h>10){const x=x0+w*.33,y=y0+h*.38;g.fillStyle='#293f46';g.fillRect(x,y,2.2,3.2);g.strokeStyle='#9aafb088';g.lineWidth=.05;for(let j=0;j<4;j++)g.strokeRect(x,y+j*.8,2.2,.8);}
  g.restore();g.strokeStyle='#303e3b99';g.lineWidth=.11;g.stroke(b.path);g.strokeStyle='#d1cbbb99';g.lineWidth=.1;g.stroke(b.innerPath);
 }
 tree(g,t){const rand=this.random(t.seed);g.save();g.translate(t.x,t.y);g.fillStyle='#1c31283b';g.beginPath();g.ellipse(t.r*.6,t.r*.8,t.r*1.1,t.r*.7,.6,0,Math.PI*2);g.fill();g.fillStyle='#5d6650';g.fillRect(-.12,0,.24,t.r*.5);const base=t.seed%3;for(let i=0;i<17;i++){let a=rand()*Math.PI*2,r=Math.sqrt(rand())*t.r*.6,x=Math.cos(a)*r,y=Math.sin(a)*r,rr=t.r*(.29+rand()*.3);const grad=g.createRadialGradient(x-rr*.3,y-rr*.4,rr*.05,x,y,rr);grad.addColorStop(0,['#a5ad69','#8eaa72','#b3b17a'][base]);grad.addColorStop(.45,['#6f864f','#638257','#7b8a52'][base]);grad.addColorStop(1,'#3c5b43');g.fillStyle=grad;g.beginPath();g.arc(x,y,rr,0,Math.PI*2);g.fill();}g.restore();}
 tile(tx,ty){const start=performance.now(),size=128,pad=14,px=1024,c=document.createElement('canvas');c.width=c.height=px;const g=c.getContext('2d');g.scale(px/size,px/size);g.translate(-tx*size,-ty*size);const x=tx*size,y=ty*size;
  g.fillStyle=this.texture(g,'yard');g.fillRect(x,y,size,size);g.fillStyle=this.texture(g,'grass');g.fill(this.green,'evenodd');g.fill(this.gardens,'evenodd');
  g.fillStyle=this.texture(g,'water');g.fill(this.water,'evenodd');g.strokeStyle='#c5c4a966';g.lineWidth=.6;g.stroke(this.water);
  g.fillStyle=this.texture(g,'paving');g.fill(this.pavements,'evenodd');g.strokeStyle='#747e6b99';g.lineWidth=.12;g.stroke(this.pavements);
  g.save();g.translate(.15,.2);g.strokeStyle='#353f3966';g.lineWidth=.6;g.stroke(this.roads);g.restore();g.fillStyle=this.texture(g,'asphalt');g.fill(this.roads,'evenodd');
  for(const [k,p]of Object.entries(this.surfaces)){g.fillStyle=this.texture(g,k==='cobble'?'stone':k==='concrete'?'paving':k==='dirt'?'yard':'asphalt');g.fill(p,'evenodd');}
  g.strokeStyle='#d9d8c4';g.lineWidth=.21;g.stroke(this.roads);g.strokeStyle='#53605766';g.lineWidth=.08;g.stroke(this.roads);
  // Road paint follows mapped centre lines, with junction endpoints left clear.
  g.save();g.clip(this.roads,'evenodd');g.strokeStyle='#d2cfb48a';g.lineWidth=.1;g.setLineDash([2.8,4.5]);for(const s of this.s.streets){if(s.width<8||s.points.length<2||s.class==='service')continue;g.beginPath();g.moveTo(...s.points[0]);for(const p of s.points.slice(1))g.lineTo(...p);g.stroke();}g.restore();
  const visible=this.buildings.filter(b=>b.bounds[2]>x-pad&&b.bounds[0]<x+size+pad&&b.bounds[3]>y-pad&&b.bounds[1]<y+size+pad);
  g.save();g.translate(2.7,3.5);g.fillStyle='#162c2b35';g.shadowColor='#142b2733';g.shadowBlur=8;for(const b of visible)g.fill(b.path,'evenodd');g.restore();
  for(const b of visible)this.roof(g,b);
  for(const t of this.s.trees)if(t.x>x-8&&t.x<x+size+8&&t.y>y-8&&t.y<y+size+8)this.tree(g,t);
  this.buildMs.push(performance.now()-start);return c;
 }
 draw(ctx,cx,cy,width,height,zoom){const tile=128,range=[];for(let y=Math.floor((cy-height/zoom/2)/tile);y<=Math.floor((cy+height/zoom/2)/tile);y++)for(let x=Math.floor((cx-width/zoom/2)/tile);x<=Math.floor((cx+width/zoom/2)/tile);x++)range.push({x,y,d:Math.hypot((x+.5)*tile-cx,(y+.5)*tile-cy)});range.sort((a,b)=>a.d-b.d);let built=0;
  for(const {x,y}of range){const key=x+','+y;let c=this.cache.get(key);if(!c&&built<1){c=this.tile(x,y);this.cache.set(key,c);built++;}if(c)ctx.drawImage(c,x*tile,y*tile,tile+.03,tile+.03);else{ctx.fillStyle='#9b9b88';ctx.fillRect(x*tile,y*tile,tile,tile);}}
  // Adjacent tiles are prepared off camera, under the same one-tile frame budget.
  if(!built)for(const {x,y}of range)for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const key=`${x+dx},${y+dy}`;if(!built&&!this.cache.has(key)){this.cache.set(key,this.tile(x+dx,y+dy));built++;}}
  if(this.cache.size>24){const wanted=new Set(range.map(p=>`${p.x},${p.y}`));for(const [k,c]of this.cache)if(!wanted.has(k)){c.width=c.height=1;this.cache.delete(k);if(this.cache.size<=20)break;}}
 }
}
