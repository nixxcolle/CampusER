function reportIsGeneral(incident){return incident?.type==='General Emergency';}
function reportOfficeLabel(incident){return reportIsGeneral(incident)?'All authorized offices':incident.office;}
/* Acknowledgment receipts are stamped by the database/API, never by this browser. */
const acknowledgmentRequests = new Set();
function acknowledgmentTime(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Manila'}) : 'Not recorded';
}
function acknowledgmentActor(incident) {
  return incident.acknowledgedOffice || (incident.acknowledgedBy ? 'Authorized staff' : 'Not recorded');
}
function acknowledgmentDetails(incident) {
  if (!incident.acknowledgedAt) return incident.status==='acknowledged' ? '<small class="acknowledgment-details">Legacy acknowledgment details unavailable</small>' : '';
  return `<div class="acknowledgment-details"><time datetime="${eocEscape(incident.acknowledgedAt)}">${eocEscape(acknowledgmentTime(incident.acknowledgedAt))}</time><span>${eocEscape(acknowledgmentActor(incident))}</span></div>`;
}
function acknowledgeReportButton(incident) {
  const id = incident._uuid || incident.id;
  const ready = ['active','pending'].includes(incident.status) && eocReceives(incident) && (!PI_MODE || piDashboard.acknowledgementsAvailable);
  const busy = acknowledgmentRequests.has(id);
  return `<button type="button" class="btn-row-action" data-ack-id="${eocEscape(id)}" onclick="acknowledgeReport('${eocEscape(id)}')" ${!ready||busy?'disabled':''} title="${PI_MODE&&!piDashboard.acknowledgementsAvailable?'Acknowledgment is unavailable on this Pi':'Acknowledge receipt of this report'}">${busy?'Saving…':incident.status==='acknowledged'?'Acknowledged':'Acknowledge'}</button>`;
}
async function acknowledgeReport(id) {
  const incident = liveIncidents.find(row=>(row._uuid||row.id)===id);
  if (!incident || !eocReceives(incident) || !['active','pending'].includes(incident.status) || acknowledgmentRequests.has(id)) return false;
  if (PI_MODE && !piDashboard.acknowledgementsAvailable) { showToast('Acknowledgment is unavailable on this Pi. The report has not been changed.'); return false; }
  const user = currentUser?.id, generation = PI_MODE ? piDashboard.generation : null;
  acknowledgmentRequests.add(id);
  const buttons=[...document.querySelectorAll('[data-ack-id]')].filter(button=>button.dataset.ackId===id);
  buttons.forEach(button=>{button.disabled=true;button.textContent='Saving…';});
  try {
    if (PI_MODE) await piRequest('/api/v1/reports/'+encodeURIComponent(id)+'/acknowledge',piDashboard.controller?.signal,{method:'POST'});
    else {
      const {error} = await sb.rpc('acknowledge_emergency_report',{p_report_id:id});
      if (error) throw Object.assign(new Error('The acknowledgment could not be saved.'),{code:error.code});
    }
    if (currentUser?.id!==user || (PI_MODE && piDashboard.generation!==generation)) return false;
    if (PI_MODE && piDashboard.refresh) await piDashboard.refresh;
    if (currentUser?.id!==user || (PI_MODE && piDashboard.generation!==generation)) return false;
    await fetchReports();
    if (currentUser?.id!==user || (PI_MODE && piDashboard.generation!==generation)) return false;
    renderPage(currentPage);
    const saved = liveIncidents.find(row=>(row._uuid||row.id)===id);
    if (!saved?.acknowledgedAt || !['acknowledged','resolved'].includes(saved.status)) throw new Error('The saved acknowledgment could not be confirmed. Refresh and retry.');
    showToast('Report acknowledged — saved in Reports history\n'+acknowledgmentActor(saved)+'\n'+acknowledgmentTime(saved.acknowledgedAt));
    return true;
  } catch (error) {
    if (currentUser?.id===user && error.name!=='AbortError') showToast(error.code==='PGRST202'?'Acknowledgment is not available yet. Please contact your administrator.':'Acknowledgment could not be confirmed. Refresh and retry.');
    return false;
  } finally {
    acknowledgmentRequests.delete(id);
    const latest=liveIncidents.find(row=>(row._uuid||row.id)===id);
    [...document.querySelectorAll('[data-ack-id]')].filter(button=>button.dataset.ackId===id).forEach(button=>{
      button.disabled=!latest||!['active','pending'].includes(latest.status)||!eocReceives(latest)||(PI_MODE&&!piDashboard.acknowledgementsAvailable);
      button.classList.add('records-action','records-action-neutral');
      button.innerHTML=eocIcon('CheckCheck')+'<span>'+(latest?.status==='acknowledged'?'Acknowledged':'Acknowledge')+'</span>';
    });
  }
}
function incidentHistoryPanel(incidents) {
  return `<section class="panel acknowledgment-history"><div class="panel-header"><div class="panel-title">Incident response history</div></div>${buildIncidentLogTable(incidents,[
    {label:'Incident',fn:i=>eocEscape(i.id)}, {label:'Emergency Type',fn:i=>eocEscape(i.type)},
    {label:'Location',fn:i=>eocEscape(i.location||[i.building,i.floor,i.room].filter(Boolean).join(' · '))},
    {label:'Reported',fn:i=>eocEscape(i.date+' · '+i.time)}, {label:'Status / acknowledgment',fn:reportStatusPill}
  ])}</section>`;
}
