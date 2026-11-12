const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createAudioRoutes, validateWav, MAX_AUDIO_BYTES } = require('./audio');

const eventId = 'STATION-01-aabbccddeeff0011-1';
const token = 'a'.repeat(64);
const otherToken = 'b'.repeat(64);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function wav(samples = 160, value = 0) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(value, offset);
  return bytes;
}

async function setup(t, playback = true) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-er-audio-'));
  const directory = path.join(temporary, 'private', 'audio');
  const incidents = new Map([[eventId, { station_id: 'STATION-01', category: 'MEDICAL', receiving_office: 'clinic' }]]);
  const stations = new Map([[hash(token), 'STATION-01'], [hash(otherToken), 'STATION-02']]);
  const audio = new Map();
  const state = { failRead: false, failAfterInsert: false };
  const pool = { async query(sql, values) {
    if (state.failRead) throw new Error('fixture database unavailable');
    if (sql.startsWith('SELECT station_id FROM stations')) {
      const stationId = stations.get(values[0]);
      return { rows: stationId ? [{ station_id: stationId }] : [] };
    }
    if (sql.startsWith('SELECT event_id, category, receiving_office FROM incidents')) {
      const incident = incidents.get(values[0]);
      return { rows: incident?.station_id === values[1] ? [{
        event_id: values[0], category: incident.category, receiving_office: incident.receiving_office,
      }] : [] };
    }
    if (sql.startsWith('SELECT sha256')) return { rows: audio.has(values[0]) ? [audio.get(values[0])] : [] };
    if (sql.includes('INSERT INTO incident_audio')) {
      if (audio.has(values[0])) return { rows: [] };
      audio.set(values[0], { sha256: values[1], byte_length: values[2], duration_ms: values[3] });
      if (state.failAfterInsert) {
        state.failAfterInsert = false;
        throw new Error('fixture lost insert receipt');
      }
      return { rows: [{ event_id: values[0] }] };
    }
    if (sql.includes('FROM incident_audio a JOIN incidents')) {
      const incident = incidents.get(values[0]);
      return { rows: incident && audio.has(values[0]) && (!values[1] || incident.receiving_office === values[1])
        ? [audio.get(values[0])] : [] };
    }
    throw new Error('Unexpected fixture query');
  } };
  const authenticateStaff = (req, res, next) => {
    const office = new Map([
      ['Bearer clinic-staff', 'School Clinic'],
      ['Bearer security-staff', 'Campus Security'],
      ['Bearer administrator-staff', 'Administrator'],
    ]).get(req.get('Authorization'));
    if (!office) return res.status(401).json({ error: 'Staff authentication required.' });
    req.staff = { id: 'fixture-staff', office };
    next();
  };
  const app = express();
  const audioEvents = [];
  app.use(createAudioRoutes({
    pool, authenticateStaff: playback ? authenticateStaff : null, audioDirectory: directory,
    onAudioStored: incident => audioEvents.push(incident),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const url = id => `${origin}/api/v1/reports/${encodeURIComponent(id)}/audio`;
  const upload = (body, credential = token, id = eventId, headers = {}) => fetch(url(id), {
    method: 'POST', headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${credential}`, ...headers }, body,
  });
  const download = (credential = 'clinic-staff', id = eventId) => fetch(url(id), {
    headers: { Authorization: `Bearer ${credential}` },
  });
  return { directory, audio, audioEvents, state, incidents, origin, upload, download };
}

test('WAV validation bounds RIFF chunks, exact PCM format, and ten-second duration', () => {
  assert.deepEqual(validateWav(wav()), { byte_length: 364, duration_ms: 10 });
  assert.equal(validateWav(wav(160000)).duration_ms, 10000);
  assert.equal(validateWav(wav(1)).duration_ms, 1);
  const invalid = [Buffer.alloc(0), wav(0), wav(160001), Buffer.concat([wav(), Buffer.from([0])])];
  for (const [offset, value, size] of [[0, 0xd2, 1], [20, 3, 2], [22, 2, 2], [24, 8000, 4],
    [28, 16000, 4], [32, 4, 2], [34, 8, 2], [40, 319, 4], [16, 1000000, 4]]) {
    const bytes = wav();
    bytes.writeUIntLE(value, offset, size);
    invalid.push(bytes);
  }
  const duplicate = Buffer.concat([wav(), wav().subarray(36)]);
  duplicate.writeUInt32LE(duplicate.length - 8, 4);
  invalid.push(duplicate);
  for (const bytes of invalid) assert.throws(() => validateWav(bytes), /Invalid WAV/);
});

test('only the stored incident station can upload and failures disclose no private storage', async t => {
  const api = await setup(t);
  for (const [credential, id, expected] of [['bad', eventId, 401], [otherToken, eventId, 404],
    [token, 'STATION-01-unknown', 404], [token, '../outside', 400]]) {
    const response = await api.upload(wav(), credential, id);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.text();
    assert(!body.includes(token) && !body.includes(api.directory));
  }
  assert.equal(api.audio.size, 0);
  await assert.rejects(fs.stat(api.directory), { code: 'ENOENT' });
});

test('invalid WAV, content type, compressed input, and oversized bodies are rejected', async t => {
  const api = await setup(t);
  for (const [body, headers, expected] of [[Buffer.from('not WAV'), {}, 400],
    [wav(), { 'Content-Type': 'application/octet-stream' }, 415],
    [wav(), { 'Content-Encoding': 'gzip' }, 415], [Buffer.alloc(MAX_AUDIO_BYTES + 1), {}, 413]]) {
    const response = await api.upload(body, token, eventId, headers);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('X-Audio-Stored'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(api.audio.size, 0);
  await assert.rejects(fs.stat(api.directory), { code: 'ENOENT' });
});

test('stored audio retries are immutable, private, and restricted to the receiving office', async t => {
  const api = await setup(t);
  const bytes = wav();
  const first = await api.upload(bytes);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('X-Audio-Stored'), 'true');
  assert.deepEqual(await first.json(), { event_id: eventId, sha256: hash(bytes), byte_length: bytes.length, duration_ms: 10 });
  const file = path.join(api.directory, hash(bytes) + '.wav');
  const originalStat = await fs.stat(file);
  assert.equal((await api.upload(bytes)).status, 200);
  assert.equal((await api.upload(wav(160, 7))).status, 409);
  assert.deepEqual(api.audioEvents, [{ event_id: eventId, category: 'MEDICAL', receiving_office: 'clinic' }]);
  assert.equal((await fs.stat(file)).mtimeMs, originalStat.mtimeMs);
  assert.deepEqual(await fs.readdir(api.directory), [hash(bytes) + '.wav']);
  if (process.platform !== 'win32') {
    assert.equal(originalStat.mode & 0o777, 0o600);
    assert.equal((await fs.stat(api.directory)).mode & 0o777, 0o700);
  }
  for (const [credential, expected] of [['bad-staff', 401], ['security-staff', 404],
    [token, 401], ['administrator-staff', 200], ['clinic-staff', 200]]) {
    const response = await api.download(credential);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    if (expected === 200) {
      assert.equal(response.headers.get('Content-Type'), 'audio/wav');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  }
  assert.equal((await fetch(`${api.origin}/${hash(bytes)}.wav`)).status, 404);
});

test('concurrent same and conflicting uploads preserve one immutable attachment', async t => {
  const api = await setup(t);
  const same = await Promise.all([api.upload(wav()), api.upload(wav())]);
  assert.deepEqual(same.map(response => response.status).sort(), [200, 201]);
  const secondId = 'STATION-01-aabbccddeeff0011-2';
  api.incidents.set(secondId, { station_id: 'STATION-01', receiving_office: 'clinic' });
  const different = await Promise.all([api.upload(wav(160, 1), token, secondId), api.upload(wav(160, 2), token, secondId)]);
  assert.deepEqual(different.map(response => response.status).sort(), [201, 409]);
  const stored = await api.download('clinic-staff', secondId);
  assert.equal(stored.status, 200);
  assert.equal(hash(Buffer.from(await stored.arrayBuffer())), api.audio.get(secondId).sha256);
  assert(!(await fs.readdir(api.directory)).some(file => file.endsWith('.tmp')));
});

test('lost database receipt retains durable bytes and a matching retry recovers', async t => {
  const api = await setup(t);
  api.state.failAfterInsert = true;
  const response = await api.upload(wav());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('X-Audio-Stored'), null);
  assert(!JSON.stringify(await response.json()).includes(api.directory));
  assert.deepEqual(await fs.readFile(path.join(api.directory, hash(wav()) + '.wav')), wav());
  assert.equal((await api.upload(wav())).status, 200);
});

test('missing bytes can be restored by an exact retry, while corrupted bytes are never overwritten', async t => {
  const api = await setup(t);
  await api.upload(wav());
  const file = path.join(api.directory, hash(wav()) + '.wav');
  await fs.unlink(file);
  assert.equal((await api.download()).status, 503);
  assert.equal((await api.upload(wav())).status, 200);
  await fs.writeFile(file, Buffer.from('corrupt fixture'));
  assert.equal((await api.download()).status, 503);
  assert.equal((await api.upload(wav())).status, 503);
  assert.equal(await fs.readFile(file, 'utf8'), 'corrupt fixture');
});

test('station uploads work without dashboard config and playback stays unavailable', async t => {
  const api = await setup(t, false);
  assert.equal((await api.upload(wav())).status, 201);
  const response = await api.download();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
