// Illustrative two-axis phases, never a reconstruction of real signal schedules.
export function phase(axis,seconds){
 const t=((seconds%24)+24)%24;
 if(axis===0)return t<8?'green':t<10?'amber':'red';
 return t>=12&&t<20?'green':t>=20&&t<22?'amber':'red';
}
export class SignalLayer{
 constructor(hardware=[]){this.signals=hardware.filter(h=>h.kind==='signal');this.seconds=0;}
 advance(dt,paused){if(!paused)this.seconds+=dt;}
 states(){return this.signals.map(s=>({id:s.id,group:s.group,axis:s.axis,state:phase(s.axis,this.seconds)}));}
 draw(ctx){for(const s of this.signals){const state=phase(s.axis,this.seconds);ctx.fillStyle='#151a19';ctx.beginPath();ctx.arc(s.point[0],s.point[1],.23,0,Math.PI*2);ctx.fill();ctx.fillStyle={red:'#ed483c',amber:'#f3bd46',green:'#6ed37b'}[state];ctx.beginPath();ctx.arc(s.point[0],s.point[1],.15,0,Math.PI*2);ctx.fill();}}
}
