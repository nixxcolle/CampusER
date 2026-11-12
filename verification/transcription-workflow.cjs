const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { PGlite } = require('@electric-sql/pglite');
const { createApp } = require('../backend/server');

const token = 'a'.repeat(64);
const station = 'STATION-01';
const actors = {
  clinic: { id: '11111111-1111-4111-8111-111111111111', office: 'School Clinic' },
  security: { id: '22222222-2222-4222-8222-222222222222', office: 'Campus Security' },
};

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function wave(sample) {
  const bytes = Buffer.alloc(76);
  bytes.write('RIFF');
  bytes.writeUInt32LE(68, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(32, 40);
  bytes.writeInt16LE(sample, 44);
  return bytes;
}

async function until(check) {
  const deadline = Date.now() + 6500;
  for (;;) {
    const found = await check();
    if (found) return found;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for transcript state');
    await wait(15);
  }
}

async function main() {
  const db = await PGlite.create();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-transcription-'));
  let server;
  let worker;
  let stream;
  const streamController = new AbortController();
  try {
    await db.exec('CREATE ROLE campus_er_app;');
    async function migrate(name) {
      await db.exec(await fs.readFile(path.join(__dirname, '../backend/migrations', name), 'utf8'));
    }
    for (const name of ['001_station_incidents.sql', '002_incident_audio.sql', '003_response_workflow.sql']) {
      await migrate(name);
    }
    await db.query('INSERT INTO stations VALUES ($1, $2, $3)', [station, 'Station 1 Bench', hash(token)]);
    const history = station + '-history';
    const historicalAudio = wave(1);
    await db.query(
      "INSERT INTO incidents (event_id, station_id, location, receiving_office, category, trigger_source, uptime_ms) VALUES ($1, $2, 'Station 1 Bench', 'clinic', 'MEDICAL', 'physical_button', 10)",
      [history, station],
    );
    await db.query('INSERT INTO incident_audio (event_id, sha256, byte_length, duration_ms) VALUES ($1, $2, 76, 1)', [history, hash(historicalAudio)]);
    await fs.writeFile(path.join(directory, hash(historicalAudio) + '.wav'), historicalAudio);
    await migrate('004_incident_transcripts.sql');
    await migrate('004_incident_transcripts.sql');
    await db.exec('GRANT SELECT, INSERT ON stations, incidents, incident_audio TO campus_er_app; SET ROLE campus_er_app;');
    assert.equal((await db.query('SELECT transcript_status FROM incident_audio WHERE event_id = $1', [history])).rows[0].transcript_status, 'pending');
    await db.query(
      "UPDATE incident_audio SET transcript_status = 'processing', transcription_claim = $2, transcription_lease_until = clock_timestamp() - interval '1 second' WHERE event_id = $1",
      [history, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
    );

    let releaseAudio;
    let holdRestart = true;
    const calls = new Map();
    async function transcribe(file, { signal }) {
      assert.equal(path.dirname(file), directory);
      const sample = (await fs.readFile(file)).readInt16LE(44);
      calls.set(sample, (calls.get(sample) || 0) + 1);
      if (sample === 2) await new Promise(resolve => { releaseAudio = resolve; });
      if (sample === 3) return '   ';
      if (sample === 4) throw new Error('Engine fixture failed');
      if (sample === 5 && holdRestart) await wait(60000, undefined, { signal });
      return 'Station test phrase ' + sample;
    }
    const config = {
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_publishable_fixture',
      pwaDirectory: path.resolve(__dirname, '..'),
      staff: Object.fromEntries(Object.values(actors).map(actor => [actor.id, actor.office])),
    };
    const authFetch = async (_url, options) => {
      const actor = actors[options.headers.Authorization.replace('Bearer ', '')];
      return actor ? { ok: true, status: 200, json: async () => ({ id: actor.id }) } : { ok: false, status: 401 };
    };
    const app = createApp(db, config, authFetch, { audioDirectory: directory, transcribe });
    worker = app.locals.transcription;
    server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = (role, url, options = {}) => fetch(origin + url, {
      ...options, headers: { Authorization: 'Bearer ' + role, ...options.headers },
    });
    assert.deepEqual(await (await fetch(origin + '/health')).json(), { status: 'ok', transcription: true });
    assert.equal((await (await request('clinic', '/api/v1/staff/session')).json()).features.transcription, true);
    assert.equal((await request('unknown', '/api/v1/reports')).status, 401);

    const eventStream = await request('clinic', '/api/v1/events', { signal: streamController.signal });
    assert.equal(eventStream.status, 200);
    const notifications = [];
    stream = (async () => {
      const reader = eventStream.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          pending += value;
          let boundary;
          while ((boundary = pending.indexOf('\n\n')) !== -1) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            if (frame.startsWith('data: ')) notifications.push(JSON.parse(frame.slice(6)));
          }
        }
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      } finally {
        reader.releaseLock();
      }
    })();

    async function reports(office = 'clinic') {
      const response = await request(office, '/api/v1/reports');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return (await response.json()).incidents;
    }
    const reportAt = async (id, status) => (await reports()).find(report => report.event_id === id && report.transcript_status === status);
    async function addReport(suffix) {
      const eventId = station + '-' + suffix;
      const response = await request(token, '/api/v1/reports', {
        method: 'POST',
        headers: { 'Idempotency-Key': eventId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId, station_id: station, location: 'Station 1 Bench', category: 'MEDICAL',
          trigger: 'physical_button', uptime_ms: 100, occurred_at_unix: null,
        }),
      });
      assert.equal(response.status, 201);
      return eventId;
    }
    async function upload(eventId, sample, status = 201) {
      const response = await request(token, '/api/v1/reports/' + eventId + '/audio', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wave(sample),
      });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('X-Audio-Stored'), 'true');
    }

    worker.start();
    assert.equal((await until(() => reportAt(history, 'ready'))).transcript_text, 'Station test phrase 1');
    const live = await addReport('live');
    assert.equal((await until(() => reportAt(live, null))).transcript_text, null);
    await upload(live, 2);
    await until(() => reportAt(live, 'processing'));
    await until(() => releaseAudio);
    await upload(live, 2, 200);
    const playback = await request('clinic', '/api/v1/reports/' + live + '/audio');
    assert.equal(playback.status, 200);
    assert.deepEqual(Buffer.from(await playback.arrayBuffer()), wave(2));
    releaseAudio();
    assert.equal((await until(() => reportAt(live, 'ready'))).transcript_text, 'Station test phrase 2');
    assert.equal(calls.get(2), 1, 'An idempotent upload must not start a second inference');
    assert.deepEqual(await reports('security'), [], 'An unrelated office cannot read private transcripts');
    await until(() => notifications.filter(event => event.event_id === live).length === 4);
    assert(notifications.every(event => Object.keys(event).length === 1 && (event.connected || event.event_id)));

    const silent = await addReport('silent');
    await upload(silent, 3);
    assert.equal((await until(() => reportAt(silent, 'no_speech'))).transcript_text, null);
    const failed = await addReport('failed');
    await upload(failed, 4);
    assert.equal((await until(() => reportAt(failed, 'failed'))).transcript_text, null);
    const failedPlayback = await request('clinic', '/api/v1/reports/' + failed + '/audio');
    assert.deepEqual(Buffer.from(await failedPlayback.arrayBuffer()), wave(4));

    const restart = await addReport('restart');
    await upload(restart, 5);
    await until(() => calls.get(5) === 1);
    await worker.stop();
    assert.equal((await until(() => reportAt(restart, 'pending'))).transcript_text, null);
    holdRestart = false;
    worker.start();
    assert.equal((await until(() => reportAt(restart, 'ready'))).transcript_text, 'Station test phrase 5');
    console.log('PASS: saved WAV and restart recovery, report delivery during transcription, office isolation, metadata-only SSE, idempotent audio, failed/no-speech outcomes, and playback fallback.');
  } finally {
    streamController.abort();
    await stream;
    await worker?.stop();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await db.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
