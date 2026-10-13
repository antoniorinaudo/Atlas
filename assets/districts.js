(()=>{
 'use strict';
 const get=id=>document.getElementById(id),OUTSIDE='outside';
 let districts=[],byId=new Map(),ready=false,expanded=false,counts=[],lastSummaryKey='',lastLayerKey='';
 const assignments=new Map();
 function decode(text,scale,flat=false){
  const ring=[];let cursor=0,lon=0,lat=0;
  function value(){let result=0,shift=0,chunk;do{chunk=text.charCodeAt(cursor++)-63;result|=(chunk&31)<<shift;shift+=5;}while(chunk>=32);return result&1?~(result>>1):result>>1;}
  while(cursor<text.length){lon+=value();lat+=value();if(flat)ring.push(lon/scale,lat/scale);else ring.push([lon/scale,lat/scale]);}return flat?Float64Array.from(ring):ring;
 }
 const inBox=(lon,lat,b)=>lon>=b[0]&&lon<=b[2]&&lat>=b[1]&&lat<=b[3];
 // Even/odd crossings handle holes and islands. Boundary points belong to one
 // unit only (the first official code), so totals cannot double-count them.
 function contains(lon,lat,rings){
  let inside=false;
  for(const ring of rings){const flat=ArrayBuffer.isView(ring),n=flat?ring.length/2:ring.length;for(let i=0,j=n-1;i<n;j=i++){
   const ax=flat?ring[j*2]:ring[j][0],ay=flat?ring[j*2+1]:ring[j][1],bx=flat?ring[i*2]:ring[i][0],by=flat?ring[i*2+1]:ring[i][1],dx=bx-ax,dy=by-ay;
   if((dx||dy)&&Math.abs((lon-ax)*dy-(lat-ay)*dx)<=1e-12*Math.max(1,Math.abs(dx),Math.abs(dy))&&lon>=Math.min(ax,bx)-1e-12&&lon<=Math.max(ax,bx)+1e-12&&lat>=Math.min(ay,by)-1e-12&&lat<=Math.max(ay,by)+1e-12)return true;
   if((ay>lat)!==(by>lat)&&lon<(bx-ax)*(lat-ay)/(by-ay)+ax)inside=!inside;
  }}return inside;
 }
 function districtFor(e){
  if(!ready)return null;
  const lon=Number(e.lon),lat=Number(e.lat),key=lon+'|'+lat;
  if(assignments.has(key))return assignments.get(key);
  const district=Number.isFinite(lon)&&Number.isFinite(lat)?districts.find(d=>inBox(lon,lat,d.bounds)&&d.polygons.some(p=>{if(!inBox(lon,lat,p.bounds))return false;if(!p.decoded){p.decoded=p.rings.map(r=>decode(r,1000000,true));}return contains(lon,lat,p.decoded);})):null;
  const id=district?.id||OUTSIDE;if(assignments.size>10000)assignments.clear();assignments.set(key,id);return id;
 }
 const matches=e=>!state.district||!ready||districtFor(e)===state.district;
 function aggregate(events){const totals=new Map();for(const e of events){const id=districtFor(e);totals.set(id,(totals.get(id)||0)+1);}return districts.map(d=>({...d,count:totals.get(d.id)||0})).filter(d=>d.count).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'es')).map(d=>({id:d.id,name:d.name,province:d.province,count:d.count})).concat([{id:OUTSIDE,name:'Fuera de distritos terrestres',count:totals.get(OUTSIDE)||0}]);}
 function row(d,max){
  const button=document.createElement('button');button.type='button';button.className='district-row';button.dataset.district=d.id;button.setAttribute('aria-pressed',String(state.district===d.id));button.setAttribute('aria-label',`${d.name}${d.province?' · '+d.province:''}: ${d.count} registros. Filtrar y ver en el mapa`);button.title=d.name+(d.province?' · '+d.province:'');
  const name=document.createElement('span');name.className='district-name';name.textContent=d.name;
  const count=document.createElement('b');count.textContent=d.count;
  const bar=document.createElement('span');bar.className='district-bar';bar.setAttribute('aria-hidden','true');bar.style.setProperty('--district-share',100*d.count/max+'%');
  button.append(name,count,bar);button.onclick=()=>choose(d.id,true);return button;
 }
 function summary(){
  if(!ready)return;
  const base=getFiltered(false);counts=aggregate(base);
  const key=JSON.stringify([counts,state.district,expanded]);if(key===lastSummaryKey)return;lastSummaryKey=key;
  const focused=document.activeElement?.dataset.district,hadExpandFocus=document.activeElement===get('districtExpand');
  const ranked=counts.filter(d=>d.id!==OUTSIDE),shown=expanded?ranked:ranked.slice(0,5),max=Math.max(1,...ranked.map(d=>d.count));
  get('districtRows').replaceChildren(...shown.map(d=>row(d,max)));get('districtRows').classList.toggle('expanded',expanded);
  get('districtEmpty').hidden=ranked.length>0;get('districtEmpty').textContent=base.length?'Sin epicentros dentro de los distritos terrestres.':'Sin registros para estos filtros.';
  const outside=counts.find(d=>d.id===OUTSIDE);get('districtOutside').textContent='Fuera de distritos terrestres · '+outside.count;get('districtOutside').setAttribute('aria-pressed',String(state.district===OUTSIDE));get('districtOutside').disabled=!outside.count&&state.district!==OUTSIDE;
  get('districtExpand').hidden=ranked.length<=5;get('districtExpand').textContent=expanded?'Ver menos':'Ver todos';get('districtExpand').setAttribute('aria-expanded',String(expanded));
  const selected=state.district===OUTSIDE?outside:byId.get(state.district);get('districtClear').hidden=!state.district;get('districtClear').textContent=selected?selected.name+' ×':'Todos los distritos';get('districtClear').setAttribute('aria-label','Quitar filtro de distrito');
  get('districtScope').textContent='Según el período y filtros';get('districtSummary').setAttribute('aria-busy','false');
  if(focused)get('districtRows').querySelector(`[data-district="${focused}"]`)?.focus({preventScroll:true});if(hadExpandFocus)get('districtExpand').focus({preventScroll:true});
 }
 function choose(id,focus=false){
  state.district=state.district===id?null:id;
  if(state.district&&state.district!==OUTSIDE){
   const d=byId.get(id);if(focus){setMode('2d');const b=d.bounds,w=Math.max(65,(x(b[2])-x(b[0]))*1.3),h=Math.max(55,(y(b[1])-y(b[3]))*1.3);setView([x((b[0]+b[2])/2)-w/2,y((b[1]+b[3])/2)-h/2,w,h],d.name);}
  }
  if(!state.district){get('zoneName').textContent='Exploración libre';get('zoneTag').textContent='VISUALIZACIÓN DE EPICENTROS';}
  else if(state.district!==OUTSIDE){get('zoneName').textContent=byId.get(state.district).name;get('zoneTag').textContent='DISTRITO SELECCIONADO';}
  render();if(focus&&state.district&&state.district!==OUTSIDE)document.querySelector('.map-panel').scrollIntoView({block:'start',behavior:'auto'});
 }
 function layer(){
  const group=get('districtLayer');if(!ready)return;group.style.display='';
  const key=state.view.join('|')+'|'+state.district+'|'+get('geoMap').getBoundingClientRect().width;if(key===lastLayerKey)return;lastLayerKey=key;
  const map=get('geoMap'),rect=map.getBoundingClientRect(),k=Math.max(rect.width/state.view[2],rect.height/state.view[3]),left=state.view[0]+(state.view[2]-rect.width/k)/2,top=state.view[1]+(state.view[3]-rect.height/k)/2;
  const visible=districts.filter(d=>x(d.bounds[2])>=left&&x(d.bounds[0])<=left+rect.width/k&&y(d.bounds[1])>=top&&y(d.bounds[3])<=top+rect.height/k);
  const paths=visible.map(d=>`<path class="district-outline${d.id===state.district?' selected':''}" d="${d.path}" fill-rule="evenodd" vector-effect="non-scaling-stroke"/>`).join('');
  const visiblePlaces=new Set();
  const reserved=[...document.querySelectorAll('.place text,.map-info,.map-ctrl,.map-legend,#mapLatestHover')].filter(el=>{const b=el.getBoundingClientRect(),visible=!el.hidden&&getComputedStyle(el).visibility!=='hidden'&&b.width>0&&b.height>0&&b.right>rect.left&&b.left<rect.right&&b.bottom>rect.top&&b.top<rect.bottom;if(visible&&el.matches('.place text'))visiblePlaces.add(el.textContent.trim().toLocaleLowerCase('es'));return visible;}).map(el=>el.getBoundingClientRect());
  const labels=[];
  for(const d of [...visible].sort((a,b)=>Number(b.id===state.district)-Number(a.id===state.district))){
   if(labels.length>=8)break;const selected=d.id===state.district;if(visiblePlaces.has(d.name.toLocaleLowerCase('es')))continue;
   if(!selected&&(state.view[2]>250||(x(d.bounds[2])-x(d.bounds[0]))*k<100))continue;
   const px=rect.left+(x(d.label[0])-left)*k,py=rect.top+(y(d.label[1])-top)*k,w=d.name.length*6.2+10,box={left:px-w/2,right:px+w/2,top:py-8,bottom:py+8};
   if(box.left<rect.left+8||box.right>rect.right-8||box.top<rect.top+8||box.bottom>rect.bottom-8||reserved.some(r=>box.left<r.right+5&&box.right>r.left-5&&box.top<r.bottom+5&&box.bottom>r.top-5))continue;
   reserved.push(box);labels.push(`<text class="district-label" x="${x(d.label[0])}" y="${y(d.label[1])}" text-anchor="middle" style="font-size:${11/k}px;stroke-width:${3/k}px">${escaped(d.name)}</text>`);
  }
  group.innerHTML=paths+labels.join('');
 }
 function tap(event){
  if(!ready||state.mode!=='2d')return false;
  const map=get('geoMap'),matrix=map.getScreenCTM();if(!matrix)return false;
  const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()),lon=WORLD.minLon+p.x/WORLD.w*(WORLD.maxLon-WORLD.minLon),lat=WORLD.maxLat-p.y/WORLD.h*(WORLD.maxLat-WORLD.minLat),id=districtFor({lon,lat});
  if(id===OUTSIDE)return false;choose(id);return true;
 }
 get('districtExpand').onclick=()=>{expanded=!expanded;summary();};get('districtClear').onclick=()=>{state.district=null;get('zoneName').textContent='Exploración libre';get('zoneTag').textContent='VISUALIZACIÓN DE EPICENTROS';render();get('districtExpand').focus({preventScroll:true});};get('districtOutside').onclick=()=>choose(OUTSIDE);
 window.atlasDistricts={matches,summary,layer,tap,districtFor,aggregate,contains,decode,get ready(){return ready;},get districts(){return districts;}};
 async function load(){
  try{
   const response=await fetch('assets/distritos.json?v=20261013-map-clear19');if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(!Array.isArray(data.districts)||!data.districts.length)throw new Error('Cartografía vacía');
   if(data.scale!==1000000)throw new Error('Precisión cartográfica no compatible');
   districts=data.districts.map(d=>({...d,path:d.display.flatMap(p=>p.map(r=>{const ring=decode(r,data.scale);return 'M'+ring.map(pt=>x(pt[0]).toFixed(3)+','+y(pt[1]).toFixed(3)).join('L')+'Z';})).join('')}));byId=new Map(districts.map(d=>[d.id,d]));ready=true;render();
  }catch(error){get('districtScope').textContent='Cartografía no disponible';get('districtSummary').setAttribute('aria-busy','false');get('districtEmpty').textContent='No se pudieron cargar los límites. El catálogo sigue disponible.';get('districtEmpty').hidden=false;get('districtOutside').hidden=true;window.atlasDiagnostics?.log('warning','Distritos: '+error.message);}
 }
 load();
})();
