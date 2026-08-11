# Localizer

XLIFF 1.2 translation editor: upload an `.xlf`, edit targets, machine-translate keys, and write
the result back into the uploaded file.

Single npm project — the Express server also serves the built Angular app, so there is one
`package.json`, one `npm install`, and one deployable process.

## Layout

```
angular.json, tsconfig*.json   Angular workspace config (project name: "frontend")
src/                           Angular 20 standalone app (signals, no NgModules)
public/                        static assets, incl. logo.svg (also the favicon)
server/                        Express API (ESM, Node >= 20)
  server.js                    routes + static hosting of dist/
  xliff.js                     XLIFF 1.2 parse/patch
  translate.js                 Google translation
  store.js                     upload storage
sample/messages.de.xlf         fixture for manual testing
uploads/<uuid>/                runtime data: file.xlf + meta.json (gitignored)
dist/frontend/browser/         ng build output, served by server.js
```

- `server/xliff.js` parses and patches with `fast-xml-parser` in `preserveOrder` mode. Saving is a
  round-trip of the original document, so untouched nodes and whitespace stay byte-identical;
  only the `<target>` elements you changed differ.
- `server/translate.js` uses `@parvineyvazov/json-translator` (the npm package of
  `mololab/json-translator`). Inline tags such as `<x id="INTERPOLATION"/>` are masked as `{0}`
  before translating and restored afterwards.

## Run

```bash
npm install

npm run dev      # ng serve on :4200 (proxies /api) + node --watch on :3000
npm run serve    # production-like: ng build, then one server on :3000 serving UI + API
npm start        # server only (expects an existing dist/ build)
```

`npm run dev` is the everyday loop: the Angular dev server gives HMR and forwards `/api` to the
Express process via `proxy.conf.json`. `npm run serve` mirrors deployment: a single process on
`PORT` (default 3000) hosting both the UI and the API, so relative `/api` calls work with no CORS.

## Verify

```bash
npm run build    # AOT build, catches template/type errors
npm test         # karma, needs Chrome
```

The server has no test runner; exercise it against the fixture (with the server running):

```bash
ID=$(curl -s -F "file=@sample/messages.de.xlf" localhost:3000/api/files | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -X POST localhost:3000/api/files/$ID/translate -H 'content-type: application/json' -d '{"ids":["app.cancel"]}'
curl -s -X PUT localhost:3000/api/files/$ID/units -H 'content-type: application/json' -d '{"units":[{"id":"app.cancel","target":"Abbrechen","state":"translated"}]}'
diff sample/messages.de.xlf uploads/$ID/file.xlf   # only the edited <target> should differ
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `GET` | `/api/states` | allowed `target/@state` values |
| `GET` | `/api/files` | uploaded files |
| `POST` | `/api/files` | multipart `file` upload, returns parsed units |
| `GET` | `/api/files/:id` | re-read a parsed file |
| `GET` | `/api/files/:id/download` | download the current `.xlf` |
| `PUT` | `/api/files/:id/units` | `{units:[{id,target,state}]}`, saves in place |
| `POST` | `/api/files/:id/translate` | `{ids:[...]}`, translates source -> target language |

Unmatched `/api/*` paths return a JSON 404; every other GET falls back to `index.html` so Angular
routing keeps working. Express 5 rejects `app.get('*')`, so the fallback is a terminal middleware.

## Deploy

Build then run one process: `npm ci && npm run build && npm start`, with `PORT` from the
environment. Note the build needs devDependencies, so don't install with `--omit=dev`.

## Notes

- Only XLIFF 1.2 (`<trans-unit>`) is handled; XLIFF 2.0 (`<unit>/<segment>`) would need a second
  parser in `server/xliff.js`.
- Target editing accepts XML fragments so inline placeholders survive. Input that is not
  well-formed XML (e.g. a bare `&`) is escaped as literal text.
- The translation module uses the free, unofficial Google endpoint. It currently works from the
  Render deployment, but this endpoint is commonly rate-limited (HTTP 429) from datacenter IPs and
  can start failing without warning.
- Live deployment: https://localizer-xlif-editor-full.onrender.com/ (Render free tier, sleeps
  after 15 min idle).
- `uploads/` is a plain directory on local disk. On hosts with an ephemeral filesystem
  (Render free, etc.) uploads are lost on restart, redeploy or idle spin-down.
