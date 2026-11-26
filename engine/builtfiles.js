'use strict';
/**
 * kosmos#9105: which files a built task delivered. One definition, read by engine/tasks.js (setBuilt), the task readout
 * and `kosmos task files` (engine/tasklist.js), so the board and both CLIs list the same files. No requires: the CLIs
 * load it from an install's engine folder.
 *
 * builtFiles holds one entry per file NAME: { name, fingerprint, by, path?, at?, checkedBy, checkedByPerson?, replaces? },
 * or { name, replaces } for a file withdrawn. The single-file fields (builtFingerprint ...) describe the first current
 * file, else the first withdrawn one.
 */
/* #6330, #7213: a fingerprint names its kind. */
const FINGERPRINT_RE = /^(?:sha256|pdf-normalized):[0-9a-f]{64}$/;
/* A file's name as sent: its base name, no folder, no control characters. Neither / nor \ (review 1: a name holding a
   backslash can carry a whole Windows path, C:\Users\..., past every view that strips paths, and into panes). A Mac file
   whose name holds one is sent the older way, without a name. */
function builtFileName(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 255 && v !== '.' && v !== '..'
    && !/[/\\\u0000-\u001f\u007f]/.test(v) ? v : '';
}
/* The base name of a kept path ('' for none), for a fingerprint sent the older way with its path: after the last / of a
   Mac path, after the last / or \ of a Windows one. */
function fileNameOf(p) {
  if (typeof p !== 'string' || !p) return '';
  return builtFileName(p.split(p.startsWith('/') ? '/' : /[\\/]/).pop());
}
/* The index of the file the single-file fields describe: the first current one, else the first (a withdrawn one); -1 for none. */
function mirrorIndex(list) {
  const i = list.findIndex((e) => e && e.fingerprint);
  return i >= 0 ? i : (list.length ? 0 : -1);
}
const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
/* A stored replaced-file record, in the one shape setBuilt writes (never a path). */
function replacedRecord(r) {
  return r && typeof r === 'object' && FINGERPRINT_RE.test(r.fingerprint || '')
    ? { fingerprint: r.fingerprint, by: typeof r.by === 'string' ? r.by : null, at: typeof r.at === 'string' ? r.at : null,
      checkedBy: names(r.checkedBy), ...(r.checkedByPerson === true ? { checkedByPerson: true } : {}) }
    : null;
}
/** kosmos#9105: a built task's files, in setBuilt's entry shape: builtFiles when stored, else the one file the single-file
 * fields describe (a mark from before #9105), else none. An entry with no fingerprint is a withdrawn file (its replaces). */
function filesOf(t) {
  if (!t || !t.builtAt) return [];
  /* Review 1: setBuilt stamps the list with the builtAt it wrote it with. A board from before #9105 drops neither (it
     does not know them), so after its clear, close or new mark the list no longer belongs to this mark: it is not read,
     and the task is the one file the single-file fields describe. That can leave out a file another mark sent (said
     too little), never brings back a cleared one (said too much). */
  const stale = Array.isArray(t.builtFiles) && t.builtFilesAt !== t.builtAt;
  const entry = (name, fp, by, p, at, checkedBy, checkedByPerson, replaces) => {
    const rep = replacedRecord(replaces);
    if (FINGERPRINT_RE.test(fp || '')) {
      return { name, fingerprint: fp, by: typeof by === 'string' ? by : null, ...(typeof p === 'string' && p ? { path: p } : {}),
        ...(typeof at === 'string' && at ? { at } : {}), checkedBy: names(checkedBy), ...(checkedByPerson === true ? { checkedByPerson: true } : {}),
        ...(rep ? { replaces: rep } : {}) };
    }
    return rep ? { name, replaces: rep } : null;
  };
  const one = entry(fileNameOf(t.builtFilePath), t.builtFingerprint, t.builtFingerprintBy, t.builtFilePath, t.builtFingerprintAt,
    t.builtCheckedBy, t.builtCheckedByPerson, t.builtReplaces);
  if (!Array.isArray(t.builtFiles) || stale) return one ? [one] : [];
  const list = t.builtFiles.map((e) => (e && typeof e === 'object'
    ? entry(builtFileName(e.name) || '', e.fingerprint, e.by, e.path, e.at, e.checkedBy, e.checkedByPerson, e.replaces) : null)).filter(Boolean);
  /* A board from before #9105 changes only the single-file fields and leaves builtFiles as it found it, so those fields
     are the authority for the file they describe: when the list's first file disagrees, it is rebuilt from them (and
     dropped when they say there is none). The list's other files are kept. */
  const mi = mirrorIndex(list);
  const bare = (e) => { if (!e) return 'null'; const { name: _n, ...rest } = e; return JSON.stringify(rest); };   // eslint-disable-line no-unused-vars
  if (bare(mi >= 0 ? list[mi] : null) === bare(one)) return list;
  if (mi < 0) return one ? [one] : list;
  if (!one) return list.filter((_, i) => i !== mi);
  return list.map((e, i) => (i === mi ? { ...one, name: one.name || e.name } : e));
}

/* Review 3: a file's name as the readout shows it: the long list's q() (quotes to ', brackets to parentheses, NFKC, one
   space) with format characters left out, as the readout prints it. A check given in this form finds its file. */
function shownName(v) {
  return String(v).normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
    .replace(/["ʺˮ′‵״〃❝❞\p{Pi}\p{Pf}]/gu, "'")
    .replace(/\p{Ps}/gu, '(').replace(/\p{Pe}/gu, ')');
}
module.exports = { FINGERPRINT_RE, builtFileName, fileNameOf, mirrorIndex, replacedRecord, filesOf, shownName };
