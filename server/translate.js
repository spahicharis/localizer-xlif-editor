import translator from '@parvineyvazov/json-translator';

const { translateWord, TranslationModules } = translator;
const MODULE_KEY = 'google';

const config = {
  moduleKey: MODULE_KEY,
  TranslationModule: TranslationModules[MODULE_KEY],
  concurrencyLimit: 4,
  fallback: true,
  cacheEnabled: true,
};

const SUPPORTED = new Set(Object.values(TranslationModules[MODULE_KEY].languages));

/** Maps an XLIFF locale (`en-US`, `pt-BR`) onto a code the module understands. */
export function toLanguageCode(locale) {
  const code = String(locale ?? '').trim().toLowerCase();
  if (!code) return '';
  if (SUPPORTED.has(code)) return code;
  const base = code.split(/[-_]/)[0];
  return SUPPORTED.has(base) ? base : '';
}

const ENTITIES = [
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
];

const decodeEntities = (s) => ENTITIES.reduce((acc, [e, c]) => acc.split(e).join(c), s);
const encodeEntities = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Replaces inline XLIFF markup (`<x id="INTERPOLATION"/>`, `<ph>`, ...) with
 * numeric tokens so the translation engine leaves it intact.
 */
function maskInlineTags(fragment) {
  const tags = [];
  const masked = fragment.replace(/<[^>]+>/g, (tag) => `{${tags.push(tag) - 1}}`);
  return { masked, tags };
}

const unmaskInlineTags = (text, tags) =>
  text.replace(/\{\s*(\d+)\s*\}/g, (match, index) => tags[Number(index)] ?? match);

/**
 * Translates an XLIFF source fragment, preserving inline tags and re-escaping
 * the result so it stays a valid XML fragment.
 */
export async function translateFragment(fragment, from, to) {
  const source = String(fragment ?? '');
  if (!source.trim()) return source;

  const fromCode = toLanguageCode(from) || 'auto';
  const toCode = toLanguageCode(to);
  if (!toCode) throw new Error(`Unsupported target language: "${to}".`);

  const { masked, tags } = maskInlineTags(source);
  const translated = await translateWord(decodeEntities(masked), fromCode, toCode, config);
  return unmaskInlineTags(encodeEntities(String(translated ?? '')), tags);
}
