/**
 * HearingScribe — setup.js
 * Run once with:  node setup.js
 */

const https     = require('https');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { spawnSync } = require('child_process');

const ROOT   = __dirname;
const PY_DIR = path.join(ROOT, 'python');
const PY_EXE = path.join(PY_DIR, 'python.exe');
const PIP    = path.join(PY_DIR, 'Scripts', 'pip.exe');

function log(m)  { console.log('  ' + m); }
function ok(m)   { console.log('  \u2713  ' + m); }
function head(m) { console.log('\n\u2500\u2500 ' + m + ' ' + '\u2500'.repeat(Math.max(0, 50 - m.length))); }
function die(m)  { console.error('\n\u2717  ERROR: ' + m); process.exit(1); }

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) die('Command failed: ' + cmd);
}

function dl(url, dest, token) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const u    = new URL(url);
    const g    = url.startsWith('https') ? https : http;
    const hdrs = { 'User-Agent': 'HearingScribe/1.0' };
    if (token) hdrs['Authorization'] = 'Bearer ' + token;
    g.get({ hostname: u.hostname, path: u.pathname + u.search, headers: hdrs }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        file.close(); try { fs.unlinkSync(dest); } catch(e) {}
        return dl(res.headers.location, dest, token).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); try { fs.unlinkSync(dest); } catch(e) {}
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let recv = 0, last = -1;
      res.on('data', c => {
        recv += c.length;
        if (total) {
          const p = Math.floor(recv / total * 100);
          if (p !== last && p % 5 === 0) {
            process.stdout.write('\r     ' + p + '%  (' + (recv/1048576).toFixed(0) + ' / ' + (total/1048576).toFixed(0) + ' MB)   ');
            last = p;
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); console.log(); resolve(); });
    }).on('error', e => { try { fs.unlinkSync(dest); } catch(_) {} reject(e); });
  });
}

function writePythonScript(filePath, lines) {
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

(async () => {

// ── 1. Python ─────────────────────────────────────────────────────────────────
head('Python 3.12 standalone');
const PY_TAR = path.join(ROOT, '_py.tar.gz');
const PY_URL = 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.12.3+20240415-x86_64-pc-windows-msvc-install_only.tar.gz';

if (!fs.existsSync(PY_EXE)) {
  log('Downloading Python 3.12 (~30 MB)...');
  await dl(PY_URL, PY_TAR);
  ok('Downloaded');
  log('Extracting...');
  run('tar -xzf "' + PY_TAR + '" -C "' + ROOT + '"');
  try { fs.unlinkSync(PY_TAR); } catch(e) {}
  ok('Extracted to ./python/');
} else {
  ok('Already present - skipping');
}

// ── 2. Packages ───────────────────────────────────────────────────────────────
head('Python packages');
log('Upgrading pip...');
run('"' + PY_EXE + '" -m pip install --upgrade pip --quiet');
log('Installing PyTorch CPU build (~250 MB)...');
run('"' + PY_EXE + '" -m pip install torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cpu --quiet');
log('Installing Whisper, pyannote, docx, soundfile...');
run('"' + PY_EXE + '" -m pip install openai-whisper "pyannote.audio>=4.0" soundfile python-docx --quiet');
ok('All packages installed');

// ── 3. Whisper large-v3 ───────────────────────────────────────────────────────
head('Whisper large-v3 model (~3 GB)');
const W_DIR  = path.join(ROOT, 'models', 'whisper');
fs.mkdirSync(W_DIR, { recursive: true });
const W_FILE = path.join(W_DIR, 'large-v3.pt');
const W_URL  = 'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt';

if (!fs.existsSync(W_FILE)) {
  log('Downloading (~3 GB, this takes a while)...');
  await dl(W_URL, W_FILE);
  ok('Whisper large-v3 downloaded');
} else {
  ok('Already present - skipping');
}

// ── 4. pyannote via Python from_pretrained ────────────────────────────────────
head('pyannote speaker-diarization-community-1 (~1 GB)');

const HF_FILE = path.join(ROOT, '.hf_token');
let token = '';
if (fs.existsSync(HF_FILE)) {
  token = fs.readFileSync(HF_FILE, 'utf8').trim();
  ok('HuggingFace token found');
} else {
  console.log([
    '',
    '  +----------------------------------------------------------+',
    '  |  One-time HuggingFace token needed for speaker ID model  |',
    '  |                                                          |',
    '  |  1. Free account at https://huggingface.co               |',
    '  |  2. Accept: hf.co/pyannote/speaker-diarization-community-1|',
    '  |  3. Accept: hf.co/pyannote/segmentation-3.0              |',
    '  |  4. Token (read): hf.co/settings/tokens                  |',
    '  +----------------------------------------------------------+',
    '',
  ].join('\n'));
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  token = await new Promise(res => rl.question('  Paste token: ', t => { rl.close(); res(t.trim()); }));
  if (!token) die('No token provided.');
  fs.writeFileSync(HF_FILE, token);
  ok('Token saved to .hf_token');
}

const CACHE = path.join(ROOT, 'models', 'pyannote_cache');
fs.mkdirSync(CACHE, { recursive: true });

// Write download script using array join to avoid template literal escaping issues
const dlPy = path.join(ROOT, '_dl_pyannote.py');
writePythonScript(dlPy, [
  'import os, sys',
  'os.environ["HF_HOME"] = ' + JSON.stringify(CACHE),
  'os.environ["HUGGING_FACE_HUB_TOKEN"] = ' + JSON.stringify(token),
  'from pyannote.audio import Pipeline',
  'print("Downloading pyannote/speaker-diarization-community-1...")',
  'try:',
  '    p = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=' + JSON.stringify(token) + ')',
  '    print("SUCCESS")',
  'except Exception as e:',
  '    print(f"FAILED: {e}", file=sys.stderr)',
  '    sys.exit(1)',
]);

log('Running pyannote download (HuggingFace will show per-file progress)...\n');
const r = spawnSync('"' + PY_EXE + '"', [dlPy], { shell: true, stdio: 'inherit', cwd: ROOT, timeout: 1800000 });
try { fs.unlinkSync(dlPy); } catch(e) {}

if (r.status !== 0) {
  die(
    'pyannote download failed.\n\n' +
    '  Common fixes:\n' +
    '  - Delete .hf_token and re-run if token is wrong/expired\n' +
    '  - Accept BOTH licenses:\n' +
    '      hf.co/pyannote/speaker-diarization-community-1\n' +
    '      hf.co/pyannote/segmentation-3.0\n' +
    '  - Re-run setup.js to resume'
  );
}
ok('pyannote models cached');

// ── 5. Flatten HF cache for electron-builder ──────────────────────────────────
// HuggingFace cache uses symlinks + deep snapshot dirs that confuse 7zip on Windows
head('Flattening model cache for packaging');
const FLAT_DIR = path.join(ROOT, 'models', 'pyannote_flat');
fs.mkdirSync(FLAT_DIR, { recursive: true });

const flatPy = path.join(ROOT, '_flatten.py');
writePythonScript(flatPy, [
  'import os, shutil, pathlib',
  'snapshots = pathlib.Path(' + JSON.stringify(CACHE) + ') / "hub"',
  'flat = pathlib.Path(' + JSON.stringify(FLAT_DIR) + ')',
  'copied = 0',
  'for root, dirs, files in os.walk(snapshots):',
  '    parts = pathlib.Path(root).relative_to(snapshots).parts',
  '    if "blobs" in parts:',
  '        continue',
  '    for fname in files:',
  '        src = pathlib.Path(root) / fname',
  '        try:',
  '            real = src.resolve()',
  '            if not real.exists() or not real.is_file():',
  '                continue',
  '            rel_parts = list(parts)',
  '            if len(rel_parts) > 3:',
  '                rel_parts = rel_parts[3:]',
  '            dest = flat / os.path.join(*rel_parts, fname) if rel_parts else flat / fname',
  '            dest.parent.mkdir(parents=True, exist_ok=True)',
  '            if not dest.exists():',
  '                shutil.copy2(real, dest)',
  '                copied += 1',
  '        except Exception as e:',
  '            print(f"  skip {fname}: {e}")',
  'print(f"Flattened {copied} files to {flat}")',
]);

const fr = spawnSync('"' + PY_EXE + '"', [flatPy], { shell: true, stdio: 'inherit', cwd: ROOT });
try { fs.unlinkSync(flatPy); } catch(e) {}
if (fr.status !== 0) die('Failed to flatten pyannote cache');
ok('Flattened to ./models/pyannote_flat/');

// ── 6. model_paths.json ───────────────────────────────────────────────────────
fs.writeFileSync(path.join(ROOT, 'model_paths.json'), JSON.stringify({
  whisper_dir:    W_DIR,
  pyannote_cache: CACHE,
  pyannote_flat:  FLAT_DIR,
}, null, 2));
ok('model_paths.json written');

// ── 7. package.json + npm install ─────────────────────────────────────────────
head('Electron setup');

fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify({
  name: 'hearingscribe', version: '1.0.0',
  description: 'Local-only hearing transcript generator',
  author: 'Agency',
  main: 'main.js',
  scripts: {
    start: 'electron .',
    dist:  'electron-builder --win',
    'dist-installer': 'electron-builder --win --config.win.target=nsis',
  },
  devDependencies: { electron: '^30.0.0', 'electron-builder': '^24.0.0' },
  build: {
    appId: 'gov.agency.hearingscribe',
    productName: 'HearingScribe',
    files: ['app.html', 'main.js', 'transcribe.py', 'model_paths.json'],
    extraResources: [
      { from: 'python',               to: 'python',               filter: ['**/*'] },
      { from: 'models/whisper',       to: 'models/whisper',       filter: ['**/*'] },
      { from: 'models/pyannote_flat', to: 'models/pyannote_flat', filter: ['**/*'] },
      { from: 'transcribe.py',        to: '.' },
      { from: 'model_paths.json',     to: '.' },
    ],
    // Default target is portable — avoids NSIS which struggles with large packages
    // and long paths from OneDrive. Run 'npm run dist-installer' for the NSIS installer.
    win: { target: [{ target: 'portable', arch: ['x64'] }] },
    directories: { output: 'C:\\HearingScribeDist' },
  },
}, null, 2));
ok('package.json written');

log('Running npm install...');
run('npm install');
ok('Done');

console.log([
  '',
  '\u2500'.repeat(49),
  '\u2713  Setup complete!',
  '',
  '    npm start       <- test the app',
  '    npm run dist    <- build the .exe  (in dist/)',
  '\u2500'.repeat(49),
  '',
].join('\n'));

})().catch(e => die(e.message || String(e)));
