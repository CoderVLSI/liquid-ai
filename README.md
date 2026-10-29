# LFM3 Pocket

A fully **on-device** assistant for Android built around Liquid AI's [LFM3](https://www.liquid.ai/blog/lfm3) models:

- **Live voice** — a bidirectional, interruptible conversation (think GPT Realtime / Gemini Live), running locally.
- **Chat** — a simple text chat with a mic button for live voice and an attach button for images.
- **Four models, downloaded on demand** — Omni (voice + vision + text), Audio, VL (vision) and the 1.7B text model.
- Nothing leaves the phone after the models are downloaded.

React Native (Expo) UI, with a small Kotlin module and a cross-compiled `llama.cpp` server underneath.

## Get the APK (GitHub Actions)

Every push runs **Build Android APK** (`.github/workflows/build-apk.yml`):

1. **server** job – cross-compiles `llama-server` from llama.cpp **b11960** (the first release that knows the `lfm3` architecture and the realtime voice API) for Android arm64, tuned for Snapdragon 7+ Gen 3 (OnePlus Nord 4).
2. **apk** job – runs unit tests + type check, `expo prebuild`, bundles the server into the APK and builds a release APK.

Download it from either place:

- **Releases** → the `apk-<branch>` pre-release (open it on the phone and tap the `.apk`), or
- the run's **Artifacts** → `liquid-voice-apk`.

You can also start a build by hand: *Actions → Build Android APK → Run workflow* (you may pass a newer llama.cpp tag).

Install: allow "install unknown apps" for your browser, open the APK. First launch → tap the model chip → download a model.

## How it works

```
 React Native UI ──► Kotlin module (modules/liquid-native)
   chat / mic / images     • runs libllama_server.so as a child process
   model downloads         • mic capture (AEC/NS) + PCM player w/ instant flush
   debug + crash tools     • resumable downloads, crash + exit-reason reporting
        │
        │  http://127.0.0.1:18080   (loopback only)
        ▼
 llama-server (llama.cpp b11960, arm64)
   /v1/chat/completions  – text + images (streaming)
   /v1/realtime  (WS)    – live voice: PCM16 in, PCM16 + text out
```

Why a separate server process instead of an in-process library? `llama.rn` (the usual React Native binding) bundles an older llama.cpp that has no `lfm3` architecture, and doesn't expose LFM3's speech output. The upstream server supports both. As a bonus a native crash in the model runtime **cannot take the app down**, and the app reports the exit code and last log lines.

### Live voice

The server does no turn detection, so the app does it (`src/voice/vad.ts`): an energy VAD with an adaptive noise floor. Audio is only sent once speech is confirmed (a 400 ms pre-roll avoids clipping the first word), silence ends the turn and triggers `response.create`. Speaking over the assistant **barges in**: `response.cancel`, the speaker buffer is flushed, and late audio from the cancelled response is dropped. While the assistant talks, a louder + longer speech threshold is required so it does not interrupt itself. Android "call" audio mode + the platform echo canceller are enabled; headphones are still best.

Voice needs the **Omni** or **Audio** model. Images need **Omni** or **VL**. The app switches to a downloaded model that has the capability you ask for.

### Models (downloaded from Hugging Face on demand)

| Model | Files (Q4_0 weights + Q8_0 projector) | Size | Does |
|---|---|---|---|
| LFM3-Omni 2B | `LiquidAI/LFM3-Omni-2B-GGUF` | 1.56 GB | voice, images, text |
| LFM3-Audio 2B | `LiquidAI/LFM3-Audio-2B-GGUF` | 1.35 GB | voice, text |
| LFM3-VL 2B | `LiquidAI/LFM3-VL-2B-GGUF` | 1.25 GB | images, text |
| LFM3 1.7B | `LiquidAI/LFM3-1.7B-GGUF` | 1.05 GB | text |

Downloads pause/resume (and survive app restarts); sizes are verified exactly.

## Debugging crashes

Open **🐞 → Debug** (chip icon in the header):

- **Logs** – everything the app does, with share. Also mirrored to `files/logs/app.log`.
- **Server** – model server state, load time, the last 300 lines of its output, restart/stop.
- **Crashes** – JS fatal errors, render errors and native exceptions are written to disk *as they happen*; the next launch shows a banner. Also lists **why Android ended earlier runs** (out-of-memory kill, native crash, ANR…).
- **Device** – RAM, storage, CPU ABI, whether the server binary is in the APK.
- **Logcat** – this app's own system log.

From a computer: `adb logcat -s LiquidVoice ReactNativeJS AndroidRuntime`.

## Develop

```bash
npm ci
npm test            # unit tests (VAD, voice session, realtime client, SSE, catalog…)
npm run typecheck
```

The app needs its native build (not Expo Go). Locally you need the Android SDK/NDK; the easiest path is the workflow above.

## Credits & licences

- Models © Liquid AI, LFM Open License v1.0 – check it fits your use.
- Visual assets: the supplied "LFM3 Pocket" concept pack (unofficial; not affiliated with Liquid AI).
- llama.cpp (MIT).
