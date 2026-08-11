import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../uploads', import.meta.url)));
const META = 'meta.json';
const FILE = 'file.xlf';

const dirFor = (id) => {
  const dir = path.join(ROOT, id);
  // Guards against `id` values such as `../../etc` reaching the filesystem.
  if (path.dirname(dir) !== ROOT) throw new Error('Invalid file id.');
  return dir;
};

export async function createFile(originalName, xml) {
  const id = randomUUID();
  const dir = dirFor(id);
  await mkdir(dir, { recursive: true });
  const meta = { id, originalName, uploadedAt: new Date().toISOString() };
  await writeFile(path.join(dir, FILE), xml, 'utf8');
  await writeFile(path.join(dir, META), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export async function readFileEntry(id) {
  const dir = dirFor(id);
  const [meta, xml] = await Promise.all([
    readFile(path.join(dir, META), 'utf8').then(JSON.parse),
    readFile(path.join(dir, FILE), 'utf8'),
  ]);
  return { meta, xml };
}

export async function writeFileEntry(id, xml) {
  await writeFile(path.join(dirFor(id), FILE), xml, 'utf8');
}

export async function listFiles() {
  await mkdir(ROOT, { recursive: true });
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const metas = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map((d) =>
        readFile(path.join(ROOT, d.name, META), 'utf8')
          .then(JSON.parse)
          .catch(() => null)
      )
  );
  return metas.filter(Boolean).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
