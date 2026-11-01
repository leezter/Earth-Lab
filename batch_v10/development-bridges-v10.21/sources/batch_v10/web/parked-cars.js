// Bounded per-scene sprites. Load under the existing scene loading state;
// no image decoding, cropping or canvas creation in the live frame loop.
export class ParkedCars {
 constructor(scene){
  this.cars=scene.parked_cars||[];this.images=new Map();this.disposed=false;this.decodedBytes=0;
  this.ready=Promise.all([...new Set(this.cars.map(c=>c.asset))].map(async asset=>{
   const image=new Image();image.src=asset;await image.decode();
   if(this.disposed){image.src='';return;}
   this.images.set(asset,image);this.decodedBytes+=image.naturalWidth*image.naturalHeight*4;
  })).catch(error=>{this.dispose();throw Error('Parked vehicle artwork unavailable: '+error.message);});
 }
 draw(ctx){
  for(const car of this.cars){
   const image=this.images.get(car.asset);if(!image)continue;
   ctx.save();ctx.translate(car.x,car.y);ctx.rotate(car.angle+Math.PI/2);
   ctx.drawImage(image,-car.width/2,-car.length/2,car.width,car.length);ctx.restore();
  }
 }
 dispose(){this.disposed=true;for(const image of this.images.values())image.src='';this.images.clear();this.decodedBytes=0;}
}
