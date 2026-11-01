// Same base geometry and button/keyboard steering mode as RacingVibes racer.html.
// Keep the copied engine and earlier editions unchanged.
export const profiles = {
 GT: {width:24,length:45,colliderWidth:20,colliderLength:39,asset:'ClipperGT.png'},
 F1: {width:24,length:44,colliderWidth:18,colliderLength:42,asset:'Formula_1600.png'},
 Bubble: {width:16,length:40,colliderWidth:16,colliderLength:38,asset:'Bubble.png'},
 Truck: {width:29,length:60,colliderWidth:22,colliderLength:58,asset:'truck_orange.png'},
};

// RacingVibes samples the four visual corners and centre on every physics tick.
export function sampleContact(car, unitsPerMetre, groundAt) {
 const x=car.x/unitsPerMetre,y=car.y/unitsPerMetre;
 const c=Math.cos(car.angle),s=Math.sin(car.angle);
 const l=car.length/unitsPerMetre/2,w=car.width/unitsPerMetre/2;
 const centre=groundAt(x,y);
 let count=centre.onRoad?1:0;
 for(const [a,b]of [[l,-w],[l,w],[-l,w],[-l,-w]]){
  if(groundAt(x+a*c-b*s,y+a*s+b*c).onRoad)count++;
 }
 return {...centre,onRoad:count>=3};
}
