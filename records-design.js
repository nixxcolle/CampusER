/* Presentation only: keep existing data selection and action handlers. */
function recordsStyleTable(table,kind){
  table.classList.add('records-table');
  const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
  const fullIncident=kind==='incidents'&&labels.join('|')==='ID|Type|Building|Location|Priority|Date|Time|Status|Actions';
  if(fullIncident){
    const heads=table.tHead.rows[0].cells;
    heads[2].textContent='Location';heads[5].textContent='Reported';
    table.querySelectorAll('tbody tr').forEach(row=>{
      const cells=[...row.cells];if(cells.length!==9){if(cells[0])cells[0].colSpan=7;return;}
      const location=document.createElement('div');location.className='records-location';
      const building=document.createElement('strong');building.textContent=cells[2].textContent;
      const room=document.createElement('span');room.textContent=cells[3].textContent;
      location.append(building,room);cells[2].replaceChildren(location);
      const reported=document.createElement('div');reported.className='records-reported';
      const date=document.createElement('strong');date.textContent=cells[5].textContent;
      const time=document.createElement('span');time.textContent=cells[6].textContent;
      reported.append(date,time);cells[5].replaceChildren(reported);
      cells[6].remove();cells[3].remove();
    });
    heads[6].remove();heads[3].remove();
  }
  table.querySelectorAll('tbody tr').forEach(row=>{
    if(row.cells.length===1){row.classList.add('records-empty-row');return;}
    row.cells[0]?.classList.add('records-identifier');
    row.querySelectorAll('.btn-row-action').forEach(button=>{
      const text=button.textContent.trim();
      const label=/^View/.test(text)?'View':/^Ack/.test(text)?'Acknowledge':/Edit/.test(text)?'Edit':/Del/.test(text)?'Delete':text;
      const icon={View:'Eye',Acknowledge:'CheckCheck',Edit:'Pencil',Delete:'Trash2'}[label];
      if(!icon)return;
      button.classList.add('records-action',label==='Delete'?'records-action-danger':'records-action-neutral');
      button.title=label;button.setAttribute('aria-label',label+' report '+row.cells[0].textContent.trim());
      button.innerHTML=eocIcon(icon)+(label==='View'?'<span>View</span>':'');
    });
  });
  const parent=table.parentElement;
  parent.classList.add('records-table-scroll');parent.setAttribute('tabindex','0');parent.setAttribute('role','region');parent.setAttribute('aria-label','Report table; scroll to view all columns');
}
function recordsRedesign(html,kind){
  const box=document.createElement('div');box.innerHTML=html;
  const wrapper=document.createElement('div');wrapper.className='records-view records-'+kind;
  while(box.firstChild)wrapper.append(box.firstChild);
  const header=wrapper.querySelector('.page-header');
  if(header){header.classList.add('records-page-header');const title=header.querySelector('.page-header-left');if(title){const eyebrow=document.createElement('div');eyebrow.className='records-eyebrow';eyebrow.innerHTML=eocIcon(kind==='incidents'?'ClipboardList':'ChartNoAxesCombined')+(kind==='incidents'?'INCIDENT RECORDS':'REPORTING & REVIEW');title.prepend(eyebrow);}}
  wrapper.querySelectorAll('.panel').forEach(panel=>panel.classList.add('records-panel'));
  wrapper.querySelectorAll('.stat-card').forEach((card,n)=>{card.classList.add('records-stat');const icon=document.createElement('span');icon.className='records-stat-icon';icon.innerHTML=eocIcon(['Files','CircleAlert','CheckCheck','ShieldCheck'][n%4]);card.prepend(icon);});
  wrapper.querySelectorAll('table.incident-table').forEach(table=>recordsStyleTable(table,kind));
  if(kind==='incidents'){
    const panel=wrapper.querySelector('.panel');
    panel?.classList.add('records-incident-panel');
    const title=panel?.querySelector('.panel-title');if(title)title.innerHTML=eocIcon('ListChecks')+' Incident log';
    const note=document.createElement('div');note.className='records-table-note';note.innerHTML=eocIcon('ArrowLeftRight')+' Scroll within the table to view all report details.';panel?.append(note);
  }
  if(kind==='reports'){
    wrapper.querySelectorAll('.panel').forEach(panel=>{
      const title=panel.querySelector('.panel-title');
      if(title?.textContent.includes('Daily Incident Summary'))panel.classList.add('records-summary-panel');
    });
    const catalog=wrapper.querySelector('.three-col');
    if(catalog){catalog.classList.add('records-catalog');catalog.querySelectorAll('.panel-body').forEach((body,n)=>{
      const children=[...body.children];if(children.length!==5)return;
      children[0].classList.add('records-catalog-icon');children[0].innerHTML=eocIcon(['CalendarDays','HeartPulse','Shield','Flame','RadioTower','Files'][n%6]);
      children[1].classList.add('records-catalog-title');children[2].classList.add('records-catalog-subtitle');children[3].classList.add('records-catalog-count');children[4].classList.add('records-catalog-actions');
      children[4].querySelectorAll('button').forEach(button=>{const print=button.textContent.trim()==='Print';button.innerHTML=eocIcon(print?'Printer':'ArrowUpRight')+'<span>'+(print?'Print':'View Incidents')+'</span>';});
    });}
  }
  return wrapper.outerHTML;
}
const recordsOriginalIncidents=buildIncidents;
buildIncidents=function(){return recordsRedesign(recordsOriginalIncidents(),'incidents');};
const recordsOriginalReports=buildReports;
buildReports=function(){return recordsRedesign(recordsOriginalReports(),'reports');};
