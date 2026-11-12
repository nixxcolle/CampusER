# Automatic station transcription

After a station WAV is stored, the Pi transcribes it with whisper.cpp and saves the text on that recording's Event ID. Overview shows the original recording and its automatic transcript. The report detail view and School Clinic history also expose transcript availability. The existing office permissions apply to the text and recording.

The first deployment uses whisper.cpp v1.8.6, the multilingual tiny model, Silero voice activity detection, automatic language detection and two CPU threads. One recording is processed at a time. Processing has a 60-second timeout. The first install builds the engine and downloads approximately 79 MB of model files over the internet. Subsequent recognition runs locally on the Pi.

For an English demonstration, use `CAMPUS_ER_WHISPER_LANGUAGE=en`. The English tuning package supplies that override in `40-transcription-language.conf`. Automatic language detection on a short clip can select an unintended language. The adapter uses the model's default audio context for recognition quality. A completed job logs its Event ID, status and `elapsed_ms` so the Pi's processing time can be measured without logging recognized speech.

The queue records pending, processing, ready, no_speech or failed for each saved WAV. Migration 004 also queues recordings saved before installation, with the newest recordings processed first. A normal service restart returns its unfinished job to pending. After a sudden shutdown, the job becomes available again when its five-minute lease expires. A failed job leaves the original report and recording available.

## Install on the existing Pi

Use the supplied `CAMPUS-ER_Pi_Transcription_Update.zip` from this deployment. It contains the matching backend and PWA release.

1. In the Pi terminal, install the build tools.

   ```bash
   sudo apt-get update
   sudo apt-get install -y build-essential cmake
   ```

2. Copy the ZIP to the Pi from Windows PowerShell. Use its current IP address.

   ```powershell
   scp "C:\Users\ACER\Downloads\Literature Review\outputs\CAMPUS-ER_Pi_Transcription_Update.zip" thesis@172.20.61.104:
   ssh thesis@172.20.61.104
   ```

3. Extract the package and start the installer as the normal `thesis` user.

   ```bash
   unzip -o ~/CAMPUS-ER_Pi_Transcription_Update.zip -d "$HOME"
   bash ~/CAMPUS-ER_Pi_Transcription_Update/install-campus-er-transcription.sh
   ```

The installer verifies pinned engine/model downloads, runs the official public sample, backs up the existing code and database, applies migrations 003 and 004, and updates the managed service. It adds `30-local-transcription.conf` to the service's drop-ins. It restores the earlier runtime if the deployment health checks fail.

## Test the station flow

Reload the Pi dashboard and sign in as School Clinic. Press Medical once on Station 1 and speak a short phrase within its three-second capture, such as “Station one, please send help.” Wait for the report and audio storage confirmations in Serial Monitor. Overview should show the recording first, followed by its transcript status and recognized words. Compare the text with the original audio.

Repeat with Station 2 using a different phrase. Select each report and check that its text and audio belong to that Event ID. The same flow applies to other buttons when their station firmware records audio.

The local engine passed a Windows CPU test using a spoken WAV, silence and generated noise. Automated PostgreSQL, HTTP, SSE and browser checks cover the queue, office access, restart recovery, report-to-transcript binding, literal text display and recording playback. Pi 4 timing and real station microphone accuracy still require this live test. Start with English, then evaluate the languages and background noise expected during the demonstration.

## Check configuration and failures

On the Pi, the health response includes `"transcription":true` when the engine and database migration are configured.

```bash
curl -fsS http://127.0.0.1:3000/health
sudo journalctl -u campus-er-backend -n 30 --no-pager
```

The service uses these environment values in its transcription drop-in.

- `CAMPUS_ER_WHISPER_BIN` points to the built `whisper-cli` executable.
- `CAMPUS_ER_WHISPER_MODEL` points to `ggml-tiny.bin`.
- `CAMPUS_ER_WHISPER_VAD_MODEL` points to `ggml-silero-v6.2.0.bin`.
- `CAMPUS_ER_WHISPER_LANGUAGE` defaults to `auto`. Set `en` for an English trial or `tl` for a Filipino trial.
- `CAMPUS_ER_WHISPER_THREADS` defaults to `2`.

After editing the drop-in, run `sudo systemctl daemon-reload` and `sudo systemctl restart campus-er-backend`.

From the source checkout, run `node --test backend/*.test.js`, `node verification/transcription-workflow.cjs`, `node verification/response-workflow.cjs` and `node verify-hardware-audio.cjs`. The verification folder uses its existing PGlite and Playwright test dependencies.

Engine and model sources are pinned in the installer. CLI options and build details are documented by [whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/v1.8.6), including its [CLI reference](https://github.com/ggml-org/whisper.cpp/tree/v1.8.6/examples/cli).
