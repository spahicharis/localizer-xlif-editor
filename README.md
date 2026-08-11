<div align="center">

<img src="public/logo.svg" alt="Localizer" width="96" height="96">

# Localizer

**A fast, no-nonsense editor for XLIFF translation files.**

Upload an `.xlf`, see every key, machine-translate what's missing, and write it straight back
to the file — without reformatting a single line you didn't touch.

<p>
  <img alt="Angular 20" src="https://img.shields.io/badge/Angular-20-DD0031?logo=angular&logoColor=white">
  <img alt="Node 26" src="https://img.shields.io/badge/Node.js-26-339933?logo=nodedotjs&logoColor=white">
  <img alt="Express 5" src="https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white">
  <img alt="XLIFF 1.2" src="https://img.shields.io/badge/XLIFF-1.2-6366f1">
  <img alt="License ISC" src="https://img.shields.io/badge/license-ISC-4f46e5">
</p>

</div>

<!-- Drop a screenshot of the editor here, e.g. ![Localizer](docs/screenshot.png) -->

---

## Why

Hand-editing `messages.xlf` is miserable: hundreds of `<trans-unit>` blocks, easy to break the XML,
and no quick way to see what's still untranslated. Most tools either want your whole project or
rewrite the file so aggressively that the diff is unreviewable.

Localizer does one thing: it gives you a table of your keys, a translate button, and a save that
produces a **clean diff**.

## Features

- **Upload & parse** — drop in an `.xlf` and get every `<trans-unit>` with its source, target,
  state, notes (`meaning` / `description`) and source-code locations.
- **Inline editing** — edit targets in place, with unsaved rows highlighted and revertible.
- **Machine translation** — translate a single key or every untranslated key in one click, using
  the source and target languages declared in the file.
- **Placeholder-safe** — inline markup like `<x id="INTERPOLATION" equiv-text="{{ name }}"/>` is
  masked before translation and restored afterwards, so interpolations never get mangled.
- **State management** — set `new`, `needs-translation`, `needs-review-translation`, `translated`,
  `signed-off` or `final`; editing an untranslated target flips it to `translated` automatically.
- **Filter & search** — by key, source, target, or translation state.
- **Byte-faithful saves** — only the `<target>` elements you changed are modified. Everything
  else, down to the whitespace, comes out identical.
- **Download** — grab the updated file at any time.

## Quick start

```bash
git clone <your-repo-url> localizer
cd localizer
npm install
npm run dev
```

Open <http://localhost:4200> and upload `sample/messages.de.xlf` to try it out.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Angular dev server on `:4200` (HMR, proxies `/api`) **+** API on `:3000` |
| `npm run serve` | Production-like: builds, then serves UI **and** API from one process on `:3000` |
| `npm start` | API + prebuilt UI only (expects an existing `dist/`) |
| `npm run build` | Production build into `dist/frontend/browser` |
| `npm test` | Unit tests (Karma, needs Chrome) |

## How it works

<details>
<summary><b>Saving without wrecking the diff</b></summary>

<br>

Naively re-serializing XML reflows whitespace, normalizes entities and rewrites self-closing tags,
turning a two-line change into a thousand-line diff.

Instead, the file is parsed with `fast-xml-parser` in `preserveOrder` mode — which keeps text
nodes, attribute order and entities intact — then only the targeted `<target>` nodes are patched
and the tree is rebuilt. The XML declaration and trailing newline are restored verbatim afterwards,
since the builder normalizes those. The result:

```diff
-        <target state="new">Welcome to the Localizer</target>
+        <target state="translated">Willkommen beim Localizer</target>
```

...and nothing else.

</details>

<details>
<summary><b>Keeping placeholders intact</b></summary>

<br>

Angular sources are full of inline markup:

```xml
<source>Hello <x id="INTERPOLATION" equiv-text="{{ name }}"/>, you have <x id="INTERPOLATION_1"/> new messages.</source>
```

Sending that to a translation engine returns garbage. Localizer replaces each inline tag with a
numeric token (`{0}`, `{1}`), translates the plain text, then substitutes the original tags back —
so placeholders survive translation and stay in the right grammatical position.

</details>

<details>
<summary><b>Editing raw XML fragments safely</b></summary>

<br>

Targets are edited as XML fragments, so you can move or adjust placeholders by hand. If what you
type isn't well-formed XML (a bare `&`, for instance), it's treated as literal text and escaped on
save rather than corrupting the document.

</details>

## API

The server is a plain REST API, usable on its own.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/states` | Allowed `target/@state` values |
| `GET` | `/api/files` | List uploaded files |
| `POST` | `/api/files` | Multipart `file` upload (max 20 MB), returns parsed units |
| `GET` | `/api/files/:id` | Re-read a parsed file |
| `GET` | `/api/files/:id/download` | Download the current `.xlf` |
| `PUT` | `/api/files/:id/units` | `{ units: [{ id, target, state }] }` — saves in place |
| `POST` | `/api/files/:id/translate` | `{ ids: [...] }` — translates the given keys |

## Project layout

```
src/                      Angular 20 standalone app (signals, no NgModules)
public/                   Static assets, incl. logo.svg
server/
  server.js               Routes + static hosting of the built UI
  xliff.js                XLIFF 1.2 parse / patch
  translate.js            Translation with placeholder masking
  store.js                Upload storage
sample/messages.de.xlf    Fixture for manual testing
uploads/<uuid>/           Runtime data: file.xlf + meta.json
```

One `package.json`, one `npm install`, one deployable process — Express serves the built Angular
app, so there's no CORS setup and no second deployment.

## Deploying

```bash
npm ci && npm run build && npm start   # honours $PORT
```

The build needs devDependencies, so don't install with `--omit=dev`. Any Node host works
(Render's free tier is a reasonable fit) — see the limitations below first.

## Limitations

Worth knowing before you rely on it:

- **XLIFF 1.2 only.** Files using XLIFF 2.0 (`<unit>` / `<segment>`) are rejected with a clear
  error rather than silently mis-parsed.
- **Translation uses an unofficial endpoint.** [`@parvineyvazov/json-translator`][jsontt] talks to
  the free Google Translate web endpoint. It's fine locally, but is commonly rate-limited (HTTP
  429) from datacenter IPs — so it may fail once deployed even though it works on your machine.
  Swap `server/translate.js` for the official Cloud Translation API if you need reliability.
- **Uploads are stored on local disk.** On hosts with an ephemeral filesystem they're lost on
  restart, redeploy or idle spin-down. Treat a session as upload → translate → save → download.
- **No auth, no concurrency control.** Two people editing the same file will overwrite each other.
  It's a local/internal tool, not a multi-user TMS.

## Tech stack

Angular 20 (standalone components, signals) · Express 5 · fast-xml-parser · Multer ·
[mololab/json-translator][jsontt]

## License

ISC.

[jsontt]: https://github.com/mololab/json-translator
