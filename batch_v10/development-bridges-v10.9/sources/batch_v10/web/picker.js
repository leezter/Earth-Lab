import './app.js';
import {worldMap} from './world-map.js';
const $=id=>document.getElementById(id),button=$('generate'),message=$('generation');
let selected=null,poll=0,selection=0,searchVersion=0;
const map=worldMap(choose);
async function request(url,options){const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
function choose(p,focus=true){
 if(!Number.isFinite(+p.lat)||!Number.isFinite(+p.lon)||Math.abs(+p.lat)>84||Math.abs(+p.lon)>180){clearTimeout(poll);selection++;selected=null;button.hidden=true;message.textContent='Choose coordinates within 84°S–84°N and 180°W–180°E.';return;}
 clearTimeout(poll);selection++;searchVersion++;selected={...p,lat:+p.lat,lon:+p.lon};
 map.select(selected,focus);button.hidden=false;button.disabled=false;
 button.textContent='Generate 192 m area (usually 2–7 min)';
 message.textContent=`Selected: ${p.label}. The centre will snap to a nearby driving road. The outlined area is approximate.`;button.onclick=generate;
}
async function watch(id,version=selection){
 clearTimeout(poll);
 try{const d=await request('/api/job?id='+encodeURIComponent(id));if(version!==selection)return;
  if(d.status==='built'){button.disabled=false;button.hidden=false;button.textContent='Drive generated area';message.textContent=`${d.name} is ready and cached. Your current drive is still available.`;button.onclick=()=>window.earthLab.addSite(d);return;}
  if(d.status==='failed'){const error=Error(d.error||'Generation failed');error.retryable=d.retryable;throw error;}
  message.textContent=`${d.name}: ${d.status}. You can keep driving while this runs.`;poll=setTimeout(()=>watch(id,version),2000);
 }catch(e){if(version!==selection)return;if(e.retryable===false){message.textContent=e.message;button.hidden=true;button.disabled=false;return;}message.textContent=e.message+(selected?' — retry generation.':' — select the location again to retry.');button.disabled=false;button.textContent='Retry generation';button.onclick=generate;}
}
async function generate(){
 if(!selected)return;const version=selection;button.disabled=true;message.textContent='Requesting area…';
 try{const d=await request('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:selected.lat,lon:selected.lon,name:selected.label})});if(version===selection)watch(d.id,version);}
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
const pending=window.EARTH_BATCH_SITES.find(s=>s.id.startsWith('place-')&&!['built','failed'].includes(s.status));
if(pending){selected={lat:pending.lat,lon:pending.lon,label:pending.name};map.select(selected,false);button.hidden=false;button.disabled=true;watch(pending.id);}
