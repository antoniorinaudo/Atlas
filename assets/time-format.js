function formatLocalTime(value,seconds=true){
 const match=String(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
 if(!match)return '—';
 const hour=Number(match[1]);
 return `${hour%12||12}:${match[2]}${seconds&&match[3]?':'+match[3]:''} ${hour>=12?'PM':'AM'}`;
}
function formatPanamaStamp(iso,seconds=false){
 const date=new Date(iso);if(!Number.isFinite(date.getTime()))throw Error('Fecha de actualización inválida');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('es-PA',{timeZone:'America/Panama',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
 return `${parts.day}/${parts.month}/${parts.year} a las ${formatLocalTime(parts.hour+':'+parts.minute+':'+parts.second,seconds)}`;
}
