/* Original station recordings share the existing Overview playback card. */
const piAudio = {
  generation: 0, key: null, controller: null, audio: null, url: null,
  loading: false, error: '',
};
const piIncomingAudio = {
  generation: 0, pending: new Map(), seen: new Set(), timer: null,
  controller: null, audio: null, url: null, loading: false, blocked: false, manual: false,
};

function piAudioIncident() {
  if (!PI_MODE || !currentUser || !piDashboard.office || currentPage !== 'overview') return null;
  const incident = eocSelected();
  return liveIncidents.find(row => row === incident) || null;
}

function piAudioKey(incident) {
  if (!incident || incident.audioAvailable !== true ||
      !/^[A-Za-z0-9_-]{1,79}$/.test(incident.id) ||
      !/^[a-f0-9]{64}$/.test(incident.audioSha256)) return null;
  return JSON.stringify([piDashboard.generation, currentUser?.id, piDashboard.office,
    incident.id, incident.audioSha256]);
}

function piStopAudio() {
  piIncomingAudio.manual = false;
  piAudio.generation++;
  piAudio.controller?.abort();
  const audio = piAudio.audio;
  const url = piAudio.url;
  Object.assign(piAudio, { key: null, controller: null, audio: null, url: null, loading: false, error: '' });
  if (audio) {
    audio.onplay = audio.onpause = audio.onended = audio.onerror = audio.onloadedmetadata = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (url) URL.revokeObjectURL(url);
}

function piAudioState() {
  const incident = piAudioIncident();
  const key = piAudioKey(incident);
  if (piAudio.key !== key) {
    piStopAudio();
    piAudio.key = key;
  }
  return incident;
}

function piAudioStatus(incident) {
  if (piAudio.loading || (piIncomingAudio.loading && piIncomingAudio.incident?.id === incident?.id)) return 'Loading station recording…';
  if (piAudio.error) return piAudio.error;
  const audio = piRecordingPlayer(incident);
  const seconds = Number.isFinite(audio?.duration) ? audio.duration
    : Number.isInteger(incident?.audioDurationMs) && incident.audioDurationMs > 0
      ? incident.audioDurationMs / 1000 : null;
  return `${audio && !audio.paused ? 'Playing' : 'Original station recording'}${seconds === null ? '' : ` · ${seconds.toFixed(1)} s`}`;
}

function piRecordingPlayer(incident) {
  return piIncomingAudio.incident?.id === incident?.id ? piIncomingAudio.audio : piAudio.audio;
}

function piAudioMarkup(incident) {
  if (!PI_MODE) return '';
  piAudioState();
  if (!piAudio.key || incident !== piAudioIncident()) return '<p class="eoc-help">No voice recording attached.</p>';
  const audio = piRecordingPlayer(incident), playing = audio && !audio.paused;
  return `<div class="eoc-player${playing ? ' is-playing' : ''}">
    <button type="button" class="eoc-player-button" id="pi-audio-play" onclick="piPlayAudio()" aria-label="${playing ? 'Pause' : 'Play'} station recording" ${piAudio.loading ? 'disabled' : ''}>${eocIcon(playing ? 'Pause' : 'Play')}</button>
    <div class="eoc-audio-bars" aria-hidden="true">${Array.from({ length: 24 }, (_, i) => `<i style="--bar:${[8,16,24,12,28,20,14][i % 7]}px;--delay:${i * .04}s"></i>`).join('')}</div>
    </div><p class="eoc-help" id="pi-audio-status" role="status" aria-live="polite">${eocEscape(piAudioStatus(incident))}</p>`;
}

function piAudioSync() {
  const incident = piAudioState();
  piPlayNextRecording();
  const button = document.getElementById('pi-audio-play');
  if (!button || !piAudio.key) return;
  const audio = piRecordingPlayer(incident), playing = audio && !audio.paused;
  button.disabled = piAudio.loading;
  button.innerHTML = eocIcon(playing ? 'Pause' : 'Play');
  button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} station recording`);
  button.closest('.eoc-player')?.classList.toggle('is-playing', Boolean(playing));
  const status = document.getElementById('pi-audio-status');
  if (status) status.textContent = piAudioStatus(incident);
}

function piAudioVolume() {
  if (audioMuted || audioVolume === 0) piStopIncomingRecording();
  for (const audio of [piAudio.audio, piIncomingAudio.audio]) if (audio) {
    audio.volume = Number.isFinite(audioVolume) ? Math.max(0, Math.min(1, audioVolume)) : .85;
    audio.muted = Boolean(audioMuted);
  }
  piAudioSync();
}

async function piReadRecording(incident, signal, current) {
  const { data, error } = await sb.auth.getSession();
  if (!current()) return null;
  const session = data?.session;
  if (error || !session?.access_token || session.user?.id !== currentUser?.id) {
    piRequireLogin('Sign in again to play the station recording.');
    return null;
  }
  const response = await fetch(`/api/v1/reports/${encodeURIComponent(incident.id)}/audio`, {
    headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'audio/wav' },
    cache: 'no-store', redirect: 'error', signal,
  });
  if (!current()) return null;
  if (response.status === 401 || response.status === 403) {
    piRequireLogin('Your Pi audio access could not be verified. Sign in again.');
    return null;
  }
  if (!response.ok) throw new Error(response.status === 404
    ? 'No recording is available for this report.' : 'The recording could not load. Press Play to retry.');
  const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const maxBytes = 1024 * 1024;
  if (!['audio/wav', 'audio/x-wav'].includes(type) || Number(response.headers.get('Content-Length')) > maxBytes) {
    throw new Error('The Pi did not return a WAV recording.');
  }
  const blob = await response.blob();
  if (!current()) return null;
  const bytes = await blob.arrayBuffer();
  const header = String.fromCharCode(...new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength)));
  if (bytes.byteLength < 44 || bytes.byteLength > maxBytes || header.slice(0, 4) !== 'RIFF' || header.slice(8, 12) !== 'WAVE') {
    throw new Error('The Pi did not return a WAV recording.');
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (!current()) return null;
  if (digest !== incident.audioSha256) throw new Error('Recording integrity check failed. Press Play to retry.');
  return blob;
}

async function piPlayAudio() {
  const incident = piAudioState();
  if (!piAudio.key || piAudio.loading) return;
  if (audioMuted || audioVolume === 0) {
    showToast('Audio is muted. Enable alert audio to play the recording.');
    return;
  }
  if (piIncomingAudio.incident?.id === incident.id && piIncomingAudio.audio) {
    const audio = piIncomingAudio.audio;
    if (!audio.paused) {
      piIncomingAudio.manual = true;
      audio.pause();
    } else {
      try { await audio.play(); piIncomingAudio.manual = false; }
      catch { showToast('Press Play to start the original recording.'); }
    }
    piAudioSync();
    return;
  }
  piStopIncomingRecording();
  piIncomingAudio.manual = true;
  piIncomingAudio.blocked = false;
  if (piAudio.audio && !piAudio.audio.paused) {
    piAudio.audio.pause();
    return;
  }
  const generation = piAudio.generation;
  const key = piAudio.key;
  const current = () => generation === piAudio.generation && key === piAudio.key &&
    key === piAudioKey(piAudioIncident());
  piAudio.error = '';
  try {
    if (!piAudio.audio) {
      piAudio.loading = true;
      piAudio.controller = new AbortController();
      piAudioSync();
      const blob = await piReadRecording(incident, piAudio.controller.signal, current);
      if (!blob || !current()) return;
      const audio = new Audio();
      piAudio.url = URL.createObjectURL(blob);
      piAudio.audio = audio;
      audio.preload = 'metadata';
      audio.src = piAudio.url;
      audio.onplay = audio.onpause = audio.onloadedmetadata = () => {
        if (current() && piAudio.audio === audio) piAudioSync();
      };
      audio.onended = () => {
        if (!current()) return;
        piIncomingAudio.manual = false;
        piAudioSync();
      };
      audio.onerror = () => {
        if (!current() || piAudio.audio !== audio) return;
        piAudio.error = 'The recording could not play. Press Play to retry.';
        piIncomingAudio.manual = false;
        piIncomingAudio.pending.delete(incident.id);
        piAudioSync();
      };
      piAudio.loading = false;
    }
    if (!current()) return;
    piAudioVolume();
    await piAudio.audio.play();
    if (current()) piIncomingAudio.pending.delete(incident.id);
  } catch (error) {
    if (!current() || error.name === 'AbortError') return;
    piAudio.error = error.name === 'NotAllowedError' ? 'Press Play to start the recording.'
      : ['The Pi did not return a WAV recording.', 'No recording is available for this report.', 'Recording integrity check failed. Press Play to retry.'].includes(error.message)
        ? error.message : 'The recording could not load or play. Press Play to retry.';
  } finally {
    if (current()) {
      piAudio.loading = false;
      piAudio.controller = null;
      if (!piAudio.audio) {
        piIncomingAudio.manual = false;
        piIncomingAudio.pending.delete(incident.id);
      }
      piAudioSync();
    }
  }
}

function piStopIncomingRecording() {
  piIncomingAudio.generation++;
  clearTimeout(piIncomingAudio.timer);
  piIncomingAudio.controller?.abort();
  const audio = piIncomingAudio.audio, url = piIncomingAudio.url;
  Object.assign(piIncomingAudio, { controller: null, audio: null, url: null, loading: false, timer: null, incident: null });
  if (audio) {
    audio.onplay = audio.onpause = audio.onloadedmetadata = audio.onended = audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (url) URL.revokeObjectURL(url);
}

function piResetAudio() {
  piStopAudio();
  piStopIncomingRecording();
  piIncomingAudio.pending.clear();
  piIncomingAudio.seen.clear();
  piIncomingAudio.blocked = false;
}

function piQueueRecording(incident) {
  if (!PI_MODE || !currentUser || !piDashboard.office || !eocReceives(incident) ||
      !/^STATION-[0-9]{2}$/.test(incident?.stationId) ||
      !/^[A-Za-z0-9_-]{1,79}$/.test(incident?.id) || piIncomingAudio.seen.has(incident.id)) return;
  piIncomingAudio.seen.add(incident.id);
  piIncomingAudio.pending.set(incident.id, { readyAt: performance.now() + 1100 });
  piPlayNextRecording();
}

async function piPlayNextRecording() {
  if (!PI_MODE || !currentUser || !piDashboard.office || !document.getElementById('screen-app').classList.contains('active')) return;
  if (piIncomingAudio.incident) {
    const incident = liveIncidents.find(row => row.id === piIncomingAudio.incident.id);
    if (!incident || !eocReceives(incident) || !['active', 'pending'].includes(incident.status) ||
        piAudioKey(incident) !== piIncomingAudio.key) {
      piStopIncomingRecording();
    }
  }
  if (piIncomingAudio.loading || piIncomingAudio.audio || piIncomingAudio.blocked || piIncomingAudio.manual ||
      audioMuted || audioVolume === 0 || piAudio.loading || (piAudio.audio && !piAudio.audio.paused)) return;
  clearTimeout(piIncomingAudio.timer);
  piIncomingAudio.timer = null;
  let incident, wait = Infinity;
  for (const [id, entry] of piIncomingAudio.pending) {
    const report = liveIncidents.find(row => row.id === id);
    if (!report) continue;
    if (!eocReceives(report) || !['active', 'pending'].includes(report.status)) {
      piIncomingAudio.pending.delete(id);
      continue;
    }
    if (!piAudioKey(report)) continue;
    const delay = entry.readyAt - performance.now();
    if (delay > 0) { wait = Math.min(wait, delay); continue; }
    incident = report;
    break;
  }
  if (!incident) {
    if (Number.isFinite(wait)) piIncomingAudio.timer = setTimeout(piPlayNextRecording, wait + 1);
    return;
  }
  const generation = piIncomingAudio.generation, key = piAudioKey(incident);
  const current = () => generation === piIncomingAudio.generation &&
    key === piAudioKey(liveIncidents.find(row => row.id === incident.id));
  piIncomingAudio.loading = true;
  piIncomingAudio.incident = incident;
  piIncomingAudio.key = key;
  piIncomingAudio.controller = new AbortController();
  try {
    const blob = await piReadRecording(incident, piIncomingAudio.controller.signal, current);
    if (!blob || !current()) return;
    const audio = new Audio();
    piIncomingAudio.audio = audio;
    piIncomingAudio.url = URL.createObjectURL(blob);
    audio.src = piIncomingAudio.url;
    audio.onplay = audio.onpause = audio.onloadedmetadata = () => { if (current()) piAudioSync(); };
    audio.onended = () => {
      if (!current()) return;
      piIncomingAudio.pending.delete(incident.id);
      piStopIncomingRecording();
      piAudioSync();
    };
    audio.onerror = () => {
      if (!current()) return;
      piIncomingAudio.pending.delete(incident.id);
      piStopIncomingRecording();
      showToast('The station recording could not play. Select its report and press Play to retry.');
      piAudioSync();
    };
    piAudioVolume();
    await audio.play();
    if (current()) showToast('Original microphone recording\n'+incident.stationId+' · '+incident.id);
  } catch (error) {
    if (!current() || error.name === 'AbortError') return;
    if (error.name === 'NotAllowedError') {
      piIncomingAudio.blocked = true;
      showToast('Original recording ready\n'+incident.stationId+' · Select the report and press Play.');
    } else {
      piIncomingAudio.pending.delete(incident.id);
      showToast('The station recording could not load. Select its report and press Play to retry.');
    }
    piStopIncomingRecording();
    piAudioSync();
  } finally {
    if (generation === piIncomingAudio.generation) {
      piIncomingAudio.loading = false;
      piIncomingAudio.controller = null;
      if (!current()) { piStopIncomingRecording(); piPlayNextRecording(); }
      else piAudioSync();
    }
  }
}
