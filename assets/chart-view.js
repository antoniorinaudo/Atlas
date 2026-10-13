(()=>{
 'use strict';
 const DAY=86400000,RADIUS_KM=100,MIN_MAIN_MAG=5,LASSO_ALPHA=.10,get=id=>document.getElementById(id);
 const timestamp=e=>Date.parse(e.date+'T'+e.time+'-05:00');
 function reference(events){return events.filter(e=>e.mag>=MIN_MAIN_MAG).reduce((best,e)=>!best||e.mag>best.mag||e.mag===best.mag&&timestamp(e)<timestamp(best)?e:best,null);}
 function distanceKm(a,b){
  const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
 }
 function isAftershock(event,main){return !!main&&timestamp(event)>timestamp(main)&&distanceKm(event,main)<=RADIUS_KM;}
 // Single standardized time feature; the intercept is not penalized.
 // Objective: mean squared error / 2 + alpha * abs(standardized coefficient).
 function trend(events,alpha=LASSO_ALPHA){
  if(!Number.isFinite(alpha)||alpha<0)throw new RangeError('La penalización LASSO debe ser un número no negativo');
  if(events.length<2)return null;
  const origin=Math.min(...events.map(timestamp)),xs=events.map(e=>(timestamp(e)-origin)/DAY),meanX=xs.reduce((s,x)=>s+x,0)/xs.length,meanY=events.reduce((s,e)=>s+e.mag,0)/events.length;
  const variance=xs.reduce((s,x)=>s+(x-meanX)**2,0);if(variance<=Number.EPSILON)return null;
  const scale=Math.sqrt(variance/events.length),covariance=xs.reduce((s,x,i)=>s+(x-meanX)/scale*(events[i].mag-meanY),0)/events.length;
  const coefficient=Math.sign(covariance)*Math.max(0,Math.abs(covariance)-alpha),slope=coefficient/scale,intercept=meanY-slope*meanX,end=Math.max(...xs);
  return {model:'LASSO',alpha,standardizedCoefficient:coefficient,timeScaleDays:scale,start:origin,end:origin+end*DAY,startMag:intercept,endMag:intercept+slope*end,slopePerDay:slope};
 }
 function sequenceControls(){
  const main=reference(EVENTS),chip=document.querySelector('[data-period="aftershocks"]'),note=get('sequenceNote');
  chip.disabled=!main;chip.title=main?'Eventos posteriores a M '+main.mag.toFixed(1)+' y hasta '+RADIUS_KM+' km de su epicentro; selección aproximada':'No hay un sismo de referencia de M '+MIN_MAIN_MAG+' o mayor en este catálogo';
  note.hidden=state.period!=='aftershocks';
  note.textContent=main?`Después de M ${main.mag.toFixed(1)} del ${dateShort(main.date)} · ${formatLocalTime(main.time,false)}, hasta ${RADIUS_KM} km. Selección aproximada; no es una clasificación oficial.`:'Sin un sismo de referencia de M '+MIN_MAIN_MAG+' o mayor en el catálogo disponible.';
 }
 const localISO=t=>new Date(t-5*3600000).toISOString().slice(0,19);
 function tickLabel(t,short){return new Intl.DateTimeFormat('es-PA',{timeZone:'America/Panama',...(short?{hour:'numeric',minute:'2-digit',hour12:true}:{day:'numeric',month:'short'})}).format(new Date(t));}
 let drawing=false,dirty=false,resizeFrame=0,viewKey='',userXRange=null,userYRange=null;
 const rangeStamp=value=>{const text=String(value).replace(' ','T');return Date.parse(text+(text.includes('T')?'':'T00:00:00')+(/Z$|[+-]\d{2}:\d{2}$/.test(text)?'':'-05:00'));};
 async function renderChart(){
  dirty=true;if(drawing)return;drawing=true;
  try{while(dirty&&state.mode==='chart'){
   dirty=false;
   const key=state.period+'|'+state.status+'|'+state.query;if(key!==viewKey){viewKey=key;userXRange=null;userYRange=null;}
   const rows=[...lastFilter].sort((a,b)=>timestamp(a)-timestamp(b)),fit=trend(rows),mobile=matchMedia('(max-width:630px)').matches;
   const traces=[{type:'scatter',mode:'markers',name:'Eventos',x:rows.map(e=>e.date+'T'+e.time),y:rows.map(e=>e.mag),customdata:rows.map(e=>[e.id,dateShort(e.date),formatLocalTime(e.time),escaped(e.region),e.depth,e.status]),hovertemplate:'<b>M %{y:.1f}</b><br>%{customdata[3]}<br>%{customdata[1]} · %{customdata[2]} Panamá<br>%{customdata[4]} km · %{customdata[5]}<extra></extra>',marker:{size:rows.map(e=>(mobile?7:6)+Math.max(0,e.mag-4)),color:rows.map(rgb),opacity:.88,line:{color:'#102b38',width:.7}}}];
   if(fit)traces.push({type:'scatter',mode:'lines',name:'Tendencia LASSO',x:[localISO(fit.start),localISO(fit.end)],y:[fit.startMag,fit.endMag],hoverinfo:'skip',line:{color:'#85e6d0',width:2.5,dash:'dash'}});
   const selected=rows.find(e=>e.id===state.selected);if(selected)traces.push({type:'scatter',mode:'markers',name:'Seleccionado',x:[selected.date+'T'+selected.time],y:[selected.mag],customdata:[[selected.id]],hoverinfo:'skip',marker:{size:13,color:'rgba(0,0,0,0)',line:{color:'#fff',width:2}}});
   const start=rows.length?timestamp(rows[0]):Date.parse(todayPanama()+'T00:00:00-05:00'),end=rows.length?timestamp(rows[rows.length-1]):start+DAY,span=end-start,pad=span?span*.03:1800000,left=start-pad,right=end+pad,count=mobile?3:6;
   const tickLeft=userXRange?rangeStamp(userXRange[0]):left,tickRight=userXRange?rangeStamp(userXRange[1]):right;
   const ticks=Array.from({length:count},(_,i)=>tickLeft+(tickRight-tickLeft)*i/(count-1));
   const layout={paper_bgcolor:'#0a2432',plot_bgcolor:'#0a2432',font:{family:'Inter, system-ui, sans-serif',size:mobile?10:12,color:'#bdd5df'},margin:{l:mobile?44:58,r:18,t:16,b:mobile?62:60},showlegend:false,hovermode:'closest',dragmode:'pan',uirevision:'atlas-chart|'+state.period+'|'+state.status+'|'+state.query,xaxis:{type:'date',title:{text:'Fecha · hora de Panamá',standoff:15},range:userXRange||[localISO(left),localISO(right)],tickvals:ticks.map(localISO),ticktext:ticks.map(t=>tickLabel(t,tickRight-tickLeft<DAY)),gridcolor:'#244957',zeroline:false,showline:true,linecolor:'#40616c',automargin:true},yaxis:{title:{text:'Magnitud',standoff:10},gridcolor:'#244957',zeroline:false,showline:true,linecolor:'#40616c',tickformat:'.1f',dtick:1,automargin:true},annotations:rows.length?[]:[{text:'Sin registros para estos filtros',xref:'paper',yref:'paper',x:.5,y:.5,showarrow:false,font:{size:14,color:'#a9c7d4'}}]};
   if(userYRange){layout.yaxis.range=userYRange;layout.yaxis.autorange=false;}
   get('chartStatus').textContent=rows.length+' registros · '+(fit?'Puntos: eventos · Línea: LASSO (α='+fit.alpha.toFixed(2)+'), descriptiva, no una predicción.':'No hay fechas distintas suficientes para calcular una tendencia.');
   const plot=get('magnitudeChart');await Plotly.react(plot,traces,layout,{responsive:true,displaylogo:false,displayModeBar:false,scrollZoom:false});
   if(!plot.__atlasChartBound){plot.__atlasChartBound=true;plot.on('plotly_relayout',info=>{
    let changed=false;
    for(const axis of ['xaxis','yaxis']){
     const range=info[axis+'.range']||(info[axis+'.range[0]']!==undefined&&info[axis+'.range[1]']!==undefined?[info[axis+'.range[0]'],info[axis+'.range[1]']]:null);
     if(range||info[axis+'.autorange']===true){if(axis==='xaxis')userXRange=range?[...range]:null;else userYRange=range?[...range]:null;changed=true;}
    }
    if(changed)renderChart();
   });plot.on('plotly_click',info=>{
    const p=info?.points?.find(p=>Array.isArray(p.customdata));if(!p)return;
    const id=Number(p.customdata[0]);if(!lastFilter.some(e=>e.id===id))return;
    const at=info.event?.clientX!==undefined?{x:info.event.clientX,y:info.event.clientY}:null;selectEvent(id,false,true,at);
   });}
  }}catch(error){get('chartStatus').textContent='No se pudo mostrar el gráfico. Puedes volver al mapa.';window.atlasDiagnostics?.log('error','Gráfico: '+error.message);console.error(error);}
  finally{drawing=false;}
 }
 function resize(){if(typeof state==='undefined'||state.mode!=='chart')return;cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{renderChart();});}
 new ResizeObserver(resize).observe(document.querySelector('.view-wrap'));
 window.atlasAnalysis={timestamp,reference,distanceKm,isAftershock,trend,sequenceControls,renderChart,resize,radiusKm:RADIUS_KM,minMainMagnitude:MIN_MAIN_MAG,lassoAlpha:LASSO_ALPHA};
})();
