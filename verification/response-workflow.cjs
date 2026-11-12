const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createApp}=require('../backend/server');
const {chromium}=require('playwright');
const actors={clinic:{id:'11111111-1111-4111-8111-111111111111',office:'School Clinic'},security:{id:'22222222-2222-4222-8222-222222222222',office:'Campus Security'},drrmo:{id:'33333333-3333-4333-8333-333333333333',office:'DRRMO'},admin:{id:'44444444-4444-4444-8444-444444444444',office:'Administrator'}};
const token='a'.repeat(64),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
(async()=>{const db=await PGlite.create(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'campus-response-'));let server,browser,delayedRead,releaseRead;const streams=[];
try{
await db.exec('CREATE ROLE campus_er_app;');for(const name of ['001_station_incidents.sql','002_incident_audio.sql','003_response_workflow.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../backend/migrations',name),'utf8'));
await db.exec(fs.readFileSync(path.join(__dirname,'../backend/migrations/003_response_workflow.sql'),'utf8'));
assert.equal((await db.query("SELECT has_column_privilege('campus_er_app','incidents','acknowledged_at','UPDATE') AS allowed")).rows[0].allowed,true);assert.equal((await db.query("SELECT has_column_privilege('campus_er_app','incidents','station_id','UPDATE') AS allowed")).rows[0].allowed,false);
await db.query('INSERT INTO stations VALUES($1,$2,$3)',['STATION-01','Station 1 Bench',hash(token)]);
await db.exec('GRANT SELECT,INSERT ON stations,incidents,incident_audio TO campus_er_app; SET ROLE campus_er_app;');
const config={supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_fixture',pwaDirectory:path.resolve(__dirname,'..'),staff:Object.fromEntries(Object.values(actors).map(a=>[a.id,a.office]))};
const authFetch=async(_url,options)=>{const role=options.headers.Authorization.replace('Bearer ','');return actors[role]?{ok:true,status:200,json:async()=>({id:actors[role].id})}:{ok:false,status:401};};
const pool={query:async(...args)=>{const result=await db.query(...args);if(delayedRead&&args[0].includes('SELECT i.event_id')&&args[1]?.[0]==='security'){const hold=delayedRead;delayedRead=null;hold.started();await hold.done;}return result;}};
const app=createApp(pool,config,authFetch,{audioDirectory:path.join(temp,'audio')});server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const origin='http://127.0.0.1:'+server.address().port;
const request=(role,url,options={})=>fetch(origin+url,{...options,headers:{Authorization:'Bearer '+role,...options.headers}});
async function subscribe(role,query=''){const controller=new AbortController(),r=await request(role,'/api/v1/events'+query,{signal:controller.signal});assert.equal(r.status,200);const stream={controller,events:[]};streams.push(stream);stream.task=(async()=>{const reader=r.body.getReader(),decoder=new TextDecoder();let pending='';try{for(;;){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let i;while((i=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,i);pending=pending.slice(i+2);if(frame.startsWith('data:')){const data=JSON.parse(frame.slice(5));if(data.event_id)stream.events.push(data.event_id);}}}}catch(e){if(e.name!=='AbortError')throw e;}})();return stream;}
const offices={};for(const role of Object.keys(actors))offices[role]=await subscribe(role,role==='security'?'?office=Administrator':'');
async function post(id,category,expectedStatus=201){const r=await fetch(origin+'/api/v1/reports',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({event_id:id,station_id:'STATION-01',location:'Station 1 Bench',category,trigger:'physical_button',uptime_ms:1000,occurred_at_unix:null})});assert.equal(r.status,expectedStatus);assert.equal(r.headers.get('X-Report-ID'),id);return id;}
async function waitFor(fn){const until=Date.now()+5000;while(!fn()){if(Date.now()>until)throw Error('Event not delivered');await new Promise(r=>setTimeout(r,15));}}
const general=await post('STATION-01-general-1','GENERAL');await waitFor(()=>Object.values(offices).every(s=>s.events.includes(general)));
const medical=await post('STATION-01-medical-1','MEDICAL');await waitFor(()=>offices.clinic.events.includes(medical)&&offices.admin.events.includes(medical));
await post(medical,'MEDICAL',200);await new Promise(r=>setTimeout(r,100));
assert.equal(offices.clinic.events.filter(id=>id===medical).length,1,'A repeated station receipt must stay quiet');
assert(!offices.security.events.includes(medical)&&!offices.drrmo.events.includes(medical));
for(const role of Object.keys(actors)){const r=await request(role,'/api/v1/reports'),data=await r.json();assert(data.incidents.some(i=>i.event_id===general));assert.equal(data.incidents.some(i=>i.event_id===medical),['clinic','admin'].includes(role));}
assert.equal((await request('security','/api/v1/reports/'+medical+'/acknowledge',{method:'POST'})).status,404);
assert.equal((await request('security','/api/v1/reports/'+general+'/acknowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({acknowledged_by:actors.admin.id})})).status,400);
const concurrent=await Promise.all(['clinic','security'].map(async role=>{const r=await request(role,'/api/v1/reports/'+general+'/acknowledge',{method:'POST'});assert.equal(r.status,200);return r.json();}));assert.deepEqual(concurrent[0],concurrent[1],'Simultaneous offices preserve one immutable receipt');const receipt=concurrent[0];assert(receipt.acknowledged_at);assert(Object.values(actors).some(a=>a.id===receipt.acknowledged_by&&a.office===receipt.acknowledged_office));
for(const role of Object.keys(actors)){const data=await(await request(role,'/api/v1/reports')).json();const incident=data.incidents.find(i=>i.event_id===general);assert.equal(incident.response_status,'acknowledged');assert.equal(incident.acknowledged_at,receipt.acknowledged_at);assert.equal(incident.acknowledged_by,receipt.acknowledged_by);}
assert.equal((await request('invalid','/api/v1/events')).status,401);assert.equal((await request('invalid','/api/v1/reports/'+general+'/acknowledge',{method:'POST'})).status,401);
const wave=Buffer.alloc(76);wave.write('RIFF');wave.writeUInt32LE(68,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(32,40);
for(const id of [general,medical])assert.equal((await request(token,'/api/v1/reports/'+id+'/audio',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wave})).status,201);
await waitFor(()=>offices.clinic.events.filter(id=>id===medical).length===2&&offices.admin.events.filter(id=>id===medical).length===2);
assert(!offices.security.events.includes(medical)&&!offices.drrmo.events.includes(medical),'Audio availability obeys report office access');
for(const role of Object.keys(actors)){const audio=await request(role,'/api/v1/reports/'+general+'/audio');assert.equal(audio.status,200);assert(Buffer.from(await audio.arrayBuffer()).equals(wave));}
assert.equal((await request('security','/api/v1/reports/'+medical+'/audio')).status,404);
assert.equal((await fetch(origin+'/backend/package.json')).status,404);assert.equal((await fetch(origin+'/%62ackend/package.json')).status,404);
streams.forEach(s=>s.controller.abort());await Promise.all(streams.map(s=>s.task));
browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});const pages={};
for(const role of Object.keys(actors)){const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());await page.route('**/vendor/supabase.min.js*',r=>r.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'${actors[role].id}',email:'${role}@example.test',user_metadata:{}},access_token:'${role}'}}}),onAuthStateChange:()=>{},signOut:async()=>{}}})};`}));await page.goto(origin);await page.waitForSelector('.eoc-dashboard');await page.evaluate(()=>{clearTimeout(piDashboard.timer);audioMuted=true;Date.now=()=>1;navigate('incidents');});assert(await page.locator('.emergency-attention-popup').isHidden());pages[role]={page,context,errors};}
const live=await post('STATION-01-live-general-1','GENERAL');
for(const {page} of Object.values(pages)){await page.locator('[data-emergency-id="'+live+'"]').first().waitFor({timeout:4500});assert(await page.locator('.emergency-attention-popup').isVisible());assert((await page.locator('.emergency-popup-list').textContent()).includes('All authorized offices'));await page.getByRole('button',{name:'Close popup',exact:true}).click();}
await pages.security.page.locator('[data-ack-id="'+live+'"]').click();
for(const {page} of Object.values(pages)){await page.waitForFunction(id=>{const i=liveIncidents.find(i=>i.id===id);return i?.status==='acknowledged'&&i.acknowledgedOffice==='Campus Security';},live,{timeout:4500});assert.equal(await page.locator('[data-ack-id="'+live+'"]').count(),0,'Acknowledged reports leave every office active list');assert.equal(await page.locator('.records-table tbody tr').filter({hasText:live}).count(),0);await page.evaluate(()=>navigate('reports'));const row=page.locator('.records-table tbody tr').filter({hasText:live});assert.equal(await row.count(),1,'The acknowledged incident remains once in history');assert((await row.textContent()).includes('Campus Security'));assert((await row.textContent()).includes('Acknowledged'));assert((await row.locator('.acknowledgment-details time').getAttribute('datetime')));}
const stored=(await db.query('SELECT * FROM incidents WHERE event_id=$1',[live])).rows[0];assert.equal(stored.acknowledged_by,actors.security.id);assert(stored.acknowledged_at.getUTCFullYear()>2000,'Server clock is independent of spoofed browser clock');
const failed=await post('STATION-01-retry-general-1','GENERAL');
for(const {page} of Object.values(pages)){await page.locator('[data-emergency-id="'+failed+'"]').first().waitFor({timeout:4500});await page.getByRole('button',{name:'Close popup',exact:true}).click();await page.evaluate(()=>navigate('incidents'));}
await db.exec('RESET ROLE; REVOKE UPDATE(response_status,acknowledged_at,acknowledged_by,acknowledged_office) ON incidents FROM campus_er_app; SET ROLE campus_er_app;');
await pages.security.page.locator('[data-ack-id="'+failed+'"]').click();await pages.security.page.waitForFunction(id=>{const button=[...document.querySelectorAll('[data-ack-id]')].find(b=>b.dataset.ackId===id);return button&&!button.disabled&&!button.textContent.includes('Saving');},failed);
assert.equal((await db.query('SELECT response_status,acknowledged_at FROM incidents WHERE event_id=$1',[failed])).rows[0].acknowledged_at,null,'A failed database write must not create history or hide the active alert');assert((await pages.security.page.locator('.emergency-tray-list').textContent()).includes(failed));
await db.exec('RESET ROLE; GRANT UPDATE(response_status,acknowledged_at,acknowledged_by,acknowledged_office) ON incidents TO campus_er_app; SET ROLE campus_er_app;');
await pages.security.page.evaluate(async()=>{if(piDashboard.refresh)await piDashboard.refresh;window.fixtureRetryToasts=[];const original=showToast;showToast=message=>{fixtureRetryToasts.push(String(message));original(message);};});
let readStarted;const startedRead=new Promise(resolve=>{readStarted=resolve;});delayedRead={started:readStarted,done:new Promise(resolve=>{releaseRead=resolve;})};
await pages.security.page.evaluate(()=>{window.fixtureOlderRead=piFetchReports();});
let readDeadline;try{await Promise.race([startedRead,new Promise((_,reject)=>{readDeadline=setTimeout(()=>reject(Error('Older snapshot request did not start')),5000);})]);}finally{clearTimeout(readDeadline);}
await pages.security.page.locator('[data-ack-id="'+failed+'"]').click();
for(let attempt=0;attempt<100;attempt++){if((await db.query('SELECT response_status FROM incidents WHERE event_id=$1',[failed])).rows[0].response_status==='acknowledged')break;await new Promise(r=>setTimeout(r,15));}
releaseRead();await pages.security.page.evaluate(()=>fixtureOlderRead);
for(const {page} of Object.values(pages)){await page.waitForFunction(id=>liveIncidents.find(i=>i.id===id)?.status==='acknowledged',failed,{timeout:4500});assert.equal(await page.locator('[data-ack-id="'+failed+'"]').count(),0);}
await pages.security.page.waitForFunction(()=>acknowledgmentRequests.size===0);
assert((await pages.security.page.evaluate(()=>fixtureRetryToasts)).some(message=>message.startsWith('Report acknowledged')),'An older in-flight read must not mask a successful acknowledgment');
await pages.clinic.page.reload();await pages.clinic.page.waitForSelector('.eoc-dashboard');await pages.clinic.page.evaluate(()=>{clearTimeout(piDashboard.timer);navigate('incidents');});assert.equal(await pages.clinic.page.locator('[data-ack-id="'+live+'"],[data-ack-id="'+failed+'"]').count(),0,'Acknowledged incidents stay out of the active list after reload');await pages.clinic.page.evaluate(()=>navigate('reports'));assert((await pages.clinic.page.locator('.records-table').textContent()).includes('Campus Security'),'Receipt survives a fresh browser load');assert.deepEqual((await pages.clinic.page.locator('.stat-row .stat-value').allTextContents()).slice(1),['1','3','0'],'History summary counts use the saved response states');assert(await pages.clinic.page.locator('.emergency-attention-popup').isHidden());await pages.clinic.page.setViewportSize({width:390,height:844});assert(await pages.clinic.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await pages.clinic.page.screenshot({path:path.resolve(__dirname,'../preview-acknowledgment-history-mobile.png'),animations:'disabled'});

const clinicPage=pages.clinic.page;
await clinicPage.waitForFunction(()=>piDashboard.eventsConnected&&!piDashboard.refresh);
const liveAudio=await post('STATION-01-live-audio-1','MEDICAL');
await clinicPage.waitForFunction(id=>liveIncidents.some(i=>i.id===id&&!i.audioAvailable),liveAudio,{timeout:4500});
assert.equal((await request(token,'/api/v1/reports/'+liveAudio+'/audio',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wave})).status,201);
await clinicPage.waitForFunction(id=>liveIncidents.some(i=>i.id===id&&i.audioAvailable),liveAudio,{timeout:4500});
assert.equal(await clinicPage.locator('.emergency-popup-list [data-emergency-id="'+liveAudio+'"]').count(),1);

let allowReconnect=false;
await clinicPage.route('**/api/v1/events',route=>allowReconnect?route.continue():route.abort());
await clinicPage.evaluate(()=>piDashboard.eventsController.abort());
await clinicPage.waitForFunction(()=>!piDashboard.eventsConnected);
const missed=await post('STATION-01-reconnect-1','MEDICAL');
assert.equal(await clinicPage.evaluate(id=>liveIncidents.some(i=>i.id===id),missed),false);
allowReconnect=true;
await clinicPage.waitForFunction(id=>piDashboard.eventsConnected&&liveIncidents.some(i=>i.id===id),missed,{timeout:4500});
await clinicPage.waitForFunction(()=>!piDashboard.refresh);

let reportReads=0;
clinicPage.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/reports')reportReads++;});
await clinicPage.evaluate(()=>piStartPolling());
await new Promise(resolve=>setTimeout(resolve,5250));
assert.equal(reportReads,0,'A healthy SSE connection should not poll reports');
allowReconnect=false;
await clinicPage.evaluate(()=>piDashboard.eventsController.abort());
await clinicPage.waitForFunction(()=>!piDashboard.eventsConnected);
const fallback=await post('STATION-01-poll-fallback-1','MEDICAL');
await clinicPage.waitForFunction(id=>liveIncidents.some(i=>i.id===id),fallback,{timeout:6000});
assert(reportReads>0,'Polling resumes while live updates are disconnected');
allowReconnect=true;
await clinicPage.waitForFunction(()=>piDashboard.eventsConnected);
assert(await clinicPage.evaluate(()=>{const connection=piDashboard.eventsController;piStop();return connection.signal.aborted;}));

for(const {errors} of Object.values(pages))assert.deepEqual(errors,[]);
console.log('PASS: PostgreSQL storage and receipts; office-scoped live reports, audio and acknowledgments; reconnect catch-up, polling fallback and logout; persisted history and mobile layout.');
}finally{releaseRead?.();streams.forEach(s=>s.controller.abort());await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.close();assert(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('campus-response-'));fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
