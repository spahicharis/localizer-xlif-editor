import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';

const XML_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  suppressEmptyNode: true,
  processEntities: true,
};

const parser = new XMLParser(XML_OPTS);
const builder = new XMLBuilder({ ...XML_OPTS, format: false });

export const TARGET_STATES = [
  'new',
  'needs-translation',
  'needs-review-translation',
  'translated',
  'signed-off',
  'final',
];

const tagOf = (node) => Object.keys(node).find((k) => k !== ':@' && k !== '#text');
const childrenOf = (node, tag) => node[tag] ?? [];
const attrsOf = (node) => node[':@'] ?? {};
const findChild = (nodes, tag) => nodes.find((n) => tagOf(n) === tag);
const findAll = (nodes, tag) => nodes.filter((n) => tagOf(n) === tag);

/** Serializes the children of an element back to an XML fragment string. */
const innerXml = (nodes) => (nodes ? builder.build(nodes) : '');

/**
 * Parses an XML fragment written by the user. Anything that is not well-formed
 * XML (e.g. a bare `&` or `<`) is treated as literal text instead.
 */
function fragmentToNodes(fragment) {
  const text = fragment ?? '';
  if (!text) return [];
  const wrapped = `<t>${text}</t>`;
  if (XMLValidator.validate(wrapped) === true) {
    const parsed = parser.parse(wrapped);
    return childrenOf(parsed[0], 't');
  }
  return [{ '#text': text }];
}

/** Plain-text view of an element's content, with inline tags stripped. */
const plainText = (nodes) =>
  (nodes ?? [])
    .map((n) => (n['#text'] !== undefined ? n['#text'] : innerXml([n])))
    .join('');

function readNote(unit, from) {
  const note = findAll(unit, 'note').find((n) => attrsOf(n)['@_from'] === from);
  return note ? plainText(childrenOf(note, 'note')) : '';
}

function readLocations(unit) {
  return findAll(unit, 'context-group').flatMap((group) => {
    const contexts = findAll(childrenOf(group, 'context-group'), 'context');
    const value = (type) => {
      const ctx = contexts.find((c) => attrsOf(c)['@_context-type'] === type);
      return ctx ? plainText(childrenOf(ctx, 'context')) : '';
    };
    const file = value('sourcefile');
    if (!file) return [];
    const line = value('linenumber');
    return [line ? `${file}:${line}` : file];
  });
}

/** Locates the <body> element of the first <file> in an XLIFF 1.2 document. */
function locateBody(doc) {
  const xliff = findChild(doc, 'xliff');
  if (!xliff) throw new Error('Not an XLIFF document: missing <xliff> root element.');
  const file = findChild(childrenOf(xliff, 'xliff'), 'file');
  if (!file) throw new Error('Invalid XLIFF: missing <file> element.');
  const body = findChild(childrenOf(file, 'file'), 'body');
  if (!body) throw new Error('Invalid XLIFF: missing <body> element.');
  return { file, body };
}

export function parseXliff(xml) {
  if (XMLValidator.validate(xml) !== true) throw new Error('The file is not well-formed XML.');

  const doc = parser.parse(xml);
  const { file, body } = locateBody(doc);
  const fileAttrs = attrsOf(file);
  const transUnits = findAll(childrenOf(body, 'body'), 'trans-unit');

  const units = transUnits.map((node) => {
    const unit = childrenOf(node, 'trans-unit');
    const target = findChild(unit, 'target');
    return {
      id: String(attrsOf(node)['@_id'] ?? ''),
      source: innerXml(childrenOf(findChild(unit, 'source') ?? {}, 'source')),
      target: target ? innerXml(childrenOf(target, 'target')) : '',
      state: target ? String(attrsOf(target)['@_state'] ?? '') : '',
      hasTarget: Boolean(target),
      description: readNote(unit, 'description'),
      meaning: readNote(unit, 'meaning'),
      locations: readLocations(unit),
    };
  });

  return {
    sourceLanguage: String(fileAttrs['@_source-language'] ?? ''),
    targetLanguage: String(fileAttrs['@_target-language'] ?? ''),
    original: String(fileAttrs['@_original'] ?? ''),
    units,
  };
}

/**
 * Applies target/state updates to the original XML and serializes it back,
 * leaving every untouched node (and the surrounding whitespace) as it was.
 */
export function applyUpdates(xml, updates) {
  const doc = parser.parse(xml);
  const { body } = locateBody(doc);
  const byId = new Map(updates.map((u) => [String(u.id), u]));
  const applied = [];

  for (const node of findAll(childrenOf(body, 'body'), 'trans-unit')) {
    const update = byId.get(String(attrsOf(node)['@_id'] ?? ''));
    if (!update) continue;

    const unit = childrenOf(node, 'trans-unit');
    let target = findChild(unit, 'target');
    if (!target) {
      target = { target: [], ':@': {} };
      insertTarget(unit, target);
    }
    target.target = fragmentToNodes(update.target);
    target[':@'] = { ...attrsOf(target), '@_state': update.state };
    applied.push(update.id);
  }

  const missing = updates.filter((u) => !applied.includes(u.id)).map((u) => u.id);
  if (missing.length) throw new Error(`Unknown trans-unit id(s): ${missing.join(', ')}`);

  return restoreProlog(xml, builder.build(doc));
}

/** Inserts a new <target> right after <source>, mirroring its indentation. */
function insertTarget(unit, target) {
  const sourceIndex = unit.findIndex((n) => tagOf(n) === 'source');
  if (sourceIndex === -1) {
    unit.push(target);
    return;
  }
  const before = unit[sourceIndex - 1];
  const indent = before?.['#text']?.match(/\n[ \t]*$/)?.[0];
  unit.splice(sourceIndex + 1, 0, ...(indent ? [{ '#text': indent }, target] : [target]));
}

/**
 * fast-xml-parser normalizes the XML declaration and drops trailing whitespace,
 * so both are copied over from the source document.
 */
function restoreProlog(original, rebuilt) {
  const declaration = /^<\?xml[^?]*\?>\s*/;
  const originalDecl = original.match(declaration)?.[0];
  const out = originalDecl ? rebuilt.replace(declaration, originalDecl) : rebuilt;

  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return out.replace(/\s*$/, trailing);
}
