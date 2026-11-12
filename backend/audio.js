const { createHash, randomUUID } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const express = require('express');

const MAX_AUDIO_BYTES = 1024 * 1024;
const eventIdPattern = /^[A-Za-z0-9_-]{1,79}$/;
const officeCodes = new Map([
  ['School Clinic', 'clinic'],
  ['Campus Security', 'security'],
  ['DRRMO', 'fire_disaster'],
]);

function validateWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > MAX_AUDIO_BYTES ||
      bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE' ||
      bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('Invalid WAV');
  }
  let format;
  let dataLength;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error('Invalid WAV');
    if (name === 'fmt ') {
      if (format || ![16, 18].includes(length)) throw new Error('Invalid WAV');
      format = bytes.subarray(start, end);
      if (format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 ||
          format.readUInt32LE(4) !== 16000 || format.readUInt32LE(8) !== 32000 ||
          format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16 ||
          (length === 18 && format.readUInt16LE(16) !== 0)) throw new Error('Invalid WAV');
    } else if (name === 'data') {
      if (dataLength !== undefined || length < 2 || length % 2 || length > 320000) {
        throw new Error('Invalid WAV');
      }
      dataLength = length;
    }
    offset = end + (length % 2);
  }
  if (!format || dataLength === undefined || offset !== bytes.length) throw new Error('Invalid WAV');
  return { byte_length: bytes.length, duration_ms: Math.ceil(dataLength / 32) };
}

async function syncDirectory(directory) {
  // Windows tests cannot fsync a directory. The deployed Pi uses the durable Linux path.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function openStoredAudio(directory, metadata) {
  if (!/^[0-9a-f]{64}$/.test(metadata.sha256)) throw new Error('Invalid stored audio');
  const handle = await fs.open(path.join(directory, metadata.sha256 + '.wav'),
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== metadata.byte_length || stat.size > MAX_AUDIO_BYTES) {
      throw new Error('Invalid stored audio');
    }
    const bytes = await handle.readFile();
    const wav = validateWav(bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== metadata.sha256 ||
        wav.duration_ms !== metadata.duration_ms) throw new Error('Invalid stored audio');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function persistAudio(directory, bytes, metadata) {
  const created = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid audio directory');
  await fs.chmod(directory, 0o700);
  if (created && process.platform !== 'win32') {
    const boundary = path.dirname(created);
    let parent = directory;
    while (parent !== boundary) {
      await syncDirectory(parent);
      parent = path.dirname(parent);
    }
    await syncDirectory(boundary);
  }
  const temporary = path.join(directory, randomUUID() + '.tmp');
  const final = path.join(directory, metadata.sha256 + '.wav');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.link(temporary, final);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await syncDirectory(directory);
    const stored = await openStoredAudio(directory, metadata);
    await stored.close();
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function createAudioRoutes({ pool, authenticateStaff = null, audioDirectory =
  process.env.CAMPUS_ER_AUDIO_DIR || path.join(os.homedir(), '.local', 'share', 'campus-er', 'incident-audio') }) {
  if (!pool || typeof pool.query !== 'function' || typeof audioDirectory !== 'string' || !audioDirectory.trim() ||
      (authenticateStaff !== null && typeof authenticateStaff !== 'function')) {
    throw new Error('Audio routes require a database, a private audio directory, and optional staff authentication.');
  }
  const directory = path.resolve(audioDirectory);
  const router = express.Router();
  const route = '/api/v1/reports/:eventId/audio';
  router.use(route, (req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
    if (!eventIdPattern.test(req.params.eventId)) return res.status(400).json({ error: 'Invalid Event ID.' });
    next();
  });

  router.post(route, async (req, res, next) => {
    const authorization = /^Bearer ([0-9a-f]{64})$/i.exec(req.get('Authorization') || '');
    if (!authorization) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'A station credential is required.' });
    }
    try {
      const tokenHash = createHash('sha256').update(authorization[1]).digest('hex');
      const { rows: [station] } = await pool.query(
        'SELECT station_id FROM stations WHERE device_token_sha256 = $1', [tokenHash]);
      if (!station) {
        return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Invalid station credential.' });
      }
      const { rows: [incident] } = await pool.query(
        'SELECT event_id FROM incidents WHERE event_id = $1 AND station_id = $2',
        [req.params.eventId, station.station_id]);
      if (!incident) return res.status(404).json({ error: 'No incident is available for this station.' });
      if (!req.is('audio/wav')) return res.status(415).json({ error: 'Upload audio/wav.' });
      next();
    } catch {
      res.status(503).json({ error: 'Audio storage is unavailable. Retry the same recording.' });
    }
  }, express.raw({ type: 'audio/wav', limit: MAX_AUDIO_BYTES, inflate: false }), async (req, res) => {
    let wav;
    try {
      wav = validateWav(req.body);
    } catch {
      return res.status(400).json({ error: 'Use PCM WAV, 16-bit mono at 16000 Hz, lasting up to 10 seconds.' });
    }
    const metadata = { sha256: createHash('sha256').update(req.body).digest('hex'), ...wav };
    try {
      const parameters = [req.params.eventId, metadata.sha256, metadata.byte_length, metadata.duration_ms];
      const { rows: [existing] } = await pool.query(
        'SELECT sha256, byte_length, duration_ms FROM incident_audio WHERE event_id = $1', [req.params.eventId]);
      if (existing && (existing.sha256 !== metadata.sha256 || existing.byte_length !== metadata.byte_length ||
          existing.duration_ms !== metadata.duration_ms)) {
        return res.status(409).json({ error: 'This incident already has a different recording.' });
      }
      await persistAudio(directory, req.body, metadata);
      let status = 200;
      if (!existing) {
        const { rows } = await pool.query(
          `INSERT INTO incident_audio (event_id, sha256, byte_length, duration_ms)
           VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, parameters);
        if (rows.length) status = 201;
        else {
          const { rows: [saved] } = await pool.query(
            'SELECT sha256, byte_length, duration_ms FROM incident_audio WHERE event_id = $1', [req.params.eventId]);
          if (!saved) throw new Error('Audio receipt unavailable');
          if (saved.sha256 !== metadata.sha256 || saved.byte_length !== metadata.byte_length ||
              saved.duration_ms !== metadata.duration_ms) {
            return res.status(409).json({ error: 'This incident already has a different recording.' });
          }
        }
      }
      return res.status(status).set('X-Audio-Stored', 'true').set('X-Audio-SHA256', metadata.sha256)
        .json({ event_id: req.params.eventId, ...metadata });
    } catch {
      return res.status(503).json({ error: 'Audio storage could not be confirmed. Retry the same recording.' });
    }
  });

  router.get(route, authenticateStaff || ((_req, res) => res.status(404).json({ error: 'Audio playback is unavailable.' })),
    async (req, res) => {
      const office = officeCodes.get(req.staff?.office);
      if (!office && req.staff?.office !== 'Administrator') {
        return res.status(403).json({ error: 'An approved staff office is required.' });
      }
      let handle;
      try {
        const { rows: [audio] } = await pool.query(
          `SELECT a.sha256, a.byte_length, a.duration_ms
           FROM incident_audio a JOIN incidents i ON i.event_id = a.event_id
           WHERE a.event_id = $1 AND ($2::text IS NULL OR i.receiving_office = $2 OR i.category = 'GENERAL')`,
          [req.params.eventId, office || null]);
        if (!audio) return res.status(404).json({ error: 'No recording is available for this incident.' });
        handle = await openStoredAudio(directory, audio);
        res.status(200).set('Content-Type', 'audio/wav').set('Content-Length', String(audio.byte_length))
          .set('Content-Disposition', 'inline; filename="incident-audio.wav"');
        const stream = handle.createReadStream({ start: 0, autoClose: true });
        handle = null;
        await pipeline(stream, res);
      } catch {
        if (res.headersSent) res.destroy();
        else res.status(503).json({ error: 'The recording is temporarily unavailable.' });
      } finally {
        await handle?.close();
      }
    });

  router.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.status === 415 ? 415 : 400;
    res.status(status).json({ error: status === 413 ? 'The recording exceeds the upload limit.' : 'Unable to read the WAV upload.' });
  });
  return router;
}

module.exports = { createAudioRoutes, validateWav, MAX_AUDIO_BYTES };
