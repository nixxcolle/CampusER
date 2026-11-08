/* Run with Playwright available and Chrome installed: node verify-pi-browser.cjs */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
  const root=path.resolve(process.argv[2] || __dirname);
  const screenshotDir=process.env.CAMPUS_ER_SCREENSHOT_DIR;
  let mode='pi', status=200, requests=0, delay=false, started, release;
  const rows=[{
    event_id:'STATION-01-0011223344556677-1',station_id:'STATION-01',
    location:'<img src=x onerror="window.fixtureInjected=true">Station 1 Bench',
    category:'MEDICAL',receiving_office:'clinic',received_at:'2026-11-07T16:10:00Z',
    occurred_at_unix:null,uptime_ms:'1234'
  }];
  rows.push({...rows[0],event_id:'STATION-01-0011223344556677-0',location:'Station 1 Bench',received_at:'2026-11-07T15:55:00Z'});
  const roleCases=[
    {role:'clinic',office:'School Clinic',category:'medical',type:'Medical Emergency',title:'Reports — School Clinic',headers:['Time Reported','Building','Floor','Room','Priority','Transcript Available','Current Status'],stats:4},
    {role:'security',office:'Campus Security',category:'security',type:'Security Threat',title:'Reports — Campus Security',headers:['Time Reported','Building','Floor','Room','Priority','Threat Description','Status'],stats:3},
    {role:'drrmo',office:'DRRMO',category:'fire',type:'Fire/Disaster',title:'Reports — DRRMO',headers:['Time Reported','Building','Floor','Room','Priority','Incident Type','Current Status'],stats:3},
    {role:'admin',office:'Administrator',category:'general',type:'General Emergency',title:'Reports — Administrator',headers:[],stats:0},
  ];
  async function roleReports(fixture){
    return page.evaluate(fixture=>{
      const saved={role:currentRole,incidents:liveIncidents};
      try{
        currentRole=fixture.role;
        // Rendering fixtures only; API office authorization is covered separately.
        liveIncidents=saved.incidents.map(incident=>({...incident,category:fixture.category,type:fixture.type,office:fixture.office}));
        renderPage('reports');
        const container=document.getElementById('page-reports');
        return {
          title:container.querySelector('h1').textContent,
          headers:[...container.querySelectorAll('table thead th')].map(node=>node.textContent),
          stats:[...container.querySelectorAll('.stat-row .stat-value')].map(node=>node.textContent),
          statuses:[...container.querySelectorAll('.status-pill')].map(node=>({text:node.textContent,className:node.className})),
          rows:[...container.querySelectorAll('table tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent)),
          rowButtons:container.querySelectorAll('table tbody button').length,
          catalogs:[...container.querySelectorAll('.records-catalog .panel-body')].map(node=>node.textContent),
          images:container.querySelectorAll('img').length,
          mutations:[...container.querySelectorAll('button')].filter(button=>/updateReportStatus|openEditReport|deleteReport|openCreateReport/.test(button.getAttribute('onclick')||'')).length,
        };
      }finally{currentRole=saved.role;liveIncidents=saved.incidents;}
    },fixture);
  }
  let page;
  const captureStates={};
  async function assertActive(pageName){
    assert.deepEqual(await page.locator('#sidebar-nav .nav-item.active').evaluateAll(nodes=>nodes.map(node=>node.id)),['nav-'+pageName]);
  }
  async function layoutSnapshot(kind){
    await page.evaluate(kind=>{
      window.fixtureSavedLayout={incidents:liveIncidents,page:currentPage};
      liveIncidents=kind==='incidents'?[]:[{
        ...liveIncidents[0],id:'STATION-01-0011223344556677-1',_uuid:'STATION-01-0011223344556677-1',
        type:'Medical Emergency',category:'medical',building:'Station 1 Bench',location:'Station 1 Bench',
        floor:'',room:'',date:'Nov 8, 2026',time:'12:10 AM',receivedAt:'2026-11-07T16:10:00Z',
        status:'active',priority:'unassessed',office:'School Clinic',notes:'',stationId:'STATION-01',
      }];
      navigate(kind);
    },kind);
    await page.evaluate(()=>document.fonts.ready);
    const layout=await page.evaluate(kind=>{
      const container=document.getElementById('page-'+kind);
      const properties=['fontFamily','fontSize','fontWeight','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderTopStyle','borderTopColor','borderRadius'];
      const style=selector=>{
        const element=container.querySelector(selector);
        if(!element)return null;
        const computed=getComputedStyle(element);
        return Object.fromEntries(properties.map(property=>[property,computed[property]]));
      };
      const rect=element=>{
        const bounds=element.getBoundingClientRect();
        return Object.fromEntries(['x','y','width','height'].map(property=>[property,Number(bounds[property].toFixed(3))]));
      };
      return {
        styles:Object.fromEntries(['.page-header','.page-title','.panel','.panel-header','.records-table thead th'].map(selector=>[selector,style(selector)])),
        header:rect(container.querySelector('.page-header')),
        panels:[...container.querySelectorAll('.panel')].map(element=>{const bounds=rect(element);delete bounds.height;return bounds;}),
        tableHeads:[...container.querySelectorAll('.records-table thead th')].map(rect),
      };
    },kind);
    await capture((mode==='pi'?'pi':'cloud')+'-'+kind+'-same-data');
    await page.evaluate(()=>{
      liveIncidents=fixtureSavedLayout.incidents;
      navigate(fixtureSavedLayout.page);
      delete window.fixtureSavedLayout;
    });
    return layout;
  }
  async function capture(name){
    captureStates[name]=await page.locator('#sidebar-nav .nav-item.active').evaluateAll(nodes=>nodes.map(node=>node.id));
    if(!screenshotDir)return;
    await fs.mkdir(path.resolve(screenshotDir),{recursive:true});
    await page.screenshot({path:path.resolve(screenshotDir,name+'.png'),fullPage:true});
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/campus-er-config.js'){
        res.setHeader('Content-Type','text/javascript');
        return res.end(mode==='missing'?'':"window.CAMPUS_ER_SOURCE='"+mode+"';");
      }
      if(url.pathname==='/api/v1/staff/session'){
        if(req.headers.authorization !== 'Bearer fixture-token'){res.statusCode=401;return res.end();}
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify({office:'School Clinic'}));
      }
      if(url.pathname==='/api/v1/reports'){
        if(req.headers.authorization !== 'Bearer fixture-token'){res.statusCode=401;return res.end();}
        requests++;
        if(delay){started();await new Promise(resolve=>{release=resolve;});}
        res.statusCode=status;
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify({incidents:rows}));
      }
      const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep))throw new Error('outside root');
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
      res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const context=await browser.newContext({serviceWorkers:'block',timezoneId:'UTC',viewport:{width:1366,height:768}});
    page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-08T00:30:00+08:00'));
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    await page.route(/\/vendor\/supabase\.min\.js(?:\?|$)/,route=>route.fulfill({contentType:'text/javascript',body:`
      const staff={id:'fixture-staff',email:'staff@example.test',user_metadata:{}};
      const cloudReports=[{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',emergency_type:'Medical Emergency',assigned_office:'School Clinic',building:'Cloud Clinic',floor:'Ground Floor',room:'Room 101',created_at:'2026-11-07T10:08:00Z',status:'pending',priority_level:'medium'}];
      window.fixtureUser=${mode==='pi'?'staff':'null'};
      window.fixtureQueries=[];
      const listeners=[];
      window.supabase={createClient:()=>({
        auth:{
          getSession:async()=>({data:{session:fixtureUser?{user:fixtureUser,access_token:'fixture-token'}:null}}),
          signInWithPassword:async()=>({data:{user:window.fixtureUser=staff}}),
          signOut:async()=>{window.fixtureUser=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));},
          onAuthStateChange:fn=>listeners.push(fn)
        },
        from:table=>{
          fixtureQueries.push(table);
          const q={select:()=>q,eq:()=>q,order:()=>q,single:async()=>({data:{fullname:'Cloud Staff',office:'School Clinic',employee_id:'fixture'},error:null}),then:fn=>Promise.resolve({data:table==='emergency_reports'?cloudReports:[],error:null}).then(fn)};
          return q;
        },
        channel:()=>{const q={on:()=>q,subscribe:()=>q};return q;},
        removeChannel:()=>{}
      })};
    `}));
    const origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.eoc-dashboard');
    await page.evaluate(()=>clearTimeout(piDashboard.timer));
    assert.equal(await page.evaluate(()=>currentProfile.office),'School Clinic');
    assert.equal(await page.evaluate(()=>currentProfile.fullname),'staff@example.test');
    assert.equal(await page.locator('.sidebar-office-label').innerText(),'School Clinic');
    assert.deepEqual(await page.evaluate(()=>fixtureQueries),[]);
    for(const selector of ['.signin-quick-access','#role-shift-switcher','.eoc-response-actions','.eoc-test-panel'])
      assert.equal(await page.locator(selector).isVisible(),false,selector);
    assert.match(await page.locator('.eoc-priority-tag').innerText(),/UNASSESSED/);
    await page.evaluate(()=>navigate('incidents'));
    const incidentPage=page.locator('#page-incidents');
    const piTitle=await incidentPage.locator('h1').innerText();
    const piHeaders=await incidentPage.locator('.records-incidents .records-table thead th').allTextContents();
    assert.equal(piTitle,'Medical Emergency Reports');
    assert.deepEqual(piHeaders,['ID','Type','Location','Priority','Reported','Status','Actions']);
    assert.equal(await incidentPage.locator('.pi-report-table').count(),0);
    const piTable=incidentPage.locator('.records-incidents .records-table');
    const piRow=piTable.locator('tbody tr').first();
    assert.equal(await piRow.locator('td').count(),7);
    assert.equal(await piRow.locator('td').first().innerText(),rows[0].event_id);
    assert.equal(await piRow.locator('.records-location strong').innerText(),rows[0].location);
    assert.equal(await piRow.locator('.records-location span').innerText(),'STATION-01');
    assert.match(await piRow.locator('.priority-badge').innerText(),/^unassessed$/i);
    assert.equal(await piRow.locator('.status-pill').innerText(),'Not tracked');
    assert.equal(await piRow.locator('.status-pill.active,.status-pill.pending,.status-pill.resolved').count(),0);
    assert.equal(await piTable.locator('img').count(),0);
    assert.equal(await piRow.locator('button').count(),1);
    const statusFilter=incidentPage.locator('.page-header-right select');
    assert.equal(await statusFilter.isDisabled(),true);
    assert.match(await statusFilter.getAttribute('title'),/response status.*not tracked/i);
    const refreshButton=incidentPage.getByRole('button',{name:/Refresh/});
    assert.equal(await refreshButton.getAttribute('onclick'),"piRefreshPage('incidents')");
    await assertActive('incidents');
    await page.evaluate(()=>piRefreshPage('incidents'));
    await assertActive('incidents');
    await capture('pi-incidents');
    const piIncidentLayout=await layoutSnapshot('incidents');
    await piRow.getByRole('button',{name:/View/}).click();
    assert.equal(await page.locator('#detail-body img').count(),0);
    assert.equal(await page.locator('#detail-subtitle').innerText(),rows[0].event_id);
    assert.match(await page.locator('#detail-body').innerText(),/Station 1 Bench/);
    assert.equal(await page.evaluate(()=>window.fixtureInjected||false),false);
    await page.locator('#detail-modal .detail-close').click();
    await page.locator('#nav-reports').click();
    const reportsPage=page.locator('#page-reports');
    assert.equal(await reportsPage.locator('h1').innerText(),'Reports — School Clinic');
    assert.deepEqual(await reportsPage.locator('.stat-row .stat-value').allInnerTexts(),['1','—','—','—']);
    assert.match(await reportsPage.innerText(),/Daily Incident Summary/);
    assert.match(await reportsPage.innerText(),/Medical Cases Log/);
    assert.match(await reportsPage.innerText(),/Response status not tracked on Pi/);
    await assertActive('reports');
    await capture('pi-reports');
    const piReportLayout=await layoutSnapshot('reports');
    const piReports=new Map();
    for(const fixture of roleCases){
      const view=await roleReports(fixture);
      piReports.set(fixture.role,view);
      assert.equal(view.title,fixture.title);
      assert.deepEqual(view.headers,fixture.headers);
      assert.equal(view.stats.length,fixture.stats);
      assert.equal(view.images,0);
      assert.equal(view.mutations,0);
      if(fixture.role==='admin'){
        assert.equal(view.catalogs.length,6);
        assert.match(view.catalogs.find(text=>text.includes('Campus Station Audits')),/Station health not available[\s\S]*— records loaded/);
      }else{
        assert.deepEqual(view.stats,['1',...Array(fixture.stats-1).fill('—')]);
        assert.equal(view.rows.length,2);
        assert.equal(view.rows[0][1],rows[0].location);
        assert.deepEqual([view.rows[0][2],view.rows[0][3]],['—','—']);
        assert.equal(view.rows[0][4].toLowerCase(),'unassessed');
        if(fixture.role==='clinic')assert.equal(view.rows[0][5],'—');
        assert.equal(view.rowButtons,0);
        assert.deepEqual(view.statuses.map(status=>status.text),['Not tracked','Not tracked']);
        assert.equal(view.statuses.every(status=>status.className==='status-pill untracked'),true);
      }
    }
    await page.evaluate(()=>renderPage('reports'));
    delay=true;
    const reportsRefreshStarted=new Promise(resolve=>{started=resolve;});
    rows[1].received_at='2026-11-07T16:05:00Z';
    await reportsPage.getByRole('button',{name:/Refresh/}).click();
    await reportsRefreshStarted;
    assert.equal(await reportsPage.locator('.stat-value').first().innerText(),'1');
    delay=false;
    release();
    await page.waitForFunction(()=>document.querySelector('#page-reports .stat-value')?.textContent==='2');
    assert.equal(await reportsPage.locator('table tbody tr').count(),2);
    await page.locator('#nav-incidents').click();
    delay=true;
    const navigationRefreshStarted=new Promise(resolve=>{started=resolve;});
    await refreshButton.click();
    await navigationRefreshStarted;
    await page.locator('#nav-reports').click();
    delay=false;
    release();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>currentPage),'reports');
    assert.equal(await page.locator('#page-reports').count(),1);
    assert.equal(await page.locator('#page-incidents').count(),0);
    await page.locator('#nav-incidents').click();
    await page.evaluate(async()=>{
      await updateReportStatus(liveIncidents[0]._uuid,'resolved');
      await doCreateReport({preventDefault(){}});
      await openEditReport(liveIncidents[0]._uuid);
      await doEditReport({preventDefault(){}});
      await deleteReport(liveIncidents[0]._uuid,'fixture');
    });
    assert.deepEqual(await page.evaluate(()=>[typeof quickAccessRole,typeof bypassLogin,typeof switchRoleShift]),['undefined','undefined','undefined']);
    assert.equal(await page.evaluate(()=>currentRole),'clinic');
    assert.deepEqual(await page.evaluate(()=>fixtureQueries),[]);
    await page.evaluate(()=>{
      window.fixtureAlerts=[];
      const showAttention = emergencyShowAttention;
      emergencyShowAttention = (...args) => { fixtureAlerts.push(args[0].id); return showAttention(...args); };
    });
    rows.push({...rows[0],event_id:'STATION-01-0011223344556677-2'});
    const before=requests;
    await page.evaluate(()=>Promise.all([fetchReports(),fetchReports(),fetchReports()]));
    assert.equal(requests-before,1);
    await page.evaluate(()=>fetchReports());
    assert.deepEqual(await page.evaluate(()=>fixtureAlerts),['STATION-01-0011223344556677-2']);
    assert.equal(await page.locator('.emergency-attention-popup').isVisible(),true);
    assert.match(await page.locator('.emergency-attention-popup').innerText(),/Medical Emergency/);
    assert.match(await page.locator('.emergency-attention-popup').innerText(),/Receiving office: School Clinic/);
    assert.equal(await page.locator('.emergency-attention-popup img').count(),0);
    status=403;
    await page.evaluate(()=>fetchReports());
    assert.equal(await page.locator('#screen-login').isVisible(),true);
    assert.equal(await page.locator('.emergency-attention-popup').isVisible(),false);
    assert.equal(await page.locator('.emergency-top-indicator').isVisible(),false);
    assert.equal(await page.evaluate(()=>liveIncidents.length),0);
    assert.equal(await page.evaluate(()=>piDashboard.timer),null);
    status=200;
    await page.evaluate(()=>loadProfileAndShow(fixtureUser));
    await page.waitForSelector('.eoc-dashboard');
    await page.evaluate(()=>clearTimeout(piDashboard.timer));
    await page.locator('#nav-incidents').click();
    delay=true;
    const pending=new Promise(resolve=>{started=resolve;});
    await page.evaluate(()=>{void piRefreshPage('incidents');});
    await pending;
    await page.locator('.sidebar-bottom>.btn-logout').click();
    release();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>liveIncidents.length),0);
    assert.equal(await page.evaluate(()=>currentUser),null);
    assert.equal(await page.locator('#screen-login').isVisible(),true);
    delay=false;
    mode='supabase';
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    assert.equal(await page.evaluate(()=>PI_MODE),false);
    const beforeCloud=requests;
    await page.locator('#email').fill('staff@example.test');
    await page.locator('#password').fill('fixture-password');
    await page.locator('#login-btn').click();
    await page.waitForSelector('.eoc-dashboard');
    assert.deepEqual(await page.evaluate(()=>fixtureQueries.slice(-2).sort()),['emergency_reports','stations']);
    assert.equal(requests,beforeCloud);
    assert.equal(await page.locator('#role-shift-switcher,.eoc-test-panel').count(),0);
    assert.equal(await page.locator('.sidebar-office-label').innerText(),'School Clinic');
    await page.locator('#nav-incidents').click();
    assert.equal(await incidentPage.locator('h1').innerText(),piTitle);
    assert.deepEqual(await incidentPage.locator('.records-table thead th').allTextContents(),piHeaders);
    assert.equal(await incidentPage.locator('.page-header-right select').isDisabled(),false);
    const cloudRow=incidentPage.locator('.records-table tbody tr').first();
    assert.equal(await cloudRow.locator('td').count(),7);
    assert.match(await cloudRow.innerText(),/Cloud Clinic/);
    assert.match(await cloudRow.locator('.status-pill').innerText(),/Pending/);
    assert.equal(await cloudRow.locator('button').count(),4);
    assert.doesNotMatch(await cloudRow.innerText(),/Not tracked/);
    await assertActive('incidents');
    await page.evaluate(()=>fetchReports());
    await assertActive('incidents');
    await capture('cloud-incidents');
    const cloudIncidentLayout=await layoutSnapshot('incidents');
    assert.deepEqual(cloudIncidentLayout,piIncidentLayout,'Pi/cloud empty Incident Records geometry and computed styles');
    await page.locator('#nav-reports').click();
    assert.match(await reportsPage.innerText(),/Daily Incident Summary/);
    assert.match(await reportsPage.innerText(),/Medical Cases Log/);
    assert.doesNotMatch(await reportsPage.innerText(),/Response status not tracked on Pi/);
    await assertActive('reports');
    await capture('cloud-reports');
    const cloudReportLayout=await layoutSnapshot('reports');
    assert.deepEqual(cloudReportLayout,piReportLayout,'Pi/cloud same-fixture Clinic Reports geometry and computed styles');
    for(const fixture of roleCases){
      const view=await roleReports(fixture);
      assert.equal(view.title,piReports.get(fixture.role).title);
      assert.deepEqual(view.headers,piReports.get(fixture.role).headers);
      assert.equal(view.stats.length,fixture.stats);
      assert.equal(view.stats.every(value=>/^\d+$/.test(value)),true);
      assert.equal(view.statuses.every(status=>status.text.includes('Pending')),true);
      if(fixture.role==='admin'){
        assert.equal(view.catalogs.length,6);
        assert.match(view.catalogs.find(text=>text.includes('Campus Station Audits')),/0 records loaded/);
      }else{
        assert.equal(view.rows.length,1);
        assert.deepEqual(view.rows[0].slice(1,4),['Cloud Clinic','Ground Floor','Room 101']);
      }
    }
    mode='missing';
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    assert.equal(await page.evaluate(()=>PI_MODE),true);
    assert.match(await page.locator('#login-error').innerText(),/configuration could not load/);
    assert.deepEqual(await page.evaluate(()=>fixtureQueries),[]);
    assert.deepEqual(errors,[]);
    if(screenshotDir){
      await fs.writeFile(path.resolve(screenshotDir,'layout-check.json'),JSON.stringify({captureStates,incidents:piIncidentLayout,reports:piReportLayout},null,2));
    }
    console.log('PASS browser: shared Pi/cloud Incidents and all four Reports layouts, Manila-day counts, honest read-only Pi fields, delayed refresh/navigation/logout guards, authenticated fetch, XSS safety, Medical popup deduplication, access loss, cloud staff sign-in, and missing-config lockout.');
    await context.close();
  }finally{
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
