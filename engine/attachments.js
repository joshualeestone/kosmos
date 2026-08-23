'use strict';
/**
 * Documents attached to a conversation (#358).
 *
 * 🔑 A SECOND SURFACE, NEVER ROWS IN "FILES IN THIS PROJECT". That list is the
 * project folder, top level, newest first, and that is all it will ever be
 * (web/index.html, the Files section's own note: a comment promising that
 * attachments would join it cost the section a week of looking half-built).
 * So attachments live in their own place under the data root, per project
 * or per agent, keyed by an id this module mints, and the message carries
 * the record. The project folder is untouched.
 *
 * 🔑 HOW AN AGENT READS ONE. The message delivered to the agent's pane ends
 * with the absolute path of the stored file in the bracketed line, so `cat`
 * or `open` works on the spot. Nothing else tells the agent where the
 * folder is (Mona Lisa, 2026-08-23: the who-you-work-for block is about the
 * person; finding attachments it was not sent is a later card).
 *
 * ⚠️ A FILE FROM A PERSON IS BYTES, NOT A PROGRAM. The stored name is
 * sanitised to one path segment, the file is written with the bytes it
 * arrived with and never executed, served back with content-disposition
 * attachment and nosniff, and the preview is made by macOS's own renderer in
 * a subprocess with a timeout, never by parsing the file here.
 *
 * The record on a message row, the shape the page draws against:
 *   attachment: { id, name, type, size, kind, url, preview }
 *     kind     'image' | 'pdf' | 'text' | 'other'
 *     url      '/api/attachment/<id>', the file itself
 *     preview  '/api/attachment/<id>/preview' for image and pdf (a PNG, or
 *              the image itself), the text itself for kind 'text' (capped,
 *              so the card shows a snippet), null when there is none.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const store = require('./store');

const MAX_BYTES = 25 * 1024 * 1024;
const TEXT_SNIPPET = 2000;
const ROOT = path.join(store.ROOT, 'attachments');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/avif']);
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|x-sh)$)/;

function kindOf(type, name) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_TYPES.has(t) || /^\.(png|jpe?g|gif|webp|heic|avif)$/.test(ext)) return 'image';
  if (t === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (TEXT_TYPES.test(t) || /^\.(txt|md|markdown|csv|json|yaml|yml|log|sh|js|ts|py|html?|css)$/.test(ext)) return 'text';
  return 'other';
}

/** One path segment, never empty, never a dotfile, never a path. */
function safeName(name) {
  let n = String(name || '').replace(/[/\\\0]/g, '_').replace(/^\.+/, '').trim().slice(0, 160);
  if (!n) n = 'file';
  return n;
}

/** Where an owner's attachments live: ('project', id) or ('agent', name). */
function ownerDir(scope, owner) {
  const s = scope === 'project' ? 'project' : scope === 'agent' ? 'agent' : null;
  if (!s) throw new Error('attachments belong to a project or an agent');
  const key = store.safeKey(owner);
  return path.join(ROOT, s, key);
}

function newId() { return crypto.randomBytes(12).toString('hex'); }

/**
 * Store bytes as an attachment. Returns the record (with `dir` and `file`
 * for the server, which strips them before the row goes out).
 */
function save(scope, owner, { name, type, bytes }) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('there is nothing in that file');
  if (bytes.length > MAX_BYTES) throw new Error('that file is larger than 25 MB, which is the most a conversation can carry');
  const id = newId();
  const dir = path.join(ownerDir(scope, owner), id);
  const clean = safeName(name);
  const file = path.join(dir, clean);
  if (!file.startsWith(dir + path.sep)) throw new Error('that file name cannot be stored');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, bytes);
  const kind = kindOf(type, clean);
  const record = {
    id, name: clean, type: String(type || 'application/octet-stream').split(';')[0].trim().slice(0, 100) || 'application/octet-stream',
    size: bytes.length, kind, at: new Date().toISOString(), scope, owner: String(owner),
  };
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  return { ...record, dir, file };
}

/** The record for an id, with its paths, or null. Ids are hex, so the walk is
    bounded to the two scopes' folders and never reads a path the id built. */
function read(id) {
  const clean = String(id || '');
  if (!/^[0-9a-f]{24}$/.test(clean)) return null;
  for (const scope of ['project', 'agent']) {
    const base = path.join(ROOT, scope);
    let owners = [];
    try { owners = fs.readdirSync(base); } catch { continue; }
    for (const owner of owners) {
      const dir = path.join(base, owner, clean);
      let rec;
      try { rec = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')); } catch { continue; }
      const file = path.join(dir, safeName(rec.name));
      if (!fs.existsSync(file)) continue;
      return { ...rec, dir, file };
    }
  }
  return null;
}

/** The row's field: what the page draws against. `preview` is null, never
    absent, when there is none. */
function rowField(rec) {
  if (!rec) return null;
  let preview = null;
  if (rec.kind === 'image' || rec.kind === 'pdf') preview = '/api/attachment/' + rec.id + '/preview';
  else if (rec.kind === 'text') {
    try { preview = fs.readFileSync(rec.file, 'utf8').slice(0, TEXT_SNIPPET); } catch { preview = null; }
  }
  return { id: rec.id, name: rec.name, type: rec.type, size: rec.size, kind: rec.kind, url: '/api/attachment/' + rec.id, preview };
}

/* The preview renderer seam: tests replace it so nothing shells out. */
let renderer = null;
function setRenderer(fn) { renderer = typeof fn === 'function' ? fn : null; }

/**
 * A PNG preview: for an image, the file itself (the browser draws it; the
 * route caps nothing further because the file was capped on the way in);
 * for a PDF, the first page through qlmanage, cached beside the file. Returns
 * { ok: true, type, bytes } or { ok: false, because }.
 */
function preview(rec) {
  if (!rec) return { ok: false, because: 'no such attachment' };
  if (rec.kind === 'image') {
    try { return { ok: true, type: rec.type, bytes: fs.readFileSync(rec.file) }; } catch { return { ok: false, because: 'that file could not be read' }; }
  }
  if (rec.kind !== 'pdf') return { ok: false, because: 'no preview for this kind of file' };
  const out = path.join(rec.dir, 'preview.png');
  if (fs.existsSync(out)) {
    try { return { ok: true, type: 'image/png', bytes: fs.readFileSync(out) }; } catch { /* re-render below */ }
  }
  try {
    if (renderer) renderer(rec.file, rec.dir);
    else {
      /* qlmanage writes <file name>.png into the output folder. Ten seconds,
         then it is "no preview", never a hung request. */
      execFileSync('/usr/bin/qlmanage', ['-t', '-s', '1024', '-o', rec.dir, rec.file], { timeout: 10000, stdio: 'ignore' });
      const made = path.join(rec.dir, path.basename(rec.file) + '.png');
      if (fs.existsSync(made)) fs.renameSync(made, out);
    }
    if (!fs.existsSync(out)) return { ok: false, because: 'this Mac could not draw the first page' };
    return { ok: true, type: 'image/png', bytes: fs.readFileSync(out) };
  } catch {
    return { ok: false, because: 'this Mac could not draw the first page' };
  }
}

/** The sentence added to the wire so the agent can open the file. */
function wireNote(rec) {
  return rec ? ' [attached file: ' + rec.file + ']' : '';
}

module.exports = { MAX_BYTES, ROOT, kindOf, safeName, save, read, rowField, preview, wireNote, setRenderer };
