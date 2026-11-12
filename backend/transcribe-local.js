const childProcess = require('node:child_process');
const { accessSync, constants, statSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MAX_AUDIO_BYTES, validateWav } = require('./audio');

const MAX_OUTPUT_BYTES = 64 * 1024;

function requireFile(file, mode, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  try {
    if (!statSync(file).isFile()) throw new Error();
    accessSync(file, mode);
  } catch {
    throw new Error(`${label} must point to an accessible file.`);
  }
}

function nearSilent(wav) {
  // validateWav already checked the chunk boundaries and PCM sample format.
  for (let offset = 12; offset < wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (wav.toString('latin1', offset, offset + 4) === 'data') {
      let min = wav.readInt16LE(start);
      let max = min;
      for (let sample = start + 2; sample < start + size; sample += 2) {
        const value = wav.readInt16LE(sample);
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (max - min > 16) return false;
      }
      return true;
    }
    offset = start + size + (size % 2);
  }
}

function createLocalTranscriber({ binary, model, vadModel, language = 'auto', threads = 2, timeoutMs = 60000 } = {}) {
  requireFile(binary, constants.X_OK, 'Whisper executable');
  requireFile(model, constants.R_OK, 'Whisper model');
  if (vadModel) requireFile(vadModel, constants.R_OK, 'Whisper voice activity model');
  if (!/^(?:auto|[a-z]{2,3})$/.test(language)) throw new Error('Invalid Whisper language code.');
  if (!Number.isInteger(threads) || threads < 1 || threads > 4) throw new Error('Whisper threads must be 1 to 4.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid Whisper timeout.');

  return async (wavPath, { signal } = {}) => {
    signal?.throwIfAborted();
    if (typeof wavPath !== 'string' || !path.isAbsolute(wavPath)) throw new Error('Invalid recording path.');
    const input = await fs.stat(wavPath);
    if (!input.isFile() || input.size > MAX_AUDIO_BYTES) throw new Error('Invalid recording file.');
    const wav = await fs.readFile(wavPath, { signal });
    validateWav(wav);
    if (nearSilent(wav)) return '';

    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-er-transcript-'));
    try {
      const output = path.join(temp, 'result');
      const args = [
        '--model', model, '--file', wavPath, '--language', language, '--threads', String(threads),
        '--audio-ctx', '768', '--no-gpu', '--no-prints', '--output-json', '--output-file', output,
      ];
      if (vadModel) args.push('--vad', '--vad-model', vadModel);
      await new Promise((resolve, reject) => {
        childProcess.execFile(binary, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, signal, windowsHide: true }, error => {
          if (error) reject(new Error(error.killed ? 'Whisper timed out.' : 'Whisper could not transcribe the recording.'));
          else resolve();
        });
      });

      const resultPath = output + '.json';
      if ((await fs.stat(resultPath)).size > MAX_OUTPUT_BYTES) throw new Error('Whisper output exceeded the limit.');
      const { transcription } = JSON.parse(await fs.readFile(resultPath, { encoding: 'utf8', signal }));
      if (!Array.isArray(transcription) || transcription.some(segment => typeof segment?.text !== 'string')) {
        throw new Error('Invalid Whisper result.');
      }
      const text = transcription.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length > 4000 || text.includes('\0')) throw new Error('Invalid transcription text.');
      return text;
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  };
}

function localTranscriberFromEnv(env = process.env) {
  const binary = env.CAMPUS_ER_WHISPER_BIN;
  const model = env.CAMPUS_ER_WHISPER_MODEL;
  if (!binary && !model) return null;
  return createLocalTranscriber({
    binary,
    model,
    vadModel: env.CAMPUS_ER_WHISPER_VAD_MODEL,
    language: env.CAMPUS_ER_WHISPER_LANGUAGE || 'auto',
    threads: Number(env.CAMPUS_ER_WHISPER_THREADS || 2),
  });
}

module.exports = { createLocalTranscriber, localTranscriberFromEnv };
