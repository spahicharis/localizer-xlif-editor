import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { TARGET_STATES, applyUpdates, parseXliff } from './xliff.js';
import { createFile, listFiles, readFileEntry, writeFileEntry } from './store.js';
import { translateFragment } from './translate.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const CLIENT_DIR = fileURLToPath(new URL('../dist/frontend/browser', import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) =>
    /\.(xlf|xliff|xml)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new Error('Only .xlf, .xliff or .xml files are supported.')),
});

/** Wraps an async handler so rejections reach the error middleware. */
const route = (handler) => (req, res, next) => handler(req, res).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const loadFile = async (id) => {
  try {
    return await readFileEntry(id);
  } catch {
    throw new HttpError(404, 'File not found.');
  }
};

const toResponse = (meta, xml) => ({ ...meta, ...parseXliff(xml) });

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/states', (_req, res) => res.json({ states: TARGET_STATES }));

app.get(
  '/api/files',
  route(async (_req, res) => res.json({ files: await listFiles() }))
);

app.post(
  '/api/files',
  upload.single('file'),
  route(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded.');
    const xml = req.file.buffer.toString('utf8');
    parseXliff(xml); // reject invalid documents before anything is persisted
    const meta = await createFile(req.file.originalname, xml);
    res.status(201).json(toResponse(meta, xml));
  })
);

app.get(
  '/api/files/:id',
  route(async (req, res) => {
    const { meta, xml } = await loadFile(req.params.id);
    res.json(toResponse(meta, xml));
  })
);

app.get(
  '/api/files/:id/download',
  route(async (req, res) => {
    const { meta, xml } = await loadFile(req.params.id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.originalName}"`);
    res.send(xml);
  })
);

app.put(
  '/api/files/:id/units',
  route(async (req, res) => {
    const units = req.body?.units;
    if (!Array.isArray(units) || units.length === 0)
      throw new HttpError(400, 'Provide a non-empty "units" array.');

    const updates = units.map((unit) => {
      if (!unit?.id) throw new HttpError(400, 'Every unit needs an "id".');
      const state = unit.state || 'translated';
      if (!TARGET_STATES.includes(state))
        throw new HttpError(400, `Unsupported state "${state}" on unit "${unit.id}".`);
      return { id: String(unit.id), target: String(unit.target ?? ''), state };
    });

    const { meta, xml } = await loadFile(req.params.id);
    let updated;
    try {
      updated = applyUpdates(xml, updates);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    await writeFileEntry(meta.id, updated);
    res.json({ saved: updates.length, ...toResponse(meta, updated) });
  })
);

app.post(
  '/api/files/:id/translate',
  route(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0)
      throw new HttpError(400, 'Provide a non-empty "ids" array.');

    const { meta, xml } = await loadFile(req.params.id);
    const parsed = parseXliff(xml);
    const from = req.body?.from || parsed.sourceLanguage;
    const to = req.body?.to || parsed.targetLanguage;
    if (!to) throw new HttpError(400, 'The file has no target-language; pass "to" explicitly.');

    const wanted = new Set(ids.map(String));
    const units = parsed.units.filter((unit) => wanted.has(unit.id));
    if (units.length === 0) throw new HttpError(404, 'None of the requested ids exist.');

    // Sequential on purpose: the free Google endpoint rate-limits parallel bursts.
    const translations = [];
    for (const unit of units) {
      try {
        translations.push({ id: unit.id, target: await translateFragment(unit.source, from, to) });
      } catch (error) {
        translations.push({ id: unit.id, error: error.message });
      }
    }
    res.json({ fileId: meta.id, from, to, translations });
  })
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

// Serves the built Angular app. In development `ng serve` proxies /api here
// instead, so a missing dist/ folder is only a warning.
if (existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h' }));
  // SPA fallback. Express 5 no longer accepts `app.get('*')`, hence a
  // terminal middleware that only answers navigation requests.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  const status = error.status ?? (error instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Localizer listening on http://localhost:${PORT}`);
  if (!existsSync(CLIENT_DIR))
    console.warn('No dist/ build found — run "npm run build" to serve the UI from this server.');
});
