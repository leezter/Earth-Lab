// Match the parked catalog in metres, converted to ten driving units per metre.
// Use its cropped artwork so sprite sheets and transparent margins cannot change size.
export const profiles = {
 GT: {width:20.0000,length:37.0150,colliderWidth:16.4511,colliderLength:32.0797,asset:'parked-assets/GT-classic_green.webp'},
 F1: {width:20.0000,length:37.2730,colliderWidth:15.2480,colliderLength:35.5788,asset:'parked-assets/F1-classic_blue.webp'},
 Bubble: {width:18.8650,length:39.9130,colliderWidth:15.9652,colliderLength:37.9173,asset:'parked-assets/Bubble-classic_red.webp'},
 Truck: {width:24.0000,length:50.0470,colliderWidth:18.3506,colliderLength:48.3788,asset:'parked-assets/Truck-orange.webp'},
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
