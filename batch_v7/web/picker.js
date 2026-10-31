import './app.js';
const $=id=>document.getElementById(id),button=$('generate'),message=$('generation');
let selected=null,poll=0;
async function request(url,options){const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
function choose(p){clearTimeout(poll);selected=p;button.hidden=false;button.disabled=false;button.textContent='Generate 192 m area (usually 2–7 min)';message.textContent=`Selected: ${p.label}. The centre will snap to a nearby driving road.`;button.onclick=generate;}
async function watch(id){
 clearTimeout(poll);
 try{const d=await request('/api/job?id='+encodeURIComponent(id));
  if(d.status==='built'){button.disabled=false;button.hidden=false;button.textContent='Drive generated area';message.textContent=`${d.name} is ready and cached. Your current drive is still available.`;button.onclick=()=>window.earthLab.addSite(d);return;}
  if(d.status==='failed')throw Error(d.error||'Generation failed');
  message.textContent=`${d.name}: ${d.status}. You can keep driving while this runs.`;poll=setTimeout(()=>watch(id),2000);
 }catch(e){message.textContent=e.message+' — select the location again to retry.';button.disabled=false;button.onclick=generate;}
}
async function generate(){if(!selected)return;button.disabled=true;message.textContent='Requesting area…';try{const d=await request('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:selected.lat,lon:selected.lon,name:selected.label})});watch(d.id);}catch(e){message.textContent=e.message;button.disabled=false;}}
$('query').placeholder='Search a street, town or landmark…';
$('search').onsubmit=async e=>{e.preventDefault();const q=$('query').value.trim();if(!q)return;message.textContent='Searching…';$('results').replaceChildren();
 const coords=q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);if(coords)return choose({lat:+coords[1],lon:+coords[2],label:q});
 try{const results=await request('/api/search?q='+encodeURIComponent(q));message.textContent=results.length?'Choose the exact result below.':'No results. Include the town or country.';for(const p of results){const b=document.createElement('button');b.type='button';b.textContent=p.label;b.onclick=()=>{$('results').replaceChildren();choose(p);};$('results').append(b);}}catch(e){message.textContent='Search unavailable: '+e.message;}};
const pending=window.EARTH_BATCH_SITES.find(s=>s.id.startsWith('place-')&&!['built','failed'].includes(s.status));if(pending){button.hidden=false;button.disabled=true;watch(pending.id);}
