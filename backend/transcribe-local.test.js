const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { writeFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createLocalTranscriber, localTranscriberFromEnv } = require('./transcribe-local');

function wavWith(samples) {
  const wav = Buffer.alloc(44 + 2 * samples.length);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2 * samples.length, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(sample, 44 + 2 * index));
  return wav;
}

async function fixture(t, samples) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'test-campus-er-whisper-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const model = path.join(directory, 'model file.bin');
  const wavPath = path.join(directory, 'station clip.wav');
  await fs.writeFile(model, '');
  await fs.writeFile(wavPath, wavWith(samples));
  return { binary: process.execPath, model, wavPath };
}

test('Whisper runs with bounded execution and removes its private output', async t => {
  const { binary, model, wavPath } = await fixture(t, [-100, 100]);
  const { signal } = new AbortController();
  let output;
  t.mock.method(childProcess, 'execFile', (file, args, options, done) => {
    assert.equal(file, binary);
    assert.equal(args[args.indexOf('--file') + 1], wavPath);
    assert.equal(args[args.indexOf('--model') + 1], model);
    assert.equal(args[args.indexOf('--language') + 1], 'tl');
    assert.equal(args.includes('--audio-ctx'), false, 'Use the model context for recognition quality.');
    assert.equal(args[args.indexOf('--vad-model') + 1], model);
    assert.equal(options.signal, signal);
    assert.equal(options.timeout, 500);
    assert.equal(options.maxBuffer, 64 * 1024);
    assert.equal(options.shell, undefined);
    output = args[args.indexOf('--output-file') + 1] + '.json';
    writeFileSync(output, JSON.stringify({ transcription: [{ text: '  First line\n' }, { text: 'second line. ' }] }));
    done(null);
  });
  const transcribe = createLocalTranscriber({ binary, model, vadModel: model, language: 'tl', timeoutMs: 500 });
  assert.equal(await transcribe(wavPath, { signal }), 'First line second line.');
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});

test('flat recordings skip inference and incomplete configuration is reported', async t => {
  const { binary, model, wavPath } = await fixture(t, [123, 124, 120, 125]);
  const processCall = t.mock.method(childProcess, 'execFile', () => assert.fail('Flat audio must skip inference.'));
  const transcribe = localTranscriberFromEnv({ CAMPUS_ER_WHISPER_BIN: binary, CAMPUS_ER_WHISPER_MODEL: model });
  assert.equal(await transcribe(wavPath), '');
  assert.equal(processCall.mock.callCount(), 0);
  assert.equal(localTranscriberFromEnv({}), null);
  assert.throws(() => localTranscriberFromEnv({ CAMPUS_ER_WHISPER_BIN: binary }), /Whisper model/);
});

test('empty model output means no speech while subprocess failures stay private', async t => {
  const { binary, model, wavPath } = await fixture(t, [-100, 100]);
  let fail = false;
  let output;
  t.mock.method(childProcess, 'execFile', (_file, args, _options, done) => {
    output = args[args.indexOf('--output-file') + 1] + '.json';
    writeFileSync(output, '{"transcription":[]}');
    done(fail ? Object.assign(new Error('private recording text'), { killed: true }) : null);
  });
  const transcribe = createLocalTranscriber({ binary, model });
  assert.equal(await transcribe(wavPath), '');
  fail = true;
  await assert.rejects(transcribe(wavPath), { message: 'Whisper timed out.' });
  await assert.rejects(fs.access(output), { code: 'ENOENT' });
});
