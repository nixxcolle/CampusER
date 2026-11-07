/* Presentation-only attention cues for the existing emergency entry points. */
let emergencyAttention=null;
const emergencyIndicator=document.createElement('button');
emergencyIndicator.type='button';
emergencyIndicator.className='emergency-top-indicator';
emergencyIndicator.hidden=true;
emergencyIndicator.innerHTML=eocIcon('Siren')+'<span>Emergency active</span>';
document.querySelector('.app-topbar').append(emergencyIndicator);

const emergencyPopup=document.createElement('dialog');
emergencyPopup.className='emergency-attention-popup';
emergencyPopup.setAttribute('role','alertdialog');
emergencyPopup.setAttribute('aria-modal','true');
emergencyPopup.setAttribute('aria-labelledby','emergency-popup-title');
emergencyPopup.setAttribute('aria-describedby','emergency-popup-description');
emergencyPopup.innerHTML=`<div class="emergency-popup-heading">${eocIcon('Siren')}<span>EMERGENCY TRIGGERED</span><button type="button" class="emergency-popup-dismiss" aria-label="Dismiss emergency popup">${eocIcon('X')}</button></div><div class="emergency-popup-content"><h2 id="emergency-popup-title"></h2><p id="emergency-popup-description"></p><p class="emergency-popup-office"></p><span class="emergency-popup-demo" hidden>Simulation alert</span></div><div class="emergency-popup-actions"><button type="button" class="btn btn-secondary emergency-popup-dismiss">Dismiss</button><button type="button" class="btn btn-primary emergency-popup-view">View Emergency ${eocIcon('ArrowUpRight')}</button></div>`;
document.body.append(emergencyPopup);
emergencyPopup.querySelectorAll('.emergency-popup-dismiss').forEach(button=>button.onclick=()=>emergencyPopup.close());
function emergencyCurrentAttention(){
  if(!emergencyAttention||emergencyAttention.user!==(currentUser?.id||'guest')||!document.getElementById('screen-app').classList.contains('active'))return null;
  const inc=emergencyAttention.demo?eocDemoReports.get(emergencyAttention.id):liveIncidents.find(i=>(i._uuid||i.id)===emergencyAttention.id);
  return inc&&eocReceives(inc)&&['active','pending'].includes(inc.status)?inc:null;
}
function emergencySyncAttention(){
  const inc=emergencyCurrentAttention();
  emergencyIndicator.hidden=!inc;
  document.querySelectorAll('.emergency-attention-highlight').forEach(card=>card.classList.remove('emergency-attention-highlight'));
  if(!inc){if(emergencyPopup.open)emergencyPopup.close();return;}
  emergencyIndicator.setAttribute('aria-label','Emergency active: '+inc.type+'. Open alert.');
  const displayed=eocDemo||eocSelected();
  if((displayed?._uuid||displayed?.id)===(inc._uuid||inc.id))document.querySelector('.eoc-incident')?.classList.add('emergency-attention-highlight');
}
function emergencyOpenPopup(){
  const inc=emergencyCurrentAttention();if(!inc)return;
  emergencyPopup.querySelector('h2').textContent=inc.type||'Emergency report';
  emergencyPopup.querySelector('#emergency-popup-description').textContent=[inc.building,inc.floor,inc.room].filter(Boolean).join(' · ');
  emergencyPopup.querySelector('.emergency-popup-office').textContent='Receiving office: '+inc.office;
  emergencyPopup.querySelector('.emergency-popup-demo').hidden=!emergencyAttention.demo;
  if(!emergencyPopup.open)emergencyPopup.showModal();
}
function emergencyShowAttention(inc,demo=false){
  if(!inc||!eocReceives(inc)||!['active','pending'].includes(inc.status))return;
  const displayed=eocDemo||eocSelected();
  emergencyAttention={id:inc._uuid||inc.id,demo,user:currentUser?.id||'guest'};
  selectedIncidentId=inc._uuid||inc.id;
  if(!demo)eocDemo=null;
  if(currentPage==='overview'&&(displayed?._uuid||displayed?.id)!==(inc._uuid||inc.id))renderPage('overview');
  emergencySyncAttention();emergencyOpenPopup();
}
emergencyIndicator.onclick=emergencyOpenPopup;
emergencyPopup.querySelector('.emergency-popup-view').onclick=()=>{
  const inc=emergencyCurrentAttention();emergencyPopup.close();if(!inc)return;
  selectedIncidentId=inc._uuid||inc.id;eocDemo=emergencyAttention.demo?inc:null;
  navigate('overview');
  const card=document.querySelector('.eoc-incident');
  if(card){card.setAttribute('tabindex','-1');card.focus({preventScroll:true});card.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
};
const emergencyOriginalSimulate=eocSimulate;
eocSimulate=function(type){emergencyOriginalSimulate(type);const inc=eocDemoReports.get('DEMO-'+String(type).toUpperCase());if(inc)emergencyShowAttention(inc,true);};
const emergencyOriginalAutoAlert=triggerAutoAlert;
triggerAutoAlert=function(inc){emergencyOriginalAutoAlert(inc);emergencyShowAttention(inc);};
const emergencyOriginalRender=renderPage;
renderPage=function(page){emergencyOriginalRender(page);emergencySyncAttention();};
const emergencyOriginalLogout=doLogout;
doLogout=async function(){emergencyAttention=null;emergencySyncAttention();return emergencyOriginalLogout();};
