import './app.js';
import {worldMap} from './world-map.js';
const $=id=>document.getElementById(id),button=$('generate'),message=$('generation');
let selected=null,poll=0,selection=0,searchVersion=0,recovery=null;
const map=worldMap(choose);
async function request(url,options){const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
function choose(p,focus=true){
 if(!Number.isFinite(+p.lat)||!Number.isFinite(+p.lon)||Math.abs(+p.lat)>84||Math.abs(+p.lon)>180){clearTimeout(poll);selection++;selected=null;button.hidden=true;message.textContent='Choose coordinates within 84°S–84°N and 180°W–180°E.';return;}
 clearTimeout(poll);selection++;searchVersion++;recovery=null;sessionStorage.removeItem('earth-nearby');selected={...p,lat:+p.lat,lon:+p.lon};
 map.select(selected,focus);button.hidden=false;button.disabled=false;
 button.textContent='Generate 192 m area (usually 2–7 min)';
 message.textContent=`Selected: ${p.label}. The centre will snap to a nearby driving road. If unavailable, a nearby playable area will be used. The outlined area is approximate.`;button.onclick=generate;
}
async function watch(id,version=selection){
 clearTimeout(poll);
 try{const d=await request('/api/job?id='+encodeURIComponent(id));if(version!==selection)return;
  if(d.status==='built'&&recovery){await useNearby(d,version);return;}
  if(d.status==='built'){button.disabled=false;button.hidden=false;button.textContent='Drive generated area';message.textContent=`${d.name} is ready and cached. Your current drive is still available.`;button.onclick=()=>window.earthLab.addSite(d);return;}
  if(d.status==='failed'&&selected){await tryNearby(d,version);return;}
  if(d.status==='failed'){const error=Error(d.error||'Generation failed');error.retryable=d.retryable;throw error;}
  message.textContent=`${d.name}: ${d.status}. You can keep driving while this runs.`;poll=setTimeout(()=>watch(id,version),2000);
 }catch(e){if(version!==selection)return;if(e.retryable===false){message.textContent=e.message;button.hidden=true;button.disabled=false;return;}message.textContent=e.message+(selected?' — retry generation.':' — select the location again to retry.');button.disabled=false;button.textContent='Retry generation';button.onclick=generate;}
}
function metres(a,b){const r=Math.PI/180,p=a.lat*r,q=b.lat*r,h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin((b.lon-a.lon)*r/2)**2;return 12742017.6*Math.asin(Math.min(1,Math.sqrt(h)));}
async function useNearby(d,version){
 if(version!==selection)return;
 const point={lat:d.actual_lat??d.lat,lon:d.actual_lon??d.lon},distance=metres(selected,point);
 if(distance>1500){await tryNearby({error:'Candidate is outside the nearby search radius'},version);return;}
 d={...d,fallback:d.fallback||{requested_lat:selected.lat,requested_lon:selected.lon,distance_m:distance}};
 map.select({...point,label:d.name},true);button.hidden=false;button.disabled=false;button.textContent='Drive nearby area';button.onclick=()=>window.earthLab.addSite(d);
 message.textContent=`Using an available area ${Math.round(distance)} m from your selected location. The original area could not be generated. ${recovery?.error||''}`;
 sessionStorage.removeItem('earth-nearby');await window.earthLab.addSite(d);
}
async function tryNearby(failed,version){
 if(version!==selection)return;
 if(!recovery){
  recovery={started:Date.now(),error:failed.error||'Area unavailable',index:0,plan:[]};button.disabled=true;
  message.textContent='Selected area unavailable. Finding the closest available area�';
  const result=await request(`/api/nearby?lat=${encodeURIComponent(selected.lat)}&lon=${encodeURIComponent(selected.lon)}`);
  if(version!==selection)return;
  if(result.ready){await useNearby(result.ready,version);return;}
  recovery.plan=result.candidates||[];
 }
 if(recovery.index>=Math.min(8,recovery.plan.length)||Date.now()-recovery.started>12*60*1000){
  sessionStorage.removeItem('earth-nearby');
  const error=Error('No playable alternative was found within 1.5 km after the bounded nearby search. Choose another location.');error.retryable=false;throw error;
 }
 const point=recovery.plan[recovery.index++];button.disabled=true;
 message.textContent=`Trying nearby road ${recovery.index} of ${recovery.plan.length}, ${Math.round(point.distance_m)} m away. You can keep driving.`;
 const d=await request('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...point,name:'Nearby '+selected.label,nearby:true})});
 if(version===selection){sessionStorage.setItem('earth-nearby',JSON.stringify({selected,recovery,jobId:d.id}));watch(d.id,version);}
}
async function generate(){
 if(!selected)return;recovery=null;const version=selection;button.disabled=true;message.textContent='Requesting area…';
 try{const d=await request('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:selected.lat,lon:selected.lon,name:selected.label,nearby:true})});if(version===selection)watch(d.id,version);}
 catch(e){if(version!==selection)return;message.textContent=e.message;button.disabled=false;}
}
$('query').placeholder='Search a street, town or landmark…';
$('search').onsubmit=async e=>{
 e.preventDefault();const q=$('query').value.trim();if(!q)return;const version=++searchVersion;message.textContent='Searching…';$('results').replaceChildren();
 const coords=q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);if(coords)return choose({lat:+coords[1],lon:+coords[2],label:q});
 try{const results=await request('/api/search?q='+encodeURIComponent(q));if(version!==searchVersion)return;
  message.textContent=results.length?'Choose the exact result below.':'No results. Include the town or country.';
  for(const p of results){const b=document.createElement('button');b.type='button';b.textContent=p.label;b.onclick=()=>{$('results').replaceChildren();choose(p);};$('results').append(b);}
 }catch(e){if(version===searchVersion)message.textContent='Search unavailable: '+e.message;}
};
let saved=null;try{saved=JSON.parse(sessionStorage.getItem('earth-nearby'));}catch{}
const pending=window.EARTH_BATCH_SITES.find(s=>s.id.startsWith('place-')&&!['built','failed'].includes(s.status));
if(saved?.selected&&saved.recovery&&saved.jobId){selected=saved.selected;recovery=saved.recovery;map.select(selected,false);button.hidden=false;button.disabled=true;watch(saved.jobId);}
else if(pending){selected={lat:pending.lat,lon:pending.lon,label:pending.name};map.select(selected,false);button.hidden=false;button.disabled=true;watch(pending.id);}
