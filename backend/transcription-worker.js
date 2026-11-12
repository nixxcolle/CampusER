const { randomUUID } = require('node:crypto');
const { openStoredAudio, storedAudioPath } = require('./audio');

const IDLE_SCAN_MS = 5000;
const MAX_TRANSCRIPT_LENGTH = 4000;

function createTranscriptionWorker({ db, audioDirectory, transcribe, publish }) {
  let controller;
  let timer;
  let running;
  let wakePending = false;

  function notify(job) {
    try {
      publish(job);
    } catch (error) {
      console.error('Transcript update notification failed:', error.code || error.name);
    }
  }

  async function processNext(signal) {
    const claim = randomUUID();
    const { rows: [job] } = await db.query(
      `WITH next_job AS (
         SELECT event_id FROM public.incident_audio
         WHERE transcript_status = 'pending'
           OR (transcript_status = 'processing' AND transcription_lease_until <= clock_timestamp())
         ORDER BY created_at DESC, event_id
         LIMIT 1 FOR UPDATE SKIP LOCKED
       ), claimed AS (
         UPDATE public.incident_audio a
         SET transcript_status = 'processing', transcription_claim = $1,
             transcription_lease_until = clock_timestamp() + interval '5 minutes'
         FROM next_job
         WHERE a.event_id = next_job.event_id
         RETURNING a.event_id, a.sha256, a.byte_length, a.duration_ms
       )
       SELECT claimed.*, i.category, i.receiving_office
       FROM claimed JOIN public.incidents i USING (event_id)`,
      [claim],
    );
    if (!job) return false;
    const started = performance.now();
    if (!signal.aborted) notify(job);

    let status = 'failed';
    let text = null;
    try {
      if (!signal.aborted) {
        const handle = await openStoredAudio(audioDirectory, job);
        await handle.close();
        const result = await transcribe(storedAudioPath(audioDirectory, job.sha256), { signal });
        const cleaned = result.replaceAll('\0', '').trim();
        text = Array.from(cleaned).slice(0, MAX_TRANSCRIPT_LENGTH).join('') || null;
        status = text === null ? 'no_speech' : 'ready';
      }
    } catch (error) {
      if (!signal.aborted) console.error('Local transcription failed:', error.code || error.name);
    }
    if (signal.aborted) {
      status = 'pending';
      text = null;
    }

    // A lease holder can finish only its own claim, even after cleanup or reassignment.
    const { rows } = await db.query(
      `UPDATE public.incident_audio
       SET transcript_status = $3, transcript_text = $4,
           transcription_claim = NULL, transcription_lease_until = NULL
       WHERE event_id = $1 AND transcription_claim = $2
       RETURNING event_id`,
      [job.event_id, claim, status, text],
    );
    if (rows.length && !signal.aborted) {
      console.info(`TRANSCRIPTION event=${job.event_id} status=${status} elapsed_ms=${Math.round(performance.now() - started)}`);
      notify(job);
    }
    return true;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const signal = controller.signal;
      wakePending = false;
      running = processNext(signal).catch(error => {
        console.error('Transcript queue could not be checked:', error.code || error.name);
        return false;
      });
      const processed = await running;
      running = null;
      if (!signal.aborted) schedule(processed || wakePending ? 0 : IDLE_SCAN_MS);
    }, delay);
    timer.unref();
  }

  return {
    start() {
      if (controller) return;
      controller = new AbortController();
      schedule(0);
    },
    wake() {
      if (!controller || controller.signal.aborted) return;
      if (running) wakePending = true;
      else schedule(0);
    },
    async stop() {
      controller?.abort();
      clearTimeout(timer);
      await running;
      controller = null;
    },
  };
}

module.exports = { createTranscriptionWorker };
