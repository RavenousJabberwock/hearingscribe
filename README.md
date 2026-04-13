# HearingScribe

Local-only hearing transcript generator for ALJ proceedings.
No audio or text is ever transmitted outside your machine.

---

## What you need before starting

- **Node.js 18+** — https://nodejs.org (LTS version)
- **~6 GB free disk space** (Python + models)
- **Internet access during setup only** — the finished .exe runs airgapped

---

## One-time setup (do this once, on any machine)

### 1. HuggingFace account (free, required for speaker ID)

The speaker identification model requires a free license agreement:

1. Create an account at https://huggingface.co
2. Accept the license at https://huggingface.co/pyannote/speaker-diarization-3.1
3. Accept the license at https://huggingface.co/pyannote/segmentation-3.0
4. Generate a token at https://huggingface.co/settings/tokens (Read access is enough)

You'll paste this token once when prompted by setup.js. It will be saved
to a file called `.hf_token` so you never need to enter it again.

---

### 2. Run setup

Open a terminal (Command Prompt or PowerShell) in this folder and run:

```
node setup.js
```

This will:
- Download a self-contained Python 3.12 environment (~30 MB)
- Install Whisper, pyannote, torch, and python-docx
- Download Whisper large-v3 model weights (~3 GB)
- Download pyannote speaker diarization weights (~1 GB)
- Set up Electron and electron-builder

**This takes 10–30 minutes depending on your connection.**
You only ever need to do this once.

---

### 3. Test the app

```
npm start
```

The app window will open. Try dropping in an audio file.

---

### 4. Build the .exe

```
npm run dist
```

Two files appear in the `dist/` folder:
- `HearingScribe Setup 1.0.0.exe` — installer (recommended for agency rollout)
- `HearingScribe 1.0.0.exe` — portable, no installation needed

---

## Deploying to other machines

Once built, the `.exe` contains everything:
- Python runtime
- All model weights
- No internet connection required, ever

For agency-wide rollout, distribute the installer `.exe`.
Users double-click it, click through the install wizard, and they're done.

---

## Airgap / security verification

To demonstrate that no data leaves the machine:

1. Disconnect the machine from the network
2. Open HearingScribe
3. Transcribe a file normally
4. The transcript is produced successfully

You can additionally run a network monitor (e.g. Wireshark) during
transcription to confirm zero outbound connections.

---

## Output format

Transcripts are saved next to the original audio file:

```
hearing_2024_03_15.m4a
hearing_2024_03_15_transcript.docx   ← created here
```

Speaker labels are auto-detected and named Speaker1, Speaker2, Speaker3.
Use Word's Find & Replace (Ctrl+H) to substitute real names agency-wide.

Example output:

    [Speaker1]  00:00:12
    The hearing will come to order. Please state your name for the record.

    [Speaker2]  00:00:18
    John Smith. I'm here regarding case number 2024-CV-0042.

    [Speaker3]  00:00:24
    Sarah Johnson, appearing on behalf of the agency.

---

## Troubleshooting

**"Could not start Python backend"**
→ Run `node setup.js` again. Something may not have downloaded completely.

**"HTTP 401" during setup**
→ Your HuggingFace token is invalid or expired. Delete `.hf_token` and re-run setup.js.

**"HTTP 403" during setup**
→ You haven't accepted the model license agreements on HuggingFace. See Step 1 above.

**Speakers not separated correctly**
→ This is most common with overlapping speech. The model works best with
  clear turn-taking, which is typical of formal ALJ hearings.

**Very slow transcription**
→ Transcription speed depends on CPU. A 1-hour hearing takes roughly
  25–45 minutes on a modern CPU with large-v3. If speed is critical,
  consider `medium` model instead (edit transcribe.py line that says "large-v3").
