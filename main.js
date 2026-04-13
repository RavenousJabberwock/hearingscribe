const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');

let mainWindow;

// ── Path helpers ─────────────────────────────────────────────────────────────
// In production the Python backend sits next to the .exe in resources/
function resourcePath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...parts);
  }
  return path.join(__dirname, ...parts);
}

function pythonExe() {
  if (process.platform === 'win32') {
    return resourcePath('python', 'python.exe');
  }
  return resourcePath('python', 'bin', 'python3');
}

// ── Window ────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width:  600,
    height: 720,
    minWidth:  560,
    minHeight: 660,
    title: 'HearingScribe',
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile('app.html');
});

app.on('window-all-closed', () => app.quit());

// ── IPC: open file / folder ───────────────────────────────────────────────────
ipcMain.on('open-file',   (_, p) => shell.openPath(p));
ipcMain.on('open-folder', (_, p) => shell.showItemInFolder(p));

// ── IPC: transcribe ───────────────────────────────────────────────────────────
ipcMain.on('transcribe', (event, { filePath, format }) => {
  const send = (channel, data) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  };

  // Output file sits next to the source audio file
  const parsed  = path.parse(filePath);
  const outPath = path.join(parsed.dir, parsed.name + '_transcript.' + format);

  const scriptPath = resourcePath('transcribe.py');
  const py         = pythonExe();

  send('transcribe-progress', { step: 0, pct: 2, label: 'Loading audio file…', log: 'Starting transcription pipeline' });

  const proc = spawn(py, [
    scriptPath,
    '--input',  filePath,
    '--output', outPath,
    '--format', format,
  ]);

  let stderr = '';

  proc.stdout.on('data', raw => {
    const lines = raw.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        // Forward every progress message directly to the renderer
        send('transcribe-progress', msg);
      } catch {
        send('transcribe-progress', { log: line });
      }
    }
  });

  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', code => {
    if (code === 0) {
      send('transcribe-done', { outputPath: outPath });
    } else {
      const msg = stderr.split('\n').filter(Boolean).slice(-3).join(' | ') || 'Unknown error (exit ' + code + ')';
      send('transcribe-error', { message: msg });
    }
  });

  proc.on('error', err => {
    send('transcribe-error', {
      message: 'Could not start Python backend: ' + err.message +
               '\n\nMake sure setup.js completed successfully.',
    });
  });
});
