/* Presentation-only attention cues. Incident status remains owned by the existing report handlers. */
const emergencyArrivals=new Map();
const emergencyKey=inc=>String(inc._uuid||inc.id);
const emergencyIndicator=document.createElement('button');
emergencyIndicator.type='button';emergencyIndicator.className='emergency-top-indicator';emergencyIndicator.hidden=true;
document.querySelector('.app-topbar').append(emergencyIndicator);
const emergencyTray=document.createElement('aside');
emergencyTray.className='emergency-alert-tray';emergencyTray.hidden=true;emergencyTray.setAttribute('aria-label','Unacknowledged emergency alerts');
document.body.append(emergencyTray);
const emergencyPopup=document.createElement('dialog');
emergencyPopup.className='emergency-attention-popup';emergencyPopup.setAttribute('role','alertdialog');emergencyPopup.setAttribute('aria-modal','true');emergencyPopup.setAttribute('aria-labelledby','emergency-popup-title');
emergencyPopup.innerHTML=`<div class="emergency-popup-heading">${eocIcon('Siren')}<span>EMERGENCY — IMMEDIATE ATTENTION</span><button type="button" class="emergency-popup-dismiss" aria-label="Close emergency popup">${eocIcon('X')}</button></div><div class="emergency-popup-content"><h2 id="emergency-popup-title"></h2><p>Each incident requires a separate response.</p><div class="emergency-popup-list"></div></div><div class="emergency-popup-actions"><button type="button" class="btn btn-secondary emergency-popup-dismiss">Close popup</button></div>`;
document.body.append(emergencyPopup);
emergencyPopup.querySelectorAll('.emergency-popup-dismiss').forEach(button=>button.onclick=()=>emergencyPopup.close());
function emergencyActiveAlerts(){
  if(!document.getElementById('screen-app').classList.contains('active'))return [];
  const reports=new Map(liveIncidents.map(inc=>[emergencyKey(inc),inc])),rows=[];
  // Only arrival events enter the queue; loading report history never creates notifications.
  for(const [key,alert] of emergencyArrivals){
    if(alert.user!==(currentUser?.id||'guest')){emergencyArrivals.delete(key);continue;}
    const inc=alert.demo?eocDemoReports.get(key):reports.get(key)||alert.incident;
    if(!inc||!['active','pending'].includes(inc.status)){emergencyArrivals.delete(key);continue;}
    alert.incident=inc;
    if(eocReceives(inc))rows.push(inc);
  }
  return rows;
}
function emergencyCards(rows){return rows.map(inc=>`<article class="emergency-alert-card" data-emergency-id="${eocEscape(emergencyKey(inc))}"><div class="emergency-alert-badges"><strong>${eocIcon('Siren')} ${eocEscape(String(inc.priority||'UNASSESSED').toUpperCase())} PRIORITY</strong><span>${eocEscape(statusLabel(inc.status))}</span></div><h3>${eocEscape(inc.type||'Emergency report')}</h3><p>${eocEscape([inc.building,inc.floor,inc.room].filter(Boolean).join(' · '))}</p><p class="emergency-alert-meta">Receiving office: ${eocEscape(reportOfficeLabel(inc)||'')}<br><time>${eocEscape([inc.date,inc.time].filter(Boolean).join(' · ')||'Time unavailable')}</time> · ${eocEscape(inc.id||emergencyKey(inc))}</p><button type="button" class="btn btn-secondary emergency-alert-view">View Emergency ${eocIcon('ArrowUpRight')}</button></article>`).join('');}
let emergencySnapshot='';
function emergencySyncAttention(){
  const rows=emergencyActiveAlerts();
  emergencyIndicator.hidden=!rows.length;emergencyTray.hidden=!rows.length;
  emergencyIndicator.innerHTML=eocIcon('Siren')+'<span>'+rows.length+' active emergenc'+(rows.length===1?'y':'ies')+'</span>';
  emergencyIndicator.setAttribute('aria-label',rows.length+' active emergencies. Open all alerts.');
  document.querySelectorAll('.emergency-attention-highlight').forEach(card=>card.classList.remove('emergency-attention-highlight'));
  const displayed=eocDemo||eocSelected();
  if(displayed&&rows.some(inc=>emergencyKey(inc)===emergencyKey(displayed)))document.querySelector('.eoc-incident')?.classList.add('emergency-attention-highlight');
  const snapshot=JSON.stringify(rows);if(snapshot!==emergencySnapshot){
    emergencySnapshot=snapshot;
    emergencyTray.innerHTML='<header role="status" aria-live="assertive" aria-atomic="true">'+eocIcon('Siren')+' '+rows.length+' emergencies awaiting acknowledgement</header><div class="emergency-tray-list">'+emergencyCards(rows)+'</div>';
    emergencyPopup.querySelector('.emergency-popup-list').innerHTML=emergencyCards(rows);
    emergencyPopup.querySelector('h2').textContent=rows.length+' new emergenc'+(rows.length===1?'y':'ies');
  }
  if(!rows.length&&emergencyPopup.open)emergencyPopup.close();
}
function emergencyOpenPopup(){emergencySyncAttention();if(emergencyActiveAlerts().length&&!emergencyPopup.open)emergencyPopup.showModal();}
function emergencyShowAttention(inc,demo=false){
  if(!inc||!eocReceives(inc)||!['active','pending'].includes(inc.status))return;
  emergencyArrivals.set(emergencyKey(inc),{incident:inc,demo,user:currentUser?.id||'guest'});
  emergencySyncAttention();emergencyOpenPopup();
}
function emergencyView(event){
  const button=event.target.closest('.emergency-alert-view');if(!button)return;
  const key=button.closest('[data-emergency-id]').dataset.emergencyId;
  const inc=emergencyActiveAlerts().find(i=>emergencyKey(i)===key);if(!inc)return;
  emergencyPopup.close();selectedIncidentId=inc._uuid||inc.id;eocDemo=eocDemoReports.get(key)||null;navigate('overview');
  const card=document.querySelector('.eoc-incident');if(card){card.setAttribute('tabindex','-1');card.focus({preventScroll:true});card.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
emergencyTray.onclick=emergencyView;emergencyPopup.addEventListener('click',emergencyView);emergencyIndicator.onclick=emergencyOpenPopup;
const emergencyOriginalSimulate=eocSimulate;
eocSimulate=function(type){emergencyOriginalSimulate(type);const inc=eocDemoReports.get('DEMO-'+String(type).toUpperCase());if(inc)emergencyShowAttention(inc,true);};
const emergencyOriginalAutoAlert=triggerAutoAlert;
triggerAutoAlert=function(inc){emergencyOriginalAutoAlert(inc);emergencyShowAttention(inc);};
const emergencyOriginalRender=renderPage;
renderPage=function(page){emergencyOriginalRender(page);emergencySyncAttention();};
function emergencyClearAttention(){emergencyArrivals.clear();emergencySnapshot='';emergencyTray.hidden=true;emergencyTray.innerHTML='';emergencyPopup.querySelector('.emergency-popup-list').innerHTML='';emergencyIndicator.hidden=true;emergencyPopup.close();}
const emergencyOriginalLogout=doLogout;
doLogout=async function(){emergencyClearAttention();return emergencyOriginalLogout();};
