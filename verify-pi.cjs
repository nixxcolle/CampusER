const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} },
    });
    return elements.get(id);
  };
  const fixture = {
    event_id: 'STATION-01-0011223344556677-1', station_id: 'STATION-01',
    location: '<img src=x onerror="alert(1)">Station 1 Bench',
    category: 'MEDICAL', receiving_office: 'clinic', received_at: '2026-11-07T10:08:00Z',
    occurred_at_unix: null, uptime_ms: '1234',
  };
  let rows = [fixture];
  let status = 200;
  let calls = 0;
  const alerts = [];
  const sandbox = {
    AbortController, setTimeout, clearTimeout, console,
    document: { readyState: 'complete', getElementById: element },
    window: {}, PI_MODE: true, currentUser: null, currentProfile: {}, currentRole: 'clinic', currentPage: 'incidents',
    liveIncidents: [], stationList: [], selectedIncidentId: null,
    OFFICE_TO_ROLE: { 'School Clinic': 'clinic' },
    sb: { auth: { getSession: async () => ({ data: { session: {
      user: { id: 'fixture-staff' }, access_token: 'fixture-token',
    } } }) } },
    fetch: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      assert.equal(options.cache, 'no-store');
      if (url === '/api/v1/staff/session') return { ok: true, json: async () => ({ office: 'School Clinic' }) };
      calls++;
      return { ok: status === 200, status, json: async () => ({ incidents: rows }) };
    },
    showApp() {}, showLogin() {}, buildSidebar() {}, renderPage() {},
    myIncidents: () => sandbox.liveIncidents,
    triggerAutoAlert: incident => alerts.push(incident.id),
    eocReceives: incident => incident.office===sandbox.currentProfile.office || incident.category==='general',
    eocEscape: value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character])),
  };
  const context = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'pi-dashboard.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'response-workflow.js'), 'utf8'), context);
  sandbox.fixture = fixture;
  assert.throws(() => run('piRowToIncident({ ...fixture, event_id: undefined })'), /Invalid Pi incident/);
  assert.throws(() => run('piRowToIncident({ ...fixture, category: "__proto__" })'), /Invalid Pi incident/);
  assert.throws(() => run('piRowToIncident({ ...fixture, audio_available: true, audio_sha256: "invalid", audio_duration_ms: 3000 })'), /Invalid Pi audio metadata/);
  assert.throws(() => run('piRowToIncident({ ...fixture, audio_available: true, audio_sha256: "a".repeat(64), audio_duration_ms: 10001 })'), /Invalid Pi audio metadata/);
  assert.equal(run('piRowToIncident({ ...fixture, audio_available: true, audio_sha256: "a".repeat(64), audio_duration_ms: 3000 }).audioSha256'), 'a'.repeat(64));
  await run('piLoadProfileAndShow({ id: "fixture-staff", email: "staff@example.test" })');
  assert.equal(sandbox.currentProfile.office, 'School Clinic');
  assert.equal(sandbox.currentProfile.fullname, 'staff@example.test');
  await run('piFetchReports()');
  assert.equal(sandbox.liveIncidents[0].id, fixture.event_id);
  assert.equal(sandbox.liveIncidents[0].location, fixture.location);
  assert.equal(sandbox.liveIncidents[0].floor, '');
  assert.equal(sandbox.liveIncidents[0].room, '');
  assert.equal(sandbox.liveIncidents[0].priority, 'unassessed');
  const stats = run(`piReportStats([
    { receivedAt: '2026-11-07T15:59:59Z' }, { receivedAt: '2026-11-07T16:00:00Z' },
  ], new Date('2026-11-07T16:30:00Z'), ['Today', 'Pending', 'Acknowledged', 'Resolved']).map(card => card.value).join(',')`);
  assert.equal(stats, '1,—,—,—');
  assert.deepEqual(alerts, []);
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const name of ['buildIncidents', 'reportStatusPill']) {
    const source = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(source, name);
    vm.runInContext(source[0], context);
  }
  assert.ok(!html.includes('piBuildIncidents'));
  const table = run('buildIncidents()');
  assert.ok(table.includes(fixture.event_id));
  assert.ok(table.includes('&lt;img'));
  assert.ok(!table.includes('<img'));
  assert.ok(table.includes('Medical Emergency Reports'));
  assert.ok(table.includes('Not tracked'));
  assert.ok(!table.includes("updateReportStatus('"));
  assert.ok(!table.includes("openEditReport('"));
  assert.ok(table.includes("piRefreshPage('incidents')"));
  const originalIncident=sandbox.liveIncidents[0];
  sandbox.liveIncidents=[originalIncident,...['pending','acknowledged','resolved'].map(status=>({...originalIncident,id:'QUEUE-'+status,status}))];
  const activeTable=run('buildIncidents()');
  assert.ok(activeTable.includes('QUEUE-pending'));
  assert.ok(!activeTable.includes('QUEUE-acknowledged'));
  assert.ok(!activeTable.includes('QUEUE-resolved'));
  assert.equal(sandbox.liveIncidents.length,4,'Filtering the active view must retain all stored reports for history');
  sandbox.liveIncidents=[originalIncident];
  assert.equal(sandbox.liveIncidents[0].notes, '');
  run(`piOpenDetail('${fixture.event_id}')`);
  assert.ok(!element('detail-body').innerHTML.includes('<img'));

  rows = [fixture, { ...fixture, event_id: 'STATION-01-0011223344556677-2' }];
  const before = calls;
  await Promise.all([run('piFetchReports()'), run('piFetchReports()')]);
  assert.equal(calls - before, 1);
  await run('piFetchReports()');
  assert.deepEqual(alerts, ['STATION-01-0011223344556677-2']);
  status = 403;
  await run('piFetchReports()');
  assert.equal(sandbox.liveIncidents.length, 0);
  assert.equal(sandbox.currentUser, null);
  assert.equal(run('piDashboard.timer'), null);

  await run('piLoadProfileAndShow({ id: "fixture-staff", email: "staff@example.test" })');
  let release;
  let started;
  const pendingStarted = new Promise(resolve => { started = resolve; });
  sandbox.fetch = async () => {
    started();
    return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ incidents: rows }) }); });
  };
  const pending = run('piFetchReports()');
  await pendingStarted;
  run('piStop()');
  release();
  await pending;
  assert.equal(sandbox.liveIncidents.length, 0);
  assert.equal(sandbox.currentUser, null);

  const handlers = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'), {
    URL,
    self: {
      registration: { scope: 'https://pi.example.test/' },
      location: { origin: 'https://pi.example.test' },
      addEventListener: (name, handler) => handlers.set(name, handler),
    },
  });
  for (const endpoint of ['/api/v1/reports', '/api/v1/staff/session', '/auth/v1/token', '/campus-er-config.js?v=previous']) {
    for (const mode of ['same-origin', 'navigate']) {
      let intercepted = false;
      handlers.get('fetch')({
        request: { method: 'GET', url: 'https://pi.example.test' + endpoint, mode },
        respondWith() { intercepted = true; },
      });
      assert.equal(intercepted, false, `${mode} ${endpoint}`);
    }
  }
  console.log('Pi frontend checks passed. Browser and live Pi deployment checks are separate.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
