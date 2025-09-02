/**
 * PixieShare — zero-compression media uploader & sharer
 *
 * Features:
 * • Upload photos & media (images / video / audio / any file)
 * • Generates shareable view links (/f/:id)
 * • Direct, no-recompression raw links (/raw/:id)
 * • "Download original" keeps exact bytes & filename (/d/:id)
 * • Simple JSON metadata store at uploads/_files.json
 * • Clean drag-and-drop UI with multi-file + progress
 * • No gzip middleware enabled → we never compress the file bytes
 *
 * Quickstart:
 *   1. npm init -y
 *   2. npm install express multer nanoid mime-types
 *   3. node server.js
 *
 * ENV:
 *   PORT              (default 3000)
 *   UPLOAD_DIR        (default ./uploads)
 *   MAX_FILE_SIZE_MB  (default 500)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const { nanoid } = require('nanoid');
const mime = require('mime-types');

// ---------- Config ----------
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 500);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const DB_FILE = path.join(UPLOAD_DIR, '_files.json');

// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Tiny JSON metadata store ----------
let db = {};
try {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  }
} catch (e) {
  console.error('Failed to load DB_FILE:', e);
}

async function saveDB() {
  const tmp = DB_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DB_FILE);
}

// ---------- Multer storage ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = nanoid(12);
    const ext = path.extname(file.originalname || '') || '';
    file.generatedId = id;
    file.generatedFilename = id + ext;
    cb(null, file.generatedFilename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ---------- App ----------
const app = express();
app.set('trust proxy', true);
app.use('/static', express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
function html(strings, ...values) {
  return String.raw({ raw: strings }, ...values);
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fileKind(m) {
  if (!m) return 'file';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  return 'file';
}

function absoluteBase(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

// ---------- Routes ----------

// Home
app.get('/', (req, res) => {
  const maxMb = MAX_FILE_SIZE_MB;
  res.type('html').send(html`<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PixieShare — Upload & Share Originals</title>
    <link rel="icon" href="data:,"/>
    <style>
      :root { --bg:#0b1020; --card:#121832; --ink:#e7ecff; --muted:#a9b4d0; --brand:#7c88ff; --accent:#ff8ad6; }
      *{box-sizing:border-box}
      html,body{height:100%}
      body{margin:0;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Inter,Apple Color Emoji,Noto Color Emoji;background:radial-gradient(1200px 600px at 80% -10%, #1a2050 0%, #0b1020 40%), var(--bg);color:var(--ink)}
      .wrap{max-width:900px;margin:0 auto;padding:32px}
      header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
      .logo{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),#9bd1ff);box-shadow:0 8px 24px rgba(255,138,214,.25)}
      h1{font-size:24px;margin:0}
      .card{background:#121832;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
      .drop{border:2px dashed rgba(255,255,255,.18);border-radius:18px;padding:28px;text-align:center;cursor:pointer;transition:.2s;}
      .drop:hover{border-color:var(--brand);background:rgba(124,136,255,.06)}
      .drop.drag{border-color:var(--accent);background:rgba(255,138,214,.08)}
      input[type=file]{display:none}
      .muted{color:var(--muted)}
      .btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--brand),#a3abff);color:#0b0f1c;border:0;border-radius:14px;padding:10px 14px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(124,136,255,.25)}
      .row{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
      .item{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:12px;flex:1 1 280px;min-width:260px}
      .bar{height:8px;background:rgba(255,255,255,.08);border-radius:8px;overflow:hidden;margin-top:8px}
      .bar > i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent),#9bd1ff)}
      .links a{color:#c9d1ff}
      code{background:rgba(255,255,255,.08);padding:3px 6px;border-radius:6px}
      footer{margin-top:24px;color:var(--muted);font-size:12px}
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <div class="logo"></div>
        <h1>PixieShare <span class="muted">— Upload & share originals (no compression)</span></h1>
      </header>
      <div class="card">
        <label class="drop" id="drop">
          <input id="picker" type="file" multiple>
          <div>
            <div style="font-size:18px;font-weight:700;margin-bottom:6px">Drop files here, paste, or click to choose</div>
            <div class="muted">Max ${esc(maxMb)} MB per file • Originals only, no recompression • Shareable links auto-generated</div>
          </div>
        </label>
        <div id="list" class="row"></div>
      </div>
      <footer>
        Pro-tip: paste an image (⌘/Ctrl+V) to upload instantly. Your files are served with their original bytes; we never transcode or compress them.
      </footer>
    </div>
    <script>
      const picker = document.getElementById('picker');
      const drop = document.getElementById('drop');
      const list = document.getElementById('list');
      function addItemCard(file) {
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = \`
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${file.name}</div>
            <div class="muted" style="font-size:12px">\${(file.size/1024/1024).toFixed(2)} MB</div>
          </div>
          <div class="bar"><i></i></div>
          <div class="links" style="margin-top:8px;display:none"></div>
        \`;
        list.prepend(el);
        return el;
      }
      async function uploadFiles(files) {
        if (!files || !files.length) return;
        const form = new FormData();
        [...files].forEach(f => form.append('files', f));
        const cards = [...files].map(addItemCard);
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/upload');
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            const pctEach = (e.loaded / e.total);
            cards.forEach(c => c.querySelector('.bar > i').style.width = (pctEach*100).toFixed(1) + '%');
          };
          const resp = await new Promise((resolve, reject) => {
            xhr.onreadystatechange = () => {
              if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
                else reject(new Error(xhr.responseText || 'Upload failed'));
              }
            };
            xhr.send(form);
          });
          resp.files.forEach((info, idx) => {
            const card = cards[idx];
            const bar = card.querySelector('.bar > i');
            bar.style.width = '100%';
            const viewer = new URL(info.view, window.location.origin);
            const raw = new URL(info.raw, window.location.origin);
            const dl = new URL(info.download, window.location.origin);
            const links = card.querySelector('.links');
            links.style.display = 'block';
            links.innerHTML = \`
              <a href="\${viewer}" target="_blank">Open link</a> •
              <a href="\${dl}">Download original</a> •
              <a href="\${raw}" target="_blank">Direct raw</a> •
              <a href="#" data-copy="\${viewer}">Copy link</a>
            \`;
            links.addEventListener('click', (e) => {
              const a = e.target.closest('a[data-copy]');
              if (a) { e.preventDefault(); navigator.clipboard.writeText(a.getAttribute('data-copy')); a.textContent = 'Copied!'; setTimeout(()=>a.textContent='Copy link', 1200); }
            });
          });
        } catch (err) { alert('Upload failed: ' + (err && err.message || err)); }
      }
      drop.addEventListener('click', () => picker.click());
      picker.addEventListener('change', () => uploadFiles(picker.files));
      ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); e.stopPropagation(); drop.classList.add('drag');}));
      ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); e.stopPropagation(); drop.classList.remove('drag');}));
      drop.addEventListener('drop', (e)=>{ uploadFiles(e.dataTransfer.files); });
      window.addEventListener('paste', (e)=>{ const items = e.clipboardData && e.clipboardData.files; if (items && items.length) uploadFiles(items); });
    </script>
  </body>
  </html>`);
});

// Upload endpoint
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const now = new Date().toISOString();
  const out = [];
  for (const f of req.files || []) {
    const id = f.generatedId;
    const ext = path.extname(f.originalname || '') || '';
    let m = f.mimetype || mime.lookup(ext) || 'application/octet-stream';
    if (m === false) m = 'application/octet-stream';
    db[id] = {
      id,
      filename: f.generatedFilename,
      originalName: f.originalname || f.generatedFilename,
      mime: m,
      size: f.size,
      uploadedAt: now,
    };
    out.push({ id, name: db[id].originalName, view: `/f/${id}`, raw: `/raw/${id}`, download: `/d/${id}` });
  }
  try { await saveDB(); } catch(e) { console.error('DB save error', e); }
  res.json({ files: out });
});

// View page
app.get('/f/:id', (req, res) => {
  const id = String(req.params.id || '');
  const meta = db[id];
  if (!meta) return res.status(404).type('html').send('<h1>Not found</h1>');
  const base = absoluteBase(req);
  const rawUrl = `${base}/raw/${id}`;
  const dlUrl = `${base}/d/${id}`;
  const kind = fileKind(meta.mime);
  const viewer = {
    image: `<img src="${rawUrl}" alt="${esc(meta.originalName)}" style="max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(255,255,255,.12)"/>`,
    video: `<video src="${rawUrl}" controls style="width:100%;max-height:75vh;border-radius:12px;border:1px solid rgba(255,255,255,.12)"></video>`,
    audio: `<audio src="${rawUrl}" controls style="width:100%"></audio>`,
    pdf: `<iframe src="${rawUrl}" style="width:100%;height:80vh;border:1px solid rgba(255,255,255,.12);border-radius:12px"></iframe>`,
    file: `<div class="muted">Preview not available. Use the download button below.</div>`
  }[kind];
  res.type('html').send(html`<!doctype html>
  <html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(meta.originalName)} — PixieShare</title>
  <style>body{margin:0;background:#0b1020;color:#e7ecff;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Inter}.wrap{max-width:900px;margin:0 auto;padding:24px}a{color:#c9d1ff}.head{display:flex;justify-content:space-between;gap:12px;align-items:center}.btn{display:inline-flex;gap:8px;background:linear-gradient(135deg,#7c88ff,#a3abff);color:#0b0f1c;border:0;border-radius:12px;padding:10px 14px;font-weight:600;cursor:pointer}.meta{color:#a9b4d0;font-size:14px;margin:6px 0 16px}</style>
  </head><body><div class="wrap"><div class="head"><h1 style="margin:0;font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(meta.originalName)}</h1><div><a class="btn" href="${dlUrl}">Download original</a><button class="btn" id="copy">Copy link</button></div></div>
  <div class="meta">${esc(meta.mime)} • ${(meta.size/1024/1024).toFixed(2)} MB • uploaded ${esc(new Date(meta.uploadedAt).toLocaleString())}</div>
  <div>${viewer}</div><div style="margin-top:16px" class="meta">Direct raw link: <a href="${rawUrl}">${rawUrl}</a></div></div>
  <script>document.getElementById('copy').addEventListener('click', ()=>{navigator.clipboard.writeText(window.location.href);const b=document.getElementById('copy');b.textContent='Copied!';setTimeout(()=>b.textContent='Copy link',1200);});</script>
  </body></html>`);
});

// Raw bytes
app.get('/raw/:id', (req, res) => {
  const id = String(req.params.id || '');
  const meta = db[id];
  if (!meta) return res.status(404).send('Not found');
  const filePath = path.join(UPLOAD_DIR, meta.filename);
  if (!fs.existsSync(filePath)) return res.status(410).send('Gone');
  res.set('Content-Type', meta.mime || 'application/octet-stream');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath);
});

// Download original
app.get('/d/:id', (req, res) => {
  const id = String(req.params.id || '');
  const meta = db[id];
  if (!meta) return res.status(404).send('Not found');
  const filePath = path.join(UPLOAD_DIR, meta.filename);
  if (!fs.existsSync(filePath)) return res.status(410).send('Gone');
  res.set('Content-Type', meta.mime || 'application/octet-stream');
  res.download(filePath, meta.originalName);
});

// Health
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Server
app.listen(PORT, () => {
  console.log(`PixieShare running on http://localhost:${PORT}`);
  console.log(`Uploads → ${UPLOAD_DIR}`);
  console.log(`Max file size → ${MAX_FILE_SIZE_MB} MB`);
});

