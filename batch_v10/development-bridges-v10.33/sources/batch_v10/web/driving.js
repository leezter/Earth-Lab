// Authored RacingVibes dynamics; artwork dimensions are independent map metres.
export const profiles = {
 GT: {width:24,length:45,colliderWidth:20,colliderLength:39,visualWidth:2.0,visualLength:3.7015,asset:'parked-assets/GT-classic_green.webp'},
 F1: {width:24,length:44,colliderWidth:18,colliderLength:42,visualWidth:2.0,visualLength:3.7273,asset:'parked-assets/F1-classic_blue.webp'},
 Bubble: {width:16,length:40,colliderWidth:16,colliderLength:38,visualWidth:1.8865,visualLength:3.9913,asset:'parked-assets/Bubble-classic_red.webp'},
 Truck: {width:29,length:60,colliderWidth:22,colliderLength:58,visualWidth:2.4,visualLength:5.0047,asset:'parked-assets/Truck-orange.webp'},
};

// RacingVibes samples the four visual corners and centre on every physics tick.
export function sampleContact(car, unitsPerMetre, groundAt) {
 const x=car.x/unitsPerMetre,y=car.y/unitsPerMetre;
 const c=Math.cos(car.angle),s=Math.sin(car.angle);
 const l=(car.visualLength||car.length/unitsPerMetre)/2,w=(car.visualWidth||car.width/unitsPerMetre)/2;
 const centre=groundAt(x,y);
 let count=centre.onRoad?1:0;
 for(const [a,b]of [[l,-w],[l,w],[-l,w],[-l,-w]]){
  if(groundAt(x+a*c-b*s,y+a*s+b*c).onRoad)count++;
 }
 return {...centre,onRoad:count>=3};
}
