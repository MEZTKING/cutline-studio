# Cutline Studio

[![CI](https://github.com/MEZTKING/cutline-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/MEZTKING/cutline-studio/actions/workflows/ci.yml)
[![Windows build](https://github.com/MEZTKING/cutline-studio/actions/workflows/windows-build.yml/badge.svg)](https://github.com/MEZTKING/cutline-studio/actions/workflows/windows-build.yml)
[![Latest release](https://img.shields.io/github/v/release/MEZTKING/cutline-studio?label=download&color=5cf2b0)](https://github.com/MEZTKING/cutline-studio/releases/latest)

**Windows downloads:** [Releases](https://github.com/MEZTKING/cutline-studio/releases/latest) — portable ZIP and NSIS installer.

A touch-first, browser-native video editor. Import, cut, trim, grade, title, mix, and export — all on your device, with no upload and no account.

**Status: v0.10.0 — two builds from one engine, now with a headless render CLI and localhost automation API, linked A/V editing, source-aware projects, a fullscreen monitor, a DaVinci-style colour page, and an in-app updater.** This is a real editing engine and a real export pipeline, not a mockup. It is deliberately shaped like a professional NLE (multi-track timeline, keyframes, transitions, WebCodecs export), but it is **not yet at Premiere / DaVinci parity** — see the roadmap for the honest gap list.

![Cutline Studio](docs/screens/desktop-editing.png)

---

## Two builds, one engine

| | **Cutline Light** | **Cutline Heavy (desktop)** |
| --- | --- | --- |
| Runs on | Phone, tablet, any browser, installed PWA | Windows / macOS / Linux desktop |
| Media | Picked into browser memory | **Streamed from disk** with range seeking |
| Projects | One autosaved workspace (IndexedDB) | **`.cutline` files**, last project reopens, crash autosave |
| Export | WebCodecs (MP4 when supported, else WebM) | WebCodecs render **+ FFmpeg masters**: H.264, HEVC, ProRes |
| Footprint | 42 MB lazy-loaded bundle | ~420 MB installed (Electron + FFmpeg) |
| Best for | Capture-to-post on a phone, quick edits | Long footage, guaranteed codecs, delivery masters |

The desktop app is additive: it loads the same UI and editor, then adds native capabilities through a
small IPC bridge. The web build remains zero-install and unchanged.

## The professional pillars

| Pillar | Today | Next |
| --- | --- | --- |
| **Edit** | Multi-track timeline, trim/split/ripple, roll, slip, linked A/V detach, J/L trims, snapping, keyframes, undo | Slide, multi-select, insert/overwrite, multicam, nested sequences |
| **Color** | GPU primary grade, lift/gamma/gain wheels, 3D LUTs, live scopes, bypass | Curves, HSL qualifier, power windows, node graph, keyframed grades, HDR |
| **Audio** | dB gain, pan, 3-band EQ, compressor, normalize, fades, presets, solo/mute | Buses, ducking, 5.1, denoise |
| **Effects** | Ten transitions, auto-reframe, titles, captions | Keying, masks, motion tracking, Fusion-style node effects |
| **Media** | Disk streaming, `.cutline` projects, autosave | Proxies, bundles/relink, background workers, media library |
| **Updates** | Auto-check, SHA-256 verified download, portable self-replace | Code-signed NSIS updater, delta downloads |
| **Delivery** | WebCodecs + FFmpeg masters, headless CLI, localhost job API | YouTube/Vimeo publishing, render queue, watch folders, presets |

### App updates

- **Help → Check for Updates…** and a silent check 8 seconds after launch (desktop, packaged builds).
- Shows the new version, release notes, and size; downloads with a progress bar.
- Verifies the download against the **SHA-256** in the update feed before installing.
- **Restart & install**: the helper waits for the app to close, replaces the portable app
  folder, and relaunches the new build. The previous folder is kept until the swap succeeds.
- Feed URL is editable in the dialog (default: the GitHub Releases `latest.json`);
  downloads run in the main process, not the renderer.
- The first updater-equipped build was **0.7.0** — older builds need one manual download.
- **0.8.0** was the first release to exercise the updater; **0.9.0** is the next update target.

![App updater](docs/screens/desktop-update.png)

This is the honest shape of "DaVinci + Premiere": each pillar needs real engineering. The app is
built so pillars can land independently on the same project model and renderer.

![Cutline Heavy](docs/screens/desktop-heavy.png)

## Automation: CLI + local API

Cutline can render without the editor UI and accept jobs from other local services.

### CLI

Development:

```bash
npm run build
npm run cli -- render project.cutline --out output.mp4 --width 1920 --height 1080 --fps 24
```

Packaged Windows (from the app folder):

```powershell
.\"Cutline Studio.exe" --render project.cutline --out output.mp4 --width 1920 --height 1080 --fps 24
```

Options: `--format auto|mp4|webm`, `--quality fast|balanced|high`, `--no-audio`,
`--json` (JSON-lines progress + result). The hidden renderer uses the same compositor,
colour grading, titles, transitions, and audio mix as the editor.

### Local HTTP API

```powershell
.\"Cutline Studio.exe" --serve --port 4317 --token YOUR_SECRET
```

```bash
curl http://127.0.0.1:4317/v1/health
curl -X POST http://127.0.0.1:4317/v1/render \
  -H "Authorization: Bearer YOUR_SECRET" -H "Content-Type: application/json" \
  -d '{"projectPath":"C:/work/a.cutline","outputPath":"C:/work/a.mp4","width":1920,"height":1080,"fps":24}'
curl -H "Authorization: Bearer YOUR_SECRET" http://127.0.0.1:4317/v1/jobs/<id>
```

- Binds **127.0.0.1 only**; every `/v1` route except `/v1/health` requires the bearer token.
- Jobs are queued and rendered one at a time; progress, phase, output path, bytes, and errors are
  visible on the job object.
- If `--token` is omitted, a random token is written to the app data folder and printed on startup.
- This is local automation, not a remote cloud service. **Direct YouTube/Vimeo upload is not
  included yet** — publishing needs OAuth app credentials and platform review; see the roadmap.
- The packaged Windows executable is a GUI app. `--render` writes its output and returns an exit
  code, but Windows may not attach progress output to a console; prefer the HTTP API for services.
- API jobs are in-memory and sequential; there is no cancel endpoint yet.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
# or a production build:
npm run build
npm run preview      # http://localhost:5173
```

Open that URL on the same machine, or on a phone connected to the same network
(`http://<computer-ip>:5173`). On Android Chrome you can use **Add to Home screen** —
the production build registers a service worker and runs offline.

### Heavy desktop build

```bash
npm install
npm run desktop:start        # builds the web bundle, opens the Electron app
```

Live-reload development (two terminals):

```bash
npm run dev
# Linux / macOS
CUTLINE_DEV_URL=http://127.0.0.1:5173 npx electron .
# Windows PowerShell
$env:CUTLINE_DEV_URL="http://127.0.0.1:5173"; npx electron .
```

Or package it:

```bash
npm run desktop:build        # unpacked app for the current OS (release/)
npm run desktop:dist:win     # Windows NSIS installer (run on Windows)
npm run desktop:dist:linux   # Linux AppImage (run on Linux)
```

On Windows, build a **portable folder** or an installer:

```powershell
npm ci
npm run build
npm run desktop:pack:win    # release/win-unpacked/Cutline Studio.exe (portable)
npm run desktop:dist:win    # release/Cutline-Studio-<version>-Setup.exe (installer)
```

The GitHub Actions workflow in `.github/workflows/windows-build.yml` also produces an
installer artifact from `windows-latest`. Builds are **unsigned**, so SmartScreen warns
(“More info” → “Run anyway”). The portable folder is ~560 MB extracted (Electron 45 +
FFmpeg); the zip is smaller.

### Windows smoke checklist

Run this on the Windows machine before trusting it with a project:

1. Extract the whole portable zip and launch `Cutline Studio.exe`.
2. **File → Import Media**: a long MP4/MOV; scrub and play; confirm audio.
3. **File → Save Project**, quit, relaunch: the project should reopen; autosave recovers.
4. **Export** with **Desktop master with FFmpeg**: H.264, then ProRes; play both files.
5. Import a 24 fps clip: Project settings should auto-match its size/fps; open fullscreen.
6. Detach audio, trim the audio under the video for a J/L cut, then drag the amber cut bar to roll.
7. Colour page: import a `.cube` LUT, confirm scopes draw and the grade is in the export.
8. Report the exact error text and Windows version if anything fails.

Desktop-only behaviour:
- **File → Import Media** streams files from disk; nothing is copied into the app.
- **File → Save / Save As** writes a `.cutline` JSON project that references the source files
  by absolute path. **File → Open** and launch restore reopen it; autosave lives in the app
  data folder and recovers after a crash.
- **Export → Desktop master with FFmpeg** renders in the browser, then writes H.264, HEVC, or
  ProRes with a native save dialog. `Show in folder` reveals the result.
- Native menus, `Ctrl+S` / `Ctrl+O` / `Ctrl+I`, and a window title follow the project.

Heavy v1 caveats: the master is a **transcode of the browser render**, not a frame-accurate
native pipeline (generation loss is possible). Projects reference source paths rather than
bundling media, so moving a project requires the media to stay in place. Proxies, a render
queue, and multicam are not in this build yet. FFmpeg's GPL build (x264/x265) has distribution
implications — see *Third-party assets*.

Everything stays in the browser: media is read with object URLs, audio is decoded with
Web Audio, and the project autosaves to IndexedDB. Nothing is uploaded.

### Canvas resolution and frame rate

Click the **resolution / fps pills** at the top-left of the viewer (or click empty space in the
timeline) to deselect a clip and open **Inspector → Project settings**. On desktop you can also
use **File → Project Settings…** (`Ctrl/Cmd+,`).

**Auto by default.** A new project adopts the canvas and frame rate of the **first video or
image** imported into an empty timeline. The desktop build reads the exact frame rate from
FFmpeg; the browser estimates it from frame timestamps. Change the canvas or fps once and the
project switches to **Custom**; **Match source** re-applies it at any time.

- **Canvas** — 1080p, 4K, 720p, vertical 9:16, square, cinema 2.39:1, or custom width/height.
- **Frame rate** — 23.976, 24, 25, 29.97, 30, 50, 59.94, or 60 fps.
- **Match source** in Project settings adopts the first video's size and detected frame rate.
- These apply to the **whole project** and are undoable. Changing canvas size does not rescale
  existing clips; use **Fill frame** (Transform) or **Auto-reframe** to refit them.
- **Fullscreen** (expand button or double-click the viewer) renders the preview at your display's
  resolution — up to 4K — at project fps. It does **not** alter the project or export settings.
- **Export resolution and fps are separate**: the Export dialog can render 720p/1080p/4K or
  vertical/square at a different frame rate from the project canvas.

![Fullscreen preview](docs/screens/desktop-fullscreen.png)

### Phone notes

- The UI is mobile-first: preview on top, timeline at the bottom, and **Media / Edit / Export** sheets.
- Import with the system file picker; files stay on-device.
- Tap a media card to drop it at the playhead, or drag it onto a specific track.
- Export runs locally through WebCodecs. On Android Chrome it can usually write **MP4 (H.264 + AAC)**;
  elsewhere it falls back to **WebM (VP9 + Opus)** automatically.
- Keep the tab in the foreground while exporting; long renders are CPU-bound.

---

## What it does today

**Editing**
- Unlimited video/audio tracks, 4K/vertical/square canvas presets, 23.976–60 fps.
- **Auto project setup** from the first source (exact fps on desktop), with a manual override.
- **Fullscreen preview** at display resolution, up to 4K, without changing export settings.
- Drag, trim from either edge, split at the playhead, delete or ripple-delete.
- Magnetic snapping to clip edges and the playhead; locked tracks; mute/hide.
- Frame stepping, timeline scrubbing, scrubbing while paused, auto-scroll during playback.
- **Scrub preview** — hover (or scrub) the ruler to see the composited frame and timecode.
- **Fine scrub** (`F`) — 1/5-speed, frame-snapped ruler dragging for exact cuts.
- **Slip** — `Alt`-drag a clip to change its source in-point without moving it.
- **Roll** — drag the thin amber bar at a cut to move the edit point and trim both clips at once.
- **Detach audio** — creates a linked audio clip on an audio track. Linked clips move together,
  while trims stay independent for **J and L cuts**.
- **Unlink A/V** when you want both halves to move independently.
- Undo/redo with 50 steps, per-gesture history (a drag is one undo step).

**Look**
- Per-clip transform (position, scale, rotation, opacity), fit or fill-frame.
- Keyframes on position, scale, rotation, opacity, and volume, with smooth interpolation.
- Colour grade: exposure, contrast, saturation, temperature, hue, blur, vignette.
- Ten transitions: dissolve, dip to black/white, four wipes, two slides, iris —
  with automatic audio crossfades.

**Titles & captions**
- Vector title clips rendered at export resolution: font size, colour, backdrop
  colour/opacity, padding, alignment, bold, shadow, plus transform/keyframes.
- **On-device auto-captions** with Whisper tiny (English): transcribes the timeline
  locally, creates editable cues on a dedicated CC track, and downloads the ~41 MB
  model once. Nothing is uploaded.
- Manual cues, .srt import/export, caption position (bottom/middle/top), restyling,
  and the same keyframe/transform toolkit as titles.

**Color page**
- **GPU grade** per clip: lift / gamma / gain colour wheels, exposure, contrast,
  saturation, temperature, hue, vignette, blur — preview and export share the same shader.
- **3D LUTs**: import `.cube` files, blend with the mix control, and keep them in the project.
  Built-ins include Monochrome, Teal & Orange, Warm/Cool Film, and Faded Matte.
- **Live scopes**: RGB waveform, vectorscope, and histogram sampled from the viewer.
- **Viewer bypass** for before/after, plus a reset and a dedicated Color workspace on desktop
  and a bottom sheet on phones that keeps the preview visible.
- Requires WebGL2 for LUTs and wheels; without it the basic sliders fall back to Canvas2D filters.

**Edit tools**
![Roll, slip, detach](docs/screens/desktop-edit-tools.png)

**Audio page**
![Audio controls](docs/screens/audio-panel.png)

**Scrub preview**
![Scrub preview](docs/screens/scrub-preview.png)

**Reframing**
- **Auto-reframe** to 9:16, 4:5, 1:1, or 16:9: detects faces on-device (BlazeFace),
  fills the new canvas, and keyframes the pan so the subject stays in shot.
- One undo restores the previous canvas and framing. Locked tracks are left alone,
  text/caption cues are preserved.
- Centre-crop fallback when no face is found or the detector is unavailable.

**Audio**
- dB gain, pan, 3-band EQ, compressor, normalize, clip mute, track solo.
- Fade in/out with **linear / smooth / exponential** curves (audio and video fades).
- **Dialogue / Music / SFX** presets that set EQ + compression in one click.
- Web Audio mixdown with keyframed volume, speed, and transition crossfades.
- Automatic audio decode on import; waveform thumbnails in the bin and on the timeline.

**Delivery**
- WYSIWYG export using the *same* compositor as the preview.
- MP4 (H.264/AAC) or WebM (VP9/Opus), automatic codec fallback, 720p → 4K.
- Progress, cancel, "Download again", and native sharing where supported.
- Autosave and session restore; projects survive a reload.
- Installable PWA with offline shell; everything works with no network.

| Desktop | Phone |
| --- | --- |
| ![Desktop editing](docs/screens/desktop-editing.png) | ![Mobile editing](docs/screens/mobile-editing.png) |

![Heavy desktop export](docs/screens/desktop-heavy-export.png)

![Colour page](docs/screens/desktop-color.png)

![Captions](docs/screens/desktop-captions.png)

![Phone captions](docs/screens/mobile-captions.png)

![Auto-reframe](docs/screens/desktop-reframe.png)

![Phone auto-reframe](docs/screens/mobile-reframe.png)

![Colour page on a phone](docs/screens/mobile-color.png)

![Export](docs/screens/desktop-export.png)

---

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Play / pause | `Space` |
| Split at playhead | `S` or `Ctrl/Cmd+K` |
| Delete / ripple delete | `Delete` / `Shift+Delete` |
| Duplicate clip | `Ctrl/Cmd+D` |
| Add title | `T` |
| Captions panel | `C` |
| Auto-reframe | `R` |
| Fine scrub | `F` |
| Slip a clip | `Alt` + drag |
| Roll an edit | drag the amber cut bar |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Step a frame | `←` / `→` (add `Shift` for 1 s) |
| Start / end | `Home` / `End` |
| Zoom timeline | `+` / `-`, or `Ctrl/Cmd` + wheel |
| Fullscreen viewer | double-click the viewer, or the expand button |

---

## How it is built

```
src/
  core/        types, pure project model, placement helpers
  state/       zustand store: projects, selection, history, gestures
  media/       web + native import, metadata probing, thumbnails, audio, peaks
  render/      Canvas2D compositor (transforms, grade, transitions, titles)
  audio/       Web Audio playback clock, scheduling, offline mixdown
  export/      WebCodecs video/audio encoders + mp4-muxer / webm-muxer
  captions/    Whisper ASR wrapper, SRT parser/formatter
  reframe/     BlazeFace wrapper, framing math, keyframe planning
  desktop/     renderer bridge + project serialization for the heavy shell
  persistence/ IndexedDB autosave (web)
  ui/          React app shell, timeline, preview, inspector, dialogs

desktop/
  main.cjs     Electron main: app/menus, cutline:// protocols, project + FFmpeg IPC
  preload.cjs  context-isolated native bridge
```

Key ideas:

1. **One compositor for preview and export.** `drawFrame()` is resolution-independent;
   preview renders at ≤1280 px, export renders at the target size. WYSIWYG by construction.
2. **Audio-clocked playback.** Audio is decoded into `AudioBuffer`s and scheduled against
   `AudioContext.currentTime`; the playhead is derived from that clock, so A/V stays in sync.
   Muted `<video>` elements are used only as textures, nudged when they drift.
3. **Seek-based deterministic export.** Every frame seeks its sources, draws, then feeds a
   `VideoFrame` to `VideoEncoder`. Audio is mixed in an `OfflineAudioContext`, encoded to
   AAC or Opus, and muxed into MP4/WebM.
4. **Pure model + gesture history.** Project mutations are immutable; drags open a gesture
   and commit one history entry on release, so undo behaves the way editors expect.
5. **Honest fallbacks.** No WebCodecs → the export dialog explains it instead of failing silently.
   No AAC → WebM. No duration metadata in a WebM → probe by seeking to the end.
6. **One renderer, two shells.** The Electron shell serves the same built UI over a secure
   `cutline://` protocol. Disk media streams over `cutline-media://` with HTTP range support,
   so a multi-GB source never has to be copied into the renderer. Native IPC handles project
   files, autosave, audio extraction, and FFmpeg masters.

### Verification

`npm run test:smoke` drives a real Chromium build end-to-end: it generates a test clip,
tone, and still in-browser, imports them, plays, splits, undoes, drags, trims, adds a
transition, exports, decodes the exported file's video/audio, reloads to test autosave,
and checks the mobile layout. `node tests/features.mjs` covers titles, decimal inputs,
duplicate/undo, and persistence.

Latest runs: **all suites passing** — end-to-end smoke (import → edit → transition →
export → decode → offline reload), on-device caption generation from real speech,
SRT round-trip, auto-reframe with a moving face, titles and decimal inputs, export
cancel-and-retry, audio pan/mute/presets through export, detach/link, roll/slip, J/L trims,
fine scrub + thumbnails,
source auto-match at 24 fps, fullscreen display-resolution preview, detach/link, roll/slip,
**headless CLI + local API renders with audio**, mobile/landscape layout, and the GPU colour page (LUT application,
channel order, bypass, scopes, burned-in export, persistence, phone sheet). Reports are
written to `test-results/`.

```bash
npm test          # SRT + framing math, smoke, features, mobile, captions, auto-reframe
DISPLAY=:99 npm run test:color   # GPU colour page (needs a display + Mesa/SwiftShader)
DISPLAY=:99 npm run test:updater # auto-check, dialog, verified download (Electron)
DISPLAY=:99 npm run test:auto    # 24 fps auto-match, override, fullscreen canvas (headed)
npm run test:edit                # detach/link, J/L trims, roll, slip
npm run test:cli                 # headless render + local API (Electron, needs a display)
DISPLAY=:99 npm run test:desktop:fps # exact FFmpeg fps + auto-match in Electron
```

The web suites need Playwright Chromium; set `CHROME_PATH` to override the executable.

The desktop shell has its own end-to-end tests (run under Xvfb or a desktop session):

```bash
DISPLAY=:99 npm run test:desktop          # imports, range seek, save/reopen, FFmpeg master, relaunch
DISPLAY=:99 npm run test:desktop:autosave # crash autosave recovery
DISPLAY=:99 npm run test:desktop:packaged # packaged app + bundled FFmpeg
```

Reports land in `test-results/desktop-*.json`; the colour report is `test-results/color-report.json`.

---

## License

No open-source license has been selected yet. The repository is public so the code can be read,
tested, and reviewed; **all rights are reserved** until a license is added. If you want to reuse
it, please open an issue first.

## Known limits (read this)

- **Not parity yet.** No masks/tracking, no multicam, no proxy media, no collaboration,
  no HDR/colour management, no Fairlight/Fusion equivalents.
- Colour v1 is a **primary grade per clip**: no curves, HSL qualifiers, power windows,
  node graphs, or keyframed grades yet. LUT import is 3D `.cube` only.
- Audio v1 has per-clip EQ/compression but no buses, sidechain ducking, noise reduction, or 5.1.
- Fine scrub is 1/5 speed; hover preview renders a small composited frame and is throttled
  for performance.
- Edit v1 has roll/slip and linked audio detach, but **no slide, multi-select, insert/overwrite,
  multicam, or nested sequences** yet. Linked clips move together but trims stay independent by design.
- Desktop v1: the FFmpeg master is transcoded from the browser render, projects reference
  media paths (no bundle/relink UI yet), and there is no proxy or render-queue workflow.
- The **normal** preview is capped at 1280 px for performance; fullscreen uses display resolution (up to 4K). Neither changes export resolution.
- Automation v1 renders the browser containers (MP4/WebM); the CLI does not yet request ProRes/HEVC masters or manage a persistent render queue. The API is local-only and renders one job at a time.
- Direct publishing is not implemented. YouTube requires a Google OAuth client, consent-screen verification, and API quota; Vimeo needs an access token; TikTok/Instagram require app review and business accounts.
- Browser frame-rate detection is an estimate from frame timestamps; the Windows build asks FFmpeg for the exact source fps.
- Transitions require the clips to be adjacent on the same track; audio uses source
  handles, so a transition may shorten to the available audio.
- Long WebM exports decode source audio fully in memory. Very large projects may need
  a desktop browser.
- One autosaved project per browser profile. Clearing site data deletes the project and
  its media; there is no backup bundle yet.
- MP4/H.264/AAC availability is browser- and device-dependent. The app detects support
  and falls back, but a browser without WebCodecs (older Safari) cannot export.
- Captions are English-only (Whisper tiny.en), capped at the first 10 minutes per run.
  The first run downloads ~41 MB of model weights plus a ~27 MB WASM runtime, then
  caches them on the device.
- Auto-reframe tracks **faces**, not arbitrary objects. It resets each visual clip to
  fill / 100% scale / 0° and replaces its position keyframes; locked tracks are skipped.
  The face detector (~225 KB model + ~14 MB WASM, bundled locally) loads on first use.

---

## Roadmap to "top-tier"

**Automation & delivery (next):** YouTube OAuth upload, Vimeo token upload, render queue,
watch folders, project bundles/proxies.

**P0 — trust and speed**
- Backup/restore project bundles (zip with media), relink, cloud-free sync.
- Full GPU compositor (WebGL2/WebGPU) for blend modes, masks, and 60 fps 4K preview;
  primary colour grading + LUTs already run on the GPU.
- Colour page: curves, HSL qualifier, power windows, node graph, colour-managed pipeline.
- Professional edit tools: roll/slip/slide, J/L cuts, multi-select, insert/overwrite.
- Fairlight-lite audio: EQ, compressor, bus, ducking.
- Proxy generation + background thumbnail/waveform workers.
- Per-clip crop rectangle, speed curves, freeze frames, reverse.
- Desktop: native frame pipeline, proxies, render queue, project bundles with relinking.

**P1 — CapCut-level ease**
- Caption translation, multilingual Whisper models, speaker labels, caption templates.
- Object/subject tracking beyond faces, multi-subject reframing, manual tracking points.
- Beat detection and auto-cut to music, silence removal, scene detection.
- Sticker/emoji overlays, transitions library with presets, social aspect presets.

**P2 — professional depth**
- Curve-based colour grading, node graphs, qualifiers, HDR colour management.
- Fusion-style effects: keying, masks, motion tracking.
- Multicam, nested sequences/adjustment layers, motion tracking and stabilisation.
- Audio bus, EQ/compressor/denoise, ducking, 5.1.
- Team projects, review links, comments, version history.

**Packaging**
- **Shipped:** an Electron heavy shell (`desktop/`) with secure custom protocols, native
  project files, disk streaming, FFmpeg masters, menus, and autosave. It is verified running
  from source and as a packaged Linux app in this environment.
- **Windows:** `electron-builder` NSIS configuration and a `windows-latest` GitHub Actions
  workflow are included. The installer is **unsigned**; SmartScreen will warn. A Windows
  binary cannot be built or executed in this Android/Linux container — the first real Windows
  run will be the CI artifact or a local Windows build. The packaged Linux app **is** verified
  (imports, range streaming, save/reopen, autosave, H.264/ProRes masters, relaunch).
- **Long-term:** Tauri remains an option for a much smaller shell with the same UI and a Rust
  native backend. The renderer, project model, and FFmpeg bridge are shell-agnostic.

---

## Why two builds

Running Windows on an Android phone through emulation is not viable for video editing:
no GPU video path, no reliable codec support, and unusable performance. So the light build
stays in the browser: it runs on the phone today, installs as a PWA, and needs no install.
The heavy build exists where heavy work belongs — a desktop machine with real disk I/O,
guaranteed codecs, and FFmpeg. One engine, two shells; edits move through `.cutline`
projects (paths/relinking bundles are the next milestone).

---

Built with React 19, TypeScript, Vite, zustand, WebGL2, Electron, FFmpeg, `mp4-muxer`,
`webm-muxer`, transformers.js (Whisper), and MediaPipe (BlazeFace). No analytics, no telemetry, no network
calls at runtime beyond the one-time Whisper model download.

### Third-party assets

- **FFmpeg static** (GPL build with x264/x265, bundled as a desktop resource). For commercial
  distribution, use an LGPL FFmpeg build or system FFmpeg and review licensing.
- **MediaPipe BlazeFace** face detector (`public/models/face_detector.tflite`, Apache-2.0)
  and the MediaPipe vision WASM runtime (Apache-2.0), synced from `node_modules` into
  `public/vendor/` by `scripts/sync-mediapipe.mjs`.
- **Whisper tiny.en** ONNX weights (MIT via OpenAI / onnx-community) are fetched on first
  caption use, then cached by the browser.
- Test fixtures include a public-domain official portrait and a public-domain JFK speech
  sample; they are not shipped in the app bundle.
