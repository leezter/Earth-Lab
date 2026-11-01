// Leaflet is vendored locally; only the visible basemap tiles need the network.
export function worldMap(onSelect) {
 const panel=document.createElement('details');panel.id='map-picker';panel.open=true;
 panel.innerHTML=`<summary>Choose on world map</summary>
  <p class="map-help">Zoom to a street, then click to select. Or move with arrow keys and select the centre.</p>
  <div id="location-map" role="region" aria-label="World location map"></div>
  <div class="row map-actions"><button type="button" id="map-world">World view</button><button type="button" id="map-centre">Select map centre</button></div>
  <p id="map-notice" class="map-help" aria-live="polite">Map tiles need internet. You can also search or enter latitude, longitude above.</p>`;
 document.getElementById('results').before(panel);
 if(!window.L){document.getElementById('map-notice').textContent='Map unavailable. Search or enter latitude, longitude above.';return {select(){}};}
 const map=L.map('location-map',{worldCopyJump:true,minZoom:1,maxZoom:19}).setView([20,0],1);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
 }).on('tileerror',()=>{document.getElementById('map-notice').textContent='Some map tiles could not load. Pan or zoom to retry, or use search / coordinates.';}).addTo(map);
 // Stop map navigation from reaching the driving keyboard listener.
 const container=map.getContainer();
 container.addEventListener('keydown',e=>e.stopPropagation());
 container.addEventListener('pointerdown',()=>window.dispatchEvent(new Event('blur')));
 let marker,area;
 function select(p,focus=true){
  const point=[p.lat,p.lon];
  if(!marker)marker=L.circleMarker(point,{radius:7,color:'#14212c',weight:3,fillColor:'#00cbb4',fillOpacity:1}).addTo(map);
  else marker.setLatLng(point);
  const dlat=96/111320,dlon=dlat/Math.cos(p.lat*Math.PI/180);
  const bounds=[[p.lat-dlat,p.lon-dlon],[p.lat+dlat,p.lon+dlon]];
  if(!area)area=L.rectangle(bounds,{color:'#008d80',weight:2,fillOpacity:.15,interactive:false}).addTo(map);
  else area.setBounds(bounds);
  if(focus){panel.open=true;map.invalidateSize();map.setView(point,16);}
 }
 function pick(point){
  const p=point.wrap();
  if(Math.abs(p.lat)>84){document.getElementById('map-notice').textContent='Generation supports latitudes from 84°S to 84°N. Choose a point closer to the equator.';return;}
  onSelect({lat:+p.lat.toFixed(6),lon:+p.lng.toFixed(6),label:`Map location ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`},false);
  document.getElementById('results').replaceChildren();
 }
 map.on('click',e=>pick(e.latlng));
 document.getElementById('map-centre').onclick=()=>pick(map.getCenter());
 document.getElementById('map-world').onclick=()=>map.setView([20,0],1);
 panel.addEventListener('toggle',()=>{if(panel.open)map.invalidateSize();});
 new ResizeObserver(()=>map.invalidateSize()).observe(container);
 return {select};
}
