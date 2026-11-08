const piDashboard = {
  generation: 0,
  controller: null,
  timer: null,
  refresh: null,
  office: null,
  seen: null,
  lastUpdated: null,
  stale: false,
};
const piReady = document.readyState === 'loading'
  ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve();

const PI_OFFICES = {
  clinic: 'School Clinic',
  security: 'Campus Security',
  fire_disaster: 'DRRMO',
  general: 'Administrator',
};
const PI_CATEGORIES = {
  MEDICAL: ['Medical Emergency', 'medical'],
  SECURITY: ['Security Threat', 'security'],
  FIRE_DISASTER: ['Fire/Disaster', 'fire'],
  GENERAL: ['General Emergency', 'general'],
};

function piStop() {
  piDashboard.generation++;
  piDashboard.controller?.abort();
  clearTimeout(piDashboard.timer);
  piDashboard.controller = null;
  piDashboard.timer = null;
  piDashboard.refresh = null;
  piDashboard.office = null;
  piDashboard.seen = null;
  piDashboard.lastUpdated = null;
  piDashboard.stale = false;
  currentUser = null;
  currentProfile = { fullname: '', office: '', employee_id: '' };
  liveIncidents = [];
  stationList = [];
  selectedIncidentId = null;
  window._detailUUID = null;
  document.getElementById('main-canvas').textContent = '';
  document.getElementById('detail-modal').classList.remove('open');
  if (typeof eocDemoReports !== 'undefined') eocDemoReports.clear();
  if (typeof eocDemo !== 'undefined') eocDemo = null;
  if (typeof eocResponses !== 'undefined') eocResponses.clear();
  if (typeof eocStopVoice === 'function') eocStopVoice();
  if (typeof emergencyClearAttention === 'function') emergencyClearAttention();
}

function piLoginMessage(message) {
  const element = document.getElementById('login-error');
  element.textContent = message;
  element.classList.add('visible');
}

function piRequireLogin(message) {
  piStop();
  showLogin();
  piLoginMessage(message);
}

function piReadOnly() {
  showToast('This Pi dashboard displays stored reports. Response and report changes are unavailable.');
}

async function piRequest(path, signal = piDashboard.controller?.signal) {
  const { data, error } = await sb.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || session.user?.id !== currentUser?.id) {
    const failure = new Error('Sign in with an approved staff account to view the Pi reports.');
    failure.status = 401;
    throw failure;
  }
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const failure = new Error(response.status === 403
      ? 'This staff account needs an office assignment from the Pi administrator.'
      : response.status === 401
        ? 'Your Pi staff session could not be verified. Sign in again.'
        : 'The Pi dashboard service could not complete the request.');
    failure.status = response.status;
    throw failure;
  }
  return response.json();
}

async function piSignIn(event) {
  event.preventDefault();
  if (window.CAMPUS_ER_SOURCE !== 'pi') {
    piLoginMessage('Data source configuration could not load. Reconnect and reload this page.');
    return;
  }
  const button = document.getElementById('login-btn');
  document.getElementById('login-error').classList.remove('visible');
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    });
    if (error || !data?.user) {
      piLoginMessage(error?.message || 'Sign in with an approved staff account.');
      return;
    }
    await piLoadProfileAndShow(data.user);
  } catch {
    piLoginMessage('Unable to sign in. Check the network and Supabase authentication service.');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign In to CAMPUS-ER';
  }
}

async function piLoadProfileAndShow(user) {
  piStop();
  currentUser = user;
  piDashboard.controller = new AbortController();
  const generation = piDashboard.generation;
  try {
    const { office } = await piRequest('/api/v1/staff/session');
    await piReady;
    if (generation !== piDashboard.generation) return;
    if (!Object.hasOwn(OFFICE_TO_ROLE, office)) throw new Error('Unknown staff office');
    piDashboard.office = office;
    currentRole = OFFICE_TO_ROLE[office];
    currentProfile = {
      fullname: user.user_metadata?.fullname || user.email || 'Staff',
      employee_id: '',
      office,
    };
    showApp(currentProfile);
  } catch (error) {
    if (generation !== piDashboard.generation) return;
    piRequireLogin(error.status === 401 || error.status === 403
      ? error.message
      : 'Unable to verify your assigned office with the Pi. Check its API and network connection.');
  }
}

function piRowToIncident(row) {
  const category = Object.hasOwn(PI_CATEGORIES, row?.category) ? PI_CATEGORIES[row.category] : null;
  const office = Object.hasOwn(PI_OFFICES, row?.receiving_office) ? PI_OFFICES[row.receiving_office] : null;
  const received = new Date(row?.received_at);
  if (!category || !office || typeof row.location !== 'string' || !row.location.trim() ||
      typeof row.event_id !== 'string' || typeof row.station_id !== 'string' ||
      typeof row.received_at !== 'string' ||
      !/^[A-Za-z0-9_-]{1,79}$/.test(row.event_id) ||
      !/^STATION-[0-9]{2}$/.test(row.station_id) || !Number.isFinite(received.getTime())) {
    throw new Error('Invalid Pi incident');
  }
  return {
    id: row.event_id,
    _uuid: row.event_id,
    stationId: row.station_id,
    type: category[0],
    category: category[1],
    building: row.location,
    floor: '',
    room: '',
    location: row.location,
    date: received.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }),
    time: received.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Manila' }),
    receivedAt: row.received_at,
    occurredAtUnix: row.occurred_at_unix,
    uptimeMs: row.uptime_ms,
    status: 'active',
    priority: 'unassessed',
    office,
    reporter: row.station_id,
    notes: '',
  };
}

function piUpdateStatus(stale = piDashboard.stale) {
  piDashboard.stale = stale;
  const element = document.getElementById('pi-dashboard-status');
  if (!element) return;
  element.classList.toggle('is-stale', stale);
  const updated = piDashboard.lastUpdated?.toLocaleTimeString('en-PH') || 'not yet loaded';
  element.textContent = stale
    ? `Pi refresh failed. Last update ${updated}. Displayed reports may be stale.`
    : `Raspberry Pi · read-only staff view · Updated ${updated} · Refresh every 5 seconds · Station health unavailable`;
}

async function piFetchReports() {
  if (!piDashboard.office || !currentUser) return;
  if (piDashboard.refresh) return piDashboard.refresh;
  const generation = piDashboard.generation;
  const refresh = (async () => {
    try {
      const data = await piRequest('/api/v1/reports');
      if (generation !== piDashboard.generation) return;
      if (!Array.isArray(data.incidents)) throw new Error('Invalid Pi report response');
      const incidents = data.incidents.map(piRowToIncident);
      const added = piDashboard.seen ? incidents.filter(incident => !piDashboard.seen.has(incident.id)) : [];
      if (!piDashboard.seen) piDashboard.seen = new Set();
      incidents.forEach(incident => piDashboard.seen.add(incident.id));
      liveIncidents = incidents;
      piDashboard.lastUpdated = new Date();
      piUpdateStatus(false);
      buildSidebar();
      added.forEach(triggerAutoAlert);
    } catch (error) {
      if (generation !== piDashboard.generation) return;
      if (error.status === 401 || error.status === 403) piRequireLogin(error.message);
      else piUpdateStatus(true);
    } finally {
      if (generation === piDashboard.generation) piDashboard.refresh = null;
    }
  })();
  piDashboard.refresh = refresh;
  return refresh;
}

function piStartPolling() {
  clearTimeout(piDashboard.timer);
  const generation = piDashboard.generation;
  const poll = async () => {
    if (generation !== piDashboard.generation) return;
    await piFetchReports();
    if (generation !== piDashboard.generation) return;
    renderPage(currentPage);
    piDashboard.timer = setTimeout(poll, 5000);
  };
  piUpdateStatus();
  piDashboard.timer = setTimeout(poll, 5000);
}

function piReportStats(incidents, today, labels) {
  const day = new Intl.DateTimeFormat('en-PH', { dateStyle: 'short', timeZone: 'Asia/Manila' });
  const todayKey = day.format(today);
  const receivedToday = incidents.filter(incident => day.format(new Date(incident.receivedAt)) === todayKey).length;
  return [
    { label: labels[0], value: receivedToday, color: 'var(--ink)' },
    ...labels.slice(1).map(label => ({
      label, value: '—', color: 'var(--ink-3)',
    })),
  ];
}

async function piRefreshPage(page) {
  const generation = piDashboard.generation;
  await piFetchReports();
  if (generation === piDashboard.generation && piDashboard.office && currentPage === page) renderPage(page);
}

function piOpenDetail(id) {
  const incident = liveIncidents.find(row => row.id === id);
  if (!incident) return;
  document.getElementById('detail-title').textContent = incident.type;
  document.getElementById('detail-subtitle').textContent = incident.id;
  document.getElementById('detail-body').innerHTML = `<div class="detail-grid">${[
    ['Event ID', incident.id], ['Station', incident.stationId],
    ['Registered location', incident.location], ['Receiving office', incident.office],
    ['Pi received at', incident.receivedAt], ['Storage', 'Saved on Raspberry Pi'],
    ['Priority', 'Unassessed'], ['Voice transcript', 'Not available'],
    ['Device occurrence (Unix seconds)', incident.occurredAtUnix ?? 'Clock unsynchronized at activation'],
    ['Device uptime (milliseconds)', incident.uptimeMs],
  ].map(([label, value]) => `<div class="detail-field"><label>${eocEscape(label)}</label>
    <div class="df-val pi-event-id">${eocEscape(value)}</div></div>`).join('')}</div>`;
  document.getElementById('detail-modal').classList.add('open');
}

function piBuildSettings() {
  return `<div class="page-header"><h1 class="page-title">Pi Dashboard</h1></div><div class="panel">
    <div class="panel-body"><p>Signed in for ${eocEscape(piDashboard.office)}.</p>
    <p>Incident records come from the Raspberry Pi. This staff view refreshes every five seconds.
    Authentication uses Supabase and the Pi's approved office assignment.</p>
    <p>Station health, response changes, audio, and synchronization are separate integration steps.</p></div></div>`;
}
