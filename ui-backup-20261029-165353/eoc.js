/* Presentation layer only. Demo incidents never enter liveIncidents or Supabase. */
let eocDemo = null;
const eocDemoReports = new Map();
const eocReceives = inc => currentRole==='admin' || OFFICE_TO_ROLE[inc?.office]===currentRole;
const eocDemoForOffice = () => [...eocDemoReports.values()].filter(eocReceives);
let eocVoiceLanguage = 'en';
const eocResponses = new Map();
let eocUtterance = null;
const eocPriority = inc => ['critical','high','medium','low'].includes(String(inc?.priority).toLowerCase()) ? String(inc.priority).toUpperCase() : 'UNASSIGNED';
const eocResponseKey = inc => `${currentUser?.id || 'guest'}:${inc?._uuid}`;
const eocResponse = inc => inc?.status==='resolved' ? '' : inc && eocDemoReports.get(inc.id)===inc ? inc.response || '' : eocResponses.get(eocResponseKey(inc)) || '';
const eocEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eocIcon = name => `<span class="eoc-icon" data-lucide-react="${name}" aria-hidden="true"></span>`;
const eocBuildings = [
  ['Administration Building',55,60,145,72],['College of Engineering',260,60,170,82],
  ['ICT Building',490,60,140,72],['Security Office',525,208,110,65],
  ['College of Education',55,215,145,78],['Science Building',265,215,165,78],
  ['College of Arts and Sciences',55,365,145,72],['University Library',265,365,165,72],
  ['School Clinic',490,365,140,72],['DRRMO Office',520,295,115,45]
];
function eocMatches(a,b) {
  const key=s=>['Arts','Engineering','Science','ICT','Security','Education','Library','Clinic','DRRMO','Admin'].find(k=>String(s).includes(k));
  return a===b || !!key(a)&&key(a)===key(b);
}
function buildCampusMap(mini=false, focusInc=null) {
  if(currentRole==='admin')return eocMonitoringMap();
  const inc = focusInc || liveIncidents.find(i=>i.status==='active');
  const focus = inc && ['active','acknowledged'].includes(inc.status) ? eocBuildings.find(b=>eocMatches(b[0],inc.building||'')) : null;
  const view = focus ? `${Math.max(0,Math.min(340,focus[1]-90))} ${Math.max(0,Math.min(220,focus[2]-85))} 360 280` : '0 0 700 500';
  return `<div class="eoc-map ${focus?'is-focused':''}">
    <div class="eoc-map-status"><span class="eoc-dot"></span>${focus?'Incident location':'Campus overview'}</div>
    <svg viewBox="${view}" role="img" aria-label="Campus map${focus?' focused on '+eocEscape(focus[0]):''}" xmlns="http://www.w3.org/2000/svg">
      <defs><pattern id="eoc-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#dce3e9"/></pattern></defs>
      <rect width="700" height="500" fill="#f8fafb"/><rect width="700" height="500" fill="url(#eoc-grid)"/>
      <path d="M0 175H700 M225 0V500 M460 0V500 M0 345H700" stroke="#e5eaef" stroke-width="18" fill="none"/>
      <path d="M0 175H700 M225 0V500 M460 0V500 M0 345H700" stroke="white" stroke-width="2" stroke-dasharray="8 8" fill="none"/>
      ${eocBuildings.map(b=>{const selected=focus===b;return `<g class="eoc-building ${selected?'selected':focus?'muted':''}"><rect x="${b[1]}" y="${b[2]}" width="${b[3]}" height="${b[4]}" rx="9"/><rect class="roof" x="${b[1]+9}" y="${b[2]+9}" width="${b[3]-18}" height="${b[4]-18}" rx="5"/><text x="${b[1]+b[3]/2}" y="${b[2]+b[4]/2+3}" text-anchor="middle">${eocEscape(b[0].replace('College of ','').replace(' Building',''))}</text>${selected?`<circle class="eoc-map-pulse" cx="${b[1]+b[3]/2}" cy="${b[2]-12}" r="8"/><circle cx="${b[1]+b[3]/2}" cy="${b[2]-12}" r="4" fill="#dc3545"/>`:''}</g>`}).join('')}
    </svg>
    ${inc?`<div class="eoc-location"><strong>${eocEscape(inc.building)}</strong><span>${eocEscape(inc.room)} · ${eocEscape(inc.type)}</span></div>`:`<div class="eoc-location"><strong>All campus buildings</strong><span>Select an emergency to inspect its location</span></div>`}
    <span class="eoc-map-note">Schematic campus view</span>
  </div>`;
}
function buildOverview() {
  const officeDemos=eocDemoForOffice();
  if(!eocDemo||!eocReceives(eocDemo)||!eocDemoReports.has(eocDemo.id))eocDemo=myIncidents().some(i=>i.id===selectedIncidentId||i._uuid===selectedIncidentId)?null:officeDemos.find(i=>i.id===selectedIncidentId)||officeDemos.at(-1)||null;
  const all=myIncidents();
  const inc=eocDemo || all.find(i=>i.id===selectedIncidentId||i._uuid===selectedIncidentId) || all.find(i=>i.status==='active') || all[0];
  const demo=!!eocDemo;
  const ai=inc?generateAIAnalysis(inc):null;
  const priority=eocPriority(inc);
  const response=eocResponse(inc);
  const resolved=inc?.status==='resolved';
  const acknowledged=inc?.status==='acknowledged'||!!response;
  const active=all.filter(i=>i.status==='active').length;
  const officeIcon={clinic:'HeartPulse',security:'ShieldCheck',drrmo:'Flame',admin:'Command'}[currentRole];
  return `<div class="eoc-dashboard">
    <div class="eoc-heading"><div><div class="eoc-eyebrow">${eocIcon('Radio')} CAMPUS-ER / OPERATIONS</div><h1>${eocEscape(ROLES[currentRole].title||ROLES[currentRole].label)}</h1><p>One campus. A coordinated response.</p></div><div class="eoc-shift">${eocIcon(officeIcon)}<div><strong>${eocEscape(currentProfile.fullname)}</strong><span><span class="eoc-dot"></span> ${eocEscape(currentProfile.office)} · On duty</span></div></div></div>
    <div class="eoc-metrics"><div>${eocIcon('Siren')}<span>Active emergencies<strong>${active}<small>Requires attention</small></strong></span></div><div>${eocIcon('ClipboardList')}<span>Total reports<strong>${all.length}<small>Incident overview</small></strong></span></div><div>${eocIcon('ShieldCheck')}<span>Resolved<strong>${all.filter(i=>i.status==='resolved').length}<small>Response completed</small></strong></span></div><div class="eoc-audio">${eocIcon('AudioLines')}<label for="eoc-volume">Alert audio</label><input id="eoc-volume" type="range" min="0" max="1" step=".05" value="${audioVolume}" oninput="setAudioVolume(this.value)"><button class="btn btn-secondary" onclick="eocToggleMute(this)">${eocIcon(audioMuted?'VolumeX':'Volume2')} ${audioMuted?'Unmute':'Mute'}</button></div></div>
    ${demo?`<div class="eoc-demo-banner">${eocIcon('FlaskConical')} <strong>Hardware simulation</strong><span>Sample voice report · No database changes</span><button onclick="eocClearDemo()">Exit preview ${eocIcon('X')}</button></div>`:''}
    <div class="eoc-columns">
      <section class="eoc-card eoc-map-card"><header><div><span class="eoc-eyebrow">SITUATIONAL AWARENESS</span><h2>${eocIcon('Map')} Campus map</h2></div><button class="eoc-icon-button" onclick="navigate('map')" aria-label="Open full campus map">${eocIcon('Expand')}</button></header>${buildCampusMap(true,inc||null)}</section>
      <div class="eoc-response-column">
        <section class="eoc-card eoc-incident ${inc?'has-incident':''}"><header><h2>${eocIcon('Siren')} Emergency alert</h2><span class="eoc-label ${resolved?'is-resolved':''}">${demo?'DEMO':inc?eocEscape(inc.status):'STANDBY'}</span></header>
        ${inc?`<div class="eoc-incident-body"><div class="eoc-incident-topline"><span class="eoc-eyebrow">${eocEscape(inc.id)}</span><span>${eocIcon('Clock3')} ${eocEscape(inc.time)}</span></div><h3>${eocEscape(inc.type)}</h3><div class="eoc-priority-tag level-${priority.toLowerCase()}">${eocIcon('TriangleAlert')} ${priority} PRIORITY</div><div class="eoc-address">${eocIcon('MapPin')}<div><strong>${eocEscape(inc.building)}</strong><span>${eocEscape(inc.room)}</span></div></div><div class="eoc-assigned"><span>Assigned response unit</span><strong>${eocIcon(officeIcon)} ${eocEscape(inc.office)}</strong></div></div>`:`<div class="eoc-empty">${eocIcon('ShieldCheck')}<h3>Campus on standby</h3><p>No active emergency. New reports will appear here as they arrive.</p></div>`}
        ${all.length>1?`<div class="eoc-incident-list"><label for="eoc-incident-select">Inspect report</label><select id="eoc-incident-select" onchange="eocDemo=null;selectIncident(this.value)">${all.map(i=>`<option value="${eocEscape(i.id)}" ${inc?.id===i.id?'selected':''}>${eocEscape(i.type)} · ${eocEscape(i.building)}</option>`).join('')}</select></div>`:''}</section>
        <section class="eoc-response-actions" aria-label="Emergency response actions">
          <div class="eoc-action-heading"><span class="eoc-eyebrow">RESPONSE CONTROL</span>${demo?'<span>Simulation only</span>':''}</div>
          <div class="eoc-actions"><button class="btn btn-secondary" onclick="eocAcknowledge()" ${!inc||resolved||acknowledged?'disabled':''}>${eocIcon('CheckCheck')} ${acknowledged?'Acknowledged':'Acknowledge'}</button><button class="btn btn-primary" onclick="eocDispatch()" ${!inc||resolved||response?'disabled':''}>${eocIcon(response?'Truck':'Send')} ${response==='en-route'?'On the way':response==='requested'?'Dispatch requested':'Dispatch Responders'}</button></div>
          ${inc?`<div class="eoc-response-state ${response?'is-enroute':''}" role="status" aria-live="polite">${eocIcon(response?'Truck':resolved?'CircleCheck':acknowledged?'CheckCheck':'Radio')}<div><strong>${resolved?'Incident resolved':response==='en-route'?'Responders on the way':response==='requested'?'Dispatch requested':acknowledged?'Report acknowledged':'Awaiting response'}</strong><span>${resolved?'Response completed.':response==='en-route'?'Help is coming to '+eocEscape(inc.room)+'.':response==='requested'?'Awaiting responder confirmation.':acknowledged?'The response team has seen this report.':'Acknowledge the report and coordinate responders.'}</span>${response==='en-route'?'<small>Simulated responder status</small>':''}</div></div>`:''}
          ${inc&&!resolved?`<div class="eoc-response-progress" aria-label="Response progress"><span class="done">Received</span><span class="${acknowledged?'done':''}">Acknowledged</span><span class="${response==='en-route'?'done':''}">${response==='requested'?'Requested':'On the way'}</span></div><button class="eoc-resolve" onclick="eocResolve()">${eocIcon('CircleCheck')} Mark resolved</button>`:''}
        </section>
      </div>
      <aside class="eoc-intelligence"><div class="eoc-intel-title">${eocIcon('ScanLine')} EMERGENCY INTELLIGENCE</div>
        <section class="eoc-card eoc-voice"><header><h2>${eocIcon('AudioLines')} Voice Recording</h2>${demo?'<span class="eoc-recording-dot" aria-label="Simulated recording"></span>':''}</header><div class="eoc-transcript">${inc?`${demo?`<div class="eoc-player"><button class="eoc-player-button" id="eoc-voice-play" onclick="eocPlay()" aria-label="Play simulated voice recording">${eocIcon('Play')}</button><div class="eoc-audio-bars" aria-hidden="true">${Array.from({length:24},(_,i)=>`<i style="--bar:${[8,16,24,12,28,20,14][i%7]}px;--delay:${i*.04}s"></i>`).join('')}</div></div><p class="eoc-sample-note">Simulated hardware voice</p>`:'<p class="eoc-help">No voice recording attached.</p>'}<div class="eoc-transcript-heading">${eocIcon('TextQuote')} Transcript</div><p class="eoc-transcript-text" dir="auto">${eocEscape(inc.notes==='No transcript.'?'Transcript not yet available.':inc.notes)}</p>`:'<p class="eoc-help">Voice recording and transcript will appear with a report.</p>'}</div></section>
        <section class="eoc-card eoc-ai"><header><h2>${eocIcon('Sparkles')} AI Analysis</h2></header><div class="eoc-ai-priority"><span class="eoc-eyebrow">PRIORITY LEVEL</span><strong class="level-${priority.toLowerCase()}">${inc?eocIcon('ShieldAlert')+' '+priority:'—'}</strong></div><details class="eoc-recommendations"><summary>${eocIcon('ListChecks')} Recommendations ${eocIcon('ChevronDown')}</summary><div>${ai?`<ul>${ai.protocol.map(p=>`<li>${eocEscape(p)}</li>`).join('')}</ul>`:'<p class="eoc-help">Select a report to view recommendations.</p>'}</div></details></section>
      </aside>
    </div>
    <details class="eoc-test-panel" ${matchMedia('(max-width:900px)').matches?'':'open'}><summary>${eocIcon('FlaskConical')} Simulation tools ${eocIcon('ChevronDown')}</summary><p>Hardware voice preview</p><label class="eoc-sample-language" for="eoc-sample-language">Sample voice report<select id="eoc-sample-language" onchange="eocVoiceLanguage=this.value"><option value="en" ${eocVoiceLanguage==='en'?'selected':''}>English</option><option value="fil" ${eocVoiceLanguage==='fil'?'selected':''}>Filipino / Tagalog</option><option value="war" ${eocVoiceLanguage==='war'?'selected':''}>Waray-Waray</option></select></label>${[['medical','HeartPulse','Medical Emergency'],['security','ShieldAlert','Security Threat'],['fire','Flame','Fire/Disaster'],['general','Siren','General Emergency']].map(([key,icon,label])=>`<button onclick="eocSimulate('${key}')">${eocIcon(icon)}${label}</button>`).join('')}<button class="eoc-clear" onclick="eocClearDemo()">${eocIcon('RotateCcw')} Clear preview</button></details>
  </div>`;
}

function eocSelected(){return liveIncidents.find(i=>i.id===selectedIncidentId||i._uuid===selectedIncidentId)||liveIncidents.find(i=>i.status==='active')||liveIncidents[0];}
function eocAcknowledge(){if(currentRole==='admin')return;const i=eocDemo||eocSelected();if(!i||i.status==='resolved')return;if(eocDemo){i.status='acknowledged';renderPage('overview');showToast('Demo report acknowledged');}else updateReportStatus(i._uuid,'acknowledged');}
function eocResolve(){if(currentRole==='admin')return;const i=eocDemo||eocSelected();if(!i)return;if(eocDemo){i.status='resolved';i.response='';eocStopVoice();renderPage('overview');showToast('Demo incident resolved');}else updateReportStatus(i._uuid,'resolved');}
const eocDispatching=new Set();
async function eocDispatch(){
  if(currentRole==='admin')return;
  const i=eocDemo||eocSelected();if(!i||i.status==='resolved'||eocResponse(i))return;
  if(eocDemo){i.status='acknowledged';i.response='en-route';renderPage('overview');showToast('Responders on the way\n'+i.building+' · '+i.room+'\nSimulated response');return;}
  const key=eocResponseKey(i);if(eocDispatching.has(key))return;eocDispatching.add(key);
  try{await updateReportStatus(i._uuid,'acknowledged');const refreshed=liveIncidents.find(r=>r._uuid===i._uuid);if(refreshed?.status==='acknowledged'){eocResponses.set(key,'requested');if(currentPage==='overview')renderPage('overview');showToast('Dispatch requested\nAwaiting responder confirmation.');}}
  catch{showToast('Dispatch could not be saved. Please retry.');}
  finally{eocDispatching.delete(key);}
}
function eocVoiceState(playing){
  document.querySelector('.eoc-player')?.classList.toggle('is-playing',playing);
  const button=document.getElementById('eoc-voice-play');if(button){button.innerHTML=eocIcon(playing?'Pause':'Play');button.setAttribute('aria-label',playing?'Stop simulated voice recording':'Play simulated voice recording');}
}
function eocStopVoice(){if(eocUtterance&&'speechSynthesis' in window)window.speechSynthesis.cancel();eocUtterance=null;eocVoiceState(false);}
function eocPlay(automatic=false){
  const i=eocDemo;if(!i)return;
  if(eocUtterance&&!automatic){eocStopVoice();return;}
  eocStopVoice();if(audioMuted||audioVolume===0){if(!automatic)showToast('Audio is muted. Enable alert audio to play the sample.');return;}
  if(!('speechSynthesis' in window)){showToast('Voice playback is unavailable in this browser. The sample transcript is ready.');return;}
  // shortcut: speech synthesis stands in for hardware recordings in this mockup; replace when the hardware audio feed exists.
  const utter=new SpeechSynthesisUtterance(i.notes);const lang={en:'en-PH',fil:'fil-PH',war:'war-PH'}[i.voiceLanguage]||'en-PH';
  const voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().split('-')[0]===lang.split('-')[0]);
  utter.lang=lang;if(voice)utter.voice=voice;utter.rate=.92;utter.volume=audioVolume;
  eocUtterance=utter;eocVoiceState(true);
  utter.onend=()=>{if(eocUtterance===utter){eocUtterance=null;eocVoiceState(false);}};
  utter.onerror=e=>{if(eocUtterance!==utter)return;eocUtterance=null;eocVoiceState(false);if(!['canceled','interrupted'].includes(e.error))showToast('Voice playback could not start. Press Play to retry; the transcript remains available.');};
  try{speechSynthesis.speak(utter);}catch{eocUtterance=null;eocVoiceState(false);showToast('Press Play to start the sample voice.');}
}
function eocToggleMute(button){toggleMute();if(audioMuted)eocStopVoice();button.innerHTML=eocIcon(audioMuted?'VolumeX':'Volume2')+' '+(audioMuted?'Unmute':'Mute');}
function eocClearDemo(){eocStopVoice();eocDemoReports.clear();eocDemo=null;renderPage('overview');}
function eocSimulate(type){
  const cases={medical:['Medical Emergency','College of Engineering','Room 101','School Clinic','A student needs medical assistance in Room 101.'],security:['Security Threat','ICT Building','Server corridor','Campus Security','An unauthorized entry has been reported near the server corridor.'],fire:['Fire/Disaster','Science Building','Room 204','DRRMO','Smoke has been reported in Room 204. Please assess the area.'],general:['General Emergency','Administration Building','Main lobby','Administrator','Assistance requested at the main lobby.']};
  const c=cases[type];if(!c)return;
  const transcripts={
    fil:{medical:'May estudyanteng nangangailangan ng tulong medikal sa Room 101, College of Engineering.',security:'May iniulat na hindi awtorisadong pagpasok malapit sa server corridor ng ICT Building.',fire:'May naiulat na usok sa Room 204 ng Science Building. Kailangan ng agarang tulong.',general:'Humihingi ng tulong sa main lobby ng Administration Building.'},
    war:{medical:'May estudyante nga nagkikinahanglan hin bulig medikal ha Room 101, College of Engineering.',security:'May tawo nga waray permiso nga sinulod hirani ha server corridor han ICT Building.',fire:'May aso ha Room 204 han Science Building. Kinahanglan hin madagmit nga bulig.',general:'Kinahanglan hin bulig ha main lobby han Administration Building.'}
  };
  eocStopVoice();
  eocDemo={id:'DEMO-'+type.toUpperCase(),type:c[0],building:c[1],room:c[2],office:c[3],notes:transcripts[eocVoiceLanguage]?.[type]||c[4],voiceLanguage:eocVoiceLanguage,priority:{medical:'critical',security:'high',fire:'critical',general:'medium'}[type],status:'active',category:type,time:new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})};
  eocDemoReports.set(eocDemo.id,eocDemo);
  if(!eocReceives(eocDemo)){eocDemo=null;renderPage('overview');showToast('Demo routed to '+c[3]+'\nAdministrator can monitor this report.');return;}
  renderPage('overview');showToast(c[0]+'\n'+c[1]+'\n'+c[2]);eocPlay(true);
}
function showToast(msg){
  if(String(msg).includes('New emergency reported')&&liveIncidents[0]){const i=liveIncidents[0];msg=i.type+'\n'+i.building+'\n'+i.room;}
  let host=document.getElementById('eoc-toasts');if(!host){host=document.createElement('div');host.id='eoc-toasts';host.setAttribute('aria-live','polite');document.body.append(host);}
  const toast=document.createElement('div');toast.className='eoc-toast';
  const clean=String(msg).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').trim();
  toast.innerHTML=eocIcon('CircleAlert')+'<div>'+clean.split('\n').map((s,i)=>i?'<span>'+eocEscape(s)+'</span>':'<strong>'+eocEscape(s)+'</strong>').join('')+'</div><button aria-label="Dismiss notification">'+eocIcon('X')+'</button>';
  toast.querySelector('button').onclick=()=>toast.remove();host.append(toast);while(host.children.length>4)host.firstElementChild.remove();
  setTimeout(()=>{toast.classList.add('leaving');setTimeout(()=>toast.remove(),220);},5000);
}
