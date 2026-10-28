/* Presentation layer only. Demo incidents never enter liveIncidents or Supabase. */
let eocDemo = null;
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
  return a===b || ['Engineering','Science','ICT','Security','Education','Arts','Library','Clinic','DRRMO','Admin'].some(k=>a.includes(k)&&b.includes(k));
}
function buildCampusMap(mini=false, focusInc=null) {
  const inc = focusInc || liveIncidents.find(i=>i.status==='active');
  const focus = inc && inc.status==='active' ? eocBuildings.find(b=>eocMatches(b[0],inc.building||'')) : null;
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
    ${inc&&inc.status==='active'?`<div class="eoc-location"><strong>${eocEscape(inc.building)}</strong><span>${eocEscape(inc.room)} · ${eocEscape(inc.type)}</span></div>`:`<div class="eoc-location"><strong>All campus buildings</strong><span>Select an emergency to inspect its location</span></div>`}
    <span class="eoc-map-note">Schematic campus view</span>
  </div>`;
}
function buildOverview() {
  const all=myIncidents();
  const inc=eocDemo || all.find(i=>i.id===selectedIncidentId||i._uuid===selectedIncidentId) || all.find(i=>i.status==='active') || all[0];
  const demo=!!eocDemo;
  const ai=inc?generateAIAnalysis(inc):null;
  const active=all.filter(i=>i.status==='active').length;
  const valid=inc&&!demo&&inc._uuid;
  return `<div class="eoc-dashboard">
    <div class="eoc-heading"><div><div class="eoc-eyebrow">${eocIcon('Radio')} EMERGENCY OPERATIONS CENTER</div><h1>${eocEscape(ROLES[currentRole].title||ROLES[currentRole].label)}</h1><p>Campus awareness. Coordinated response.</p></div><div class="eoc-shift"><span class="eoc-dot"></span><div><strong>${eocEscape(currentProfile.fullname)}</strong><span>${eocEscape(currentProfile.office)} · On duty</span></div></div></div>
    <div class="eoc-metrics"><div>${eocIcon('Activity')}<span>Active emergencies<strong>${active}</strong></span></div><div>${eocIcon('ClipboardList')}<span>Total reports<strong>${all.length}</strong></span></div><div>${eocIcon('CheckCircle2')}<span>Resolved<strong>${all.filter(i=>i.status==='resolved').length}</strong></span></div><div class="eoc-audio">${eocIcon('Volume2')}<label for="eoc-volume">Alert volume</label><input id="eoc-volume" type="range" min="0" max="1" step=".05" value="${audioVolume}" oninput="setAudioVolume(this.value)"><button class="btn btn-secondary" onclick="toggleMute();this.textContent=audioMuted?'Unmute':'Mute'">${audioMuted?'Unmute':'Mute'}</button></div></div>
    ${demo?`<div class="eoc-demo-banner">${eocIcon('FlaskConical')} Simulation preview · No database changes<button onclick="eocClearDemo()">Exit simulation ${eocIcon('X')}</button></div>`:''}
    <div class="eoc-columns">
      <section class="eoc-card eoc-map-card"><header><div><span class="eoc-eyebrow">SITUATIONAL AWARENESS</span><h2>${eocIcon('Map')} Campus map</h2></div><button class="eoc-icon-button" onclick="navigate('map')" aria-label="Open full campus map">${eocIcon('Maximize2')}</button></header>${buildCampusMap(true,inc||null)}</section>
      <section class="eoc-card eoc-incident"><header><h2>${eocIcon('Siren')} ${inc?'Emergency alert':'Emergency status'}</h2>${inc?`<span class="eoc-label">${demo?'DEMO':eocEscape(inc.status)}</span>`:''}</header>
      ${inc?`<div class="eoc-incident-body"><span class="eoc-eyebrow">${eocEscape(inc.id)} · ${eocEscape(inc.time)}</span><h3>${eocEscape(inc.type)}</h3><span class="priority-badge priority-${eocEscape(inc.priority)}">${eocEscape(inc.priority)} priority</span><dl><div><dt>Building</dt><dd>${eocEscape(inc.building)}</dd></div><div><dt>Room</dt><dd>${eocEscape(inc.room)}</dd></div><div><dt>Assigned office</dt><dd>${eocEscape(inc.office)}</dd></div></dl><div class="eoc-actions">${valid?`<button class="btn btn-primary" onclick="eocDispatch()">${eocIcon('Send')} Dispatch responders</button><button class="btn btn-secondary" onclick="eocAcknowledge()">${eocIcon('Check')} Acknowledge</button><button class="btn btn-secondary" onclick="eocResolve()">${eocIcon('CheckCircle2')} Mark resolved</button>`:`<p class="eoc-help">Simulation only. Response actions are disabled.</p>`}</div></div>`:`<div class="eoc-empty">${eocIcon('ShieldCheck')}<h3>No active emergency</h3><p>New reports will appear here when received. Use the demo controls to preview a response.</p></div>`}
      ${all.length>1?`<div class="eoc-incident-list"><label for="eoc-incident-select">Inspect report</label><select id="eoc-incident-select" onchange="eocDemo=null;selectIncident(this.value)">${all.map(i=>`<option value="${eocEscape(i.id)}" ${inc?.id===i.id?'selected':''}>${eocEscape(i.type)} · ${eocEscape(i.building)}</option>`).join('')}</select></div>`:''}</section>
      <aside class="eoc-intelligence"><div class="eoc-intel-title">${eocIcon('ScanLine')} Emergency intelligence</div><section class="eoc-card"><header><h2>${eocIcon('Mic')} Voice transcript</h2></header><div class="eoc-transcript">${inc?`<button class="btn btn-secondary" id="vt-play-btn" onclick="eocPlay()" aria-label="Play or stop transcript">${eocIcon('Play')} Play transcript</button><p>${eocEscape(inc.notes)}</p>`:`<p class="eoc-help">A transcript will appear with the selected report.</p>`}</div></section><details class="eoc-card eoc-ai"><summary>${eocIcon('Sparkles')} AI Analysis ${eocIcon('ChevronDown')}</summary><div>${ai?`<span class="eoc-eyebrow">PRIORITY LEVEL</span><p><strong>${eocEscape(inc.priority)}</strong></p><h4>Recommendations</h4><ul>${ai.protocol.map(p=>`<li>${eocEscape(p)}</li>`).join('')}</ul><h4>Keywords</h4><div class="eoc-keywords">${ai.keywords.map(k=>`<span>${eocEscape(k)}</span>`).join('')}</div>`:`<p class="eoc-help">Select a report to view its analysis.</p>`}</div></details></aside>
    </div>
    <details class="eoc-test-panel" ${matchMedia("(max-width:900px)").matches?"":"open"}><summary>${eocIcon('FlaskConical')} Simulation tools ${eocIcon('ChevronDown')}</summary><p>Local preview only</p>${[['medical','HeartPulse','Medical Emergency'],['security','Shield','Security Threat'],['fire','Flame','Fire/Disaster'],['general','Siren','General Emergency']].map(([key,icon,label])=>`<button onclick="eocSimulate('${key}')">${eocIcon(icon)}${label}</button>`).join('')}<button class="eoc-clear" onclick="eocClearDemo()">${eocIcon('RotateCcw')} Clear preview</button></details>
  </div>`;
}
function eocSelected(){return liveIncidents.find(i=>i.id===selectedIncidentId||i._uuid===selectedIncidentId)||liveIncidents.find(i=>i.status==='active')||liveIncidents[0];}
function eocAcknowledge(){const i=eocSelected();if(!eocDemo&&i)updateReportStatus(i._uuid,'acknowledged');}
function eocResolve(){const i=eocSelected();if(!eocDemo&&i)updateReportStatus(i._uuid,'resolved');}
function eocDispatch(){const i=eocSelected();if(!eocDemo&&i)dispatchRespondersForActive(i._uuid,i.building,i.room);}
function eocPlay(){const i=eocDemo||eocSelected();if(i)playIncidentAudio(i.notes);}
function eocClearDemo(){eocDemo=null;renderPage('overview');}
function eocSimulate(type){
  const cases={medical:['Medical Emergency','College of Engineering','Room 101','School Clinic','A student needs medical assistance in Room 101.'],security:['Security Threat','ICT Building','Server corridor','Campus Security','An unauthorized entry has been reported near the server corridor.'],fire:['Fire/Disaster','Science Building','Room 204','DRRMO','Smoke has been reported in Room 204. Please assess the area.'],general:['General Emergency','Administration Building','Main lobby','Administrator','Assistance requested at the main lobby.']};
  const c=cases[type];if(!c)return;
  eocDemo={id:'DEMO-'+type.toUpperCase(),type:c[0],building:c[1],room:c[2],office:c[3],notes:c[4],priority:'high',status:'active',category:type,time:new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})};
  renderPage('overview');showToast(c[0]+'\n'+c[1]+'\n'+c[2]);
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
