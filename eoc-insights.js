/* Local mock analysis and reported device health; no backend or report mutations. */
function eocAnalyzeTranscript(inc){
  const text=String(inc?.notes||'').trim();
  const missing=!text||text==='No transcript.';
  const rules=[
    ['Medical Emergency',/\b(medical|injur(?:y|ed)|bleeding|unconscious|collapsed?|breathing|sugat|dugo|medikal|nasaktan)\b/giu,'School Clinic'],
    ['Security Threat',/\b(unauthorized|intruder|theft|weapon|assault|attack|server corridor|pagnanakaw|pananakot|waray permiso)\b/giu,'Campus Security'],
    ['Fire/Disaster',/\b(fire|smoke|flood|earthquake|sunog|usok|aso|baha|linog|lindol)\b/giu,'DRRMO']
  ];
  const detected=rules.map(([nature,pattern,office])=>({nature,office,evidence:[...text.matchAll(pattern)].map(m=>m[0])})).filter(r=>r.evidence.length);
  const critical=/\b(not breathing|cannot breathe|unconscious|unresponsive|heavy bleeding|trapped|weapon|armed|hindi humihinga|walang malay|diri nagiginhawa|waray sarabot)\b/giu;
  const urgent=/\b(smoke|fire|bleeding|collapsed?|injured|unauthorized|usok|aso|sunog|sugat|dugo|waray permiso)\b/giu;
  // shortcut: conservative keyword triage for demo transcripts; use a validated service and human review before operational decisions.
  const severityEvidence=[...text.matchAll(critical)].map(m=>m[0]);
  const urgentEvidence=[...text.matchAll(urgent)].map(m=>m[0]);
  const priority=missing?'UNASSESSED':severityEvidence.length?'CRITICAL':urgentEvidence.length?'HIGH':detected.length?'MEDIUM':'UNASSESSED';
  const nature=missing?'Awaiting transcript':detected.length?detected.map(r=>r.nature).join(' + '):'Unclear incident';
  const evidence=[...new Set([...severityEvidence,...urgentEvidence,...detected.flatMap(r=>r.evidence)])].slice(0,8);
  const room=text.match(/\b(?:room|kuwarto|silid)\s*#?\s*([\p{L}\d-]+)/iu)?.[0];
  const building=eocBuildings.find(b=>eocMatches(b[0],text))?.[0];
  const recommendations=missing?['Obtain the voice transcript before assessing the report.']:['Confirm the caller’s location and current conditions.','Have the assigned office verify this assessment before taking action.'];
  if(detected.some(r=>r.office==='DRRMO'))recommendations.push('Ask DRRMO to assess the reported hazard and coordinate site safety.');
  if(detected.some(r=>r.office==='School Clinic'))recommendations.push('Relay the transcript to clinic personnel for clinical assessment.');
  if(detected.some(r=>r.office==='Campus Security'))recommendations.push('Relay the reported threat to Campus Security and confirm scene safety.');
  if(!missing&&!detected.length)recommendations.push('Request a clearer description; incident type and severity cannot be inferred reliably.');
  if(/\b(no |not |walang |wala |waray |diri |hindi )/iu.test(text))recommendations.push('Check negations in the transcript; this keyword mockup may misread context.');
  return {nature,priority,evidence,room,building,recommendations,missing};
}
function eocTranscriptAnalysis(inc){
  const a=eocAnalyzeTranscript(inc);const level=a.priority.toLowerCase();
  return `<section class="eoc-card eoc-ai eoc-transcript-analysis"><header><h2>${eocIcon('Sparkles')} AI Analysis</h2><span class="eoc-local-tag">LOCAL MOCK</span></header><div class="eoc-ai-priority"><span class="eoc-eyebrow">TRANSCRIPT ASSESSMENT</span><strong class="level-${level}">${eocIcon('ShieldAlert')} ${a.priority}</strong><span class="eoc-saved-priority">Report priority: ${eocEscape(eocPriority(inc))} · unchanged</span></div><div class="eoc-analysis-details"><h4>${eocEscape(a.nature)}</h4><dl><div><dt>Location mentioned</dt><dd>${eocEscape([a.room,a.building].filter(Boolean).join(', ')||'Not identified in transcript')}</dd></div><div><dt>Report location</dt><dd>${eocEscape(inc?[inc.room,inc.building].filter(Boolean).join(', '):'No report selected')}</dd></div></dl>${a.evidence.length?`<span class="eoc-eyebrow">TRANSCRIPT CUES</span><div class="eoc-keywords">${a.evidence.map(s=>'<span>'+eocEscape(s)+'</span>').join('')}</div>`:''}<p class="eoc-analysis-limit">Keyword-based demo assessment. Verify context and severity with the receiving office.</p></div><details class="eoc-recommendations"><summary>${eocIcon('ListChecks')} View Recommendations ${eocIcon('ChevronDown')}</summary><div><h4>Recommended Actions</h4><p class="eoc-help">Suggested Response Steps</p><ol>${a.recommendations.map(r=>'<li>'+eocEscape(r)+'</li>').join('')}</ol></div></details></section>`;
}
let eocMaintenanceDemo=false;
function eocDeviceHealth(station){
  const status=String(station.status||'unknown').toLowerCase();
  if(['offline','disconnected'].includes(status))return ['Troubleshoot','Check the station power and network connection.','warning'];
  if(['maintenance','maintaining','under maintenance'].includes(status))return ['Maintenance','Inspect the station and complete scheduled servicing.','warning'];
  if(['error','fault','faulty','broken','repair'].includes(status))return ['Repair assessment','Inspect the reported fault before returning the station to service.','danger'];
  if(['online','active'].includes(status))return ['Reporting online','No fault reported; hardware diagnostics are unavailable.','healthy'];
  return ['Unmonitored','Obtain a valid device status; hardware health is unknown.','unknown'];
}
async function eocRefreshHealth(){if(currentRole!=='admin')return;await loadStations();if(currentRole==='admin'&&currentPage==='overview')renderPage('overview');}
function eocToggleHealthDemo(){if(currentRole!=='admin')return;eocMaintenanceDemo=!eocMaintenanceDemo;renderPage('overview');}
function eocHealthPanel(){
  const demo=eocMaintenanceDemo;
  const stations=demo?[{id:'DEMO-ENG',building:'College of Engineering',status:'offline'},{id:'DEMO-SCI',building:'Science Building',status:'maintenance'},{id:'DEMO-ICT',building:'ICT Building',status:'fault'},{id:'DEMO-ADM',building:'Administration Building',status:'online'}]:stationList;
  const attention=stations.filter(s=>['warning','danger'].includes(eocDeviceHealth(s)[2])).length;
  return `<section class="eoc-card eoc-health"><header><div><span class="eoc-eyebrow">DEVICE & COMPONENT MONITORING ${demo?'· DEMO':''}</span><h2>${eocIcon('Wrench')} Maintenance & troubleshooting</h2></div><button class="btn btn-secondary" onclick="eocRefreshHealth()">${eocIcon('RefreshCw')} Refresh reported status</button></header><div class="eoc-health-summary"><div>${eocIcon('RadioTower')}<strong>${stations.length}</strong><span>${demo?'Sample stations':'Registered stations'}</span></div><div>${eocIcon('TriangleAlert')}<strong>${attention}</strong><span>Need attention</span></div><div>${eocIcon('CircleHelp')}<strong>${stations.filter(s=>eocDeviceHealth(s)[2]==='unknown').length}</strong><span>Status unknown</span></div></div><div class="eoc-monitor-table-wrap"><table class="eoc-monitor-table"><thead><tr><th>Station / location</th><th>Reported status</th><th>Assessment</th><th>Suggested follow-up</th></tr></thead><tbody>${stations.length?stations.map(s=>{const [assessment,action,kind]=eocDeviceHealth(s);return `<tr><td><strong>${eocEscape(s.name||s.id||'Unnamed station')}</strong><span>${eocEscape([s.building,s.floor].filter(Boolean).join(' · ')||'Location unavailable')}${demo?' · DEMO':''}</span></td><td>${eocEscape(s.status||'Unavailable')}</td><td><span class="eoc-health-badge ${kind}">${assessment}</span></td><td>${eocEscape(action)}</td></tr>`;}).join(''):'<tr><td colspan="4" class="eoc-monitor-empty">No station status data loaded. Refresh reported status or preview sample maintenance issues.</td></tr>'}</tbody></table></div><div class="eoc-component-gaps"><strong>Component diagnostics</strong><span>Microphone, speaker, panic button, battery, and sensors: not instrumented in the current data feed.</span></div><footer><p>${demo?'Sample issues only. ':'Based on the last loaded station status. '}No heartbeat timestamps or component-level diagnostics are available; an online status does not confirm full hardware health.</p><button class="btn btn-secondary" onclick="eocToggleHealthDemo()">${eocIcon('FlaskConical')} ${demo?'Show reported devices':'Preview maintenance issues'}</button></footer></section>`;
}
const eocBeforeInsights=buildOverview;
buildOverview=function(){const box=document.createElement('div');box.innerHTML=eocBeforeInsights();const current=eocDemo||eocSelected();box.querySelector('.eoc-ai').outerHTML=eocTranscriptAnalysis(current);if(currentRole==='admin')box.querySelector('.eoc-dashboard').insertAdjacentHTML('beforeend',eocHealthPanel());return box.innerHTML;};
const eocBeforeMapColor=buildCampusMap;
buildCampusMap=function(...args){const box=document.createElement('div');box.innerHTML=eocBeforeMapColor(...args);const svg=box.querySelector('svg');if(svg){svg.classList.add('eoc-colored-map');const groups=svg.querySelectorAll('.eoc-building');groups.forEach((g,n)=>g.dataset.district=['admin','academic','technology','security','academic','science','arts','library','clinic','drrmo'][n]);}return box.innerHTML;};
// The Administrator map uses the same visual palette when rendered directly.
const eocBeforeMonitoringMap=eocMonitoringMap;
eocMonitoringMap=function(){const box=document.createElement('div');box.innerHTML=eocBeforeMonitoringMap();const svg=box.querySelector('svg');svg.classList.add('eoc-colored-map');svg.querySelectorAll('.eoc-building').forEach((g,n)=>g.dataset.district=['admin','academic','technology','security','academic','science','arts','library','clinic','drrmo'][n]);return box.innerHTML;};
