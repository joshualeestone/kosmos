'use strict';

/**
 * Daily conversation-log compiler (#2924).
 *
 * Josh, 6.59 QA notes (fresh install): the "Chats" folder that "Show me where
 * the conversation lives" reveals holds one JSON per conversation, and there is
 * no human-readable rollup. He asked, verbatim: "is there a process we could
 * run so that it could store all those originals but then compile maybe a daily
 * conversation log that a person could actually look at ... labeled by date and
 * once a day it runs a process to compile all the JSONs into a daily log."
 *
 * This is that process. It is strictly READ-ONLY over `chats/`: it never
 * touches an original conversation file. It reads every conversation, flattens
 * the messages, groups them by calendar day, and writes one Markdown file per
 * day into a SIBLING directory `chats-daily/`. A full re-run overwrites each
 * day's file from source AND prunes day files whose messages are all gone, so a
 * scheduled daily run (or an on-demand click) keeps the rollup current: a
 * late-arriving message is picked up, an edited/deleted one is reflected, and an
 * emptied day's stale file is removed.
 *
 * A ROLLED-OVER conversation, one whose earlier rows sit in `.full` files beside
 * its thread file, is compiled whole when every one of those files can be
 * followed from the thread file (kosmos#5855; see followChain). While a `.full`
 * file is in the folder that no thread file leads to, or a thread file names an
 * earlier file that cannot be followed, the whole run is refused and nothing is
 * written or pruned (see compileAll).
 *
 * A `.superseded` file beside a thread file is an earlier project's thread
 * file and is compiled as a conversation of its own (kosmos#5866).
 *
 * ONE LIMIT ON THE PRUNE (kosmos#5866): a daily file with no readable messages left,
 * for a day no later than a thread file that is not read as a conversation (a
 * `.damaged` or unparseable one) could last have gained a message, is kept. Its messages may
 * be that file's, which cannot be compiled again (see compileAll).
 *
 * Why a sibling directory, not inside chats/: `engine/forget.js` enumerates
 * `chats/` as "conversations", and a reader (or a future removal sweep) must
 * never mistake a compiled rollup for a real conversation. Keeping it out of
 * chats/ is the same isolation reason the recommendation on the card gives.
 *
 * Privacy: because this compiles conversation content into a second place,
 * `engine/forget.js` deletes `chats-daily/` as a DERIVED view of the `chats`
 * kind (#2924), so "forget my conversations" takes the compiled copy too and no
 * plaintext residue survives the forget. Pruning above is complementary, not a
 * substitute: it runs only when the compiler is invoked, while forget clears the
 * whole dir on its own.
 *
 * The message shape is defined by `engine/chat.js` (the `record` writer): each
 * message is `{ at, text, from, wire?, attachments? }`, where `from` is the
 * SESSION name and an ABSENT/null `from` means the operator (#175). Display-name
 * resolution happens at the surface, not in the stored file, so this rollup
 * renders the session name as-is (with the operator shown as "You"); resolving
 * session names to display names is a documented follow-up, deliberately out of
 * v1 to avoid coupling a batch compiler to surface-only resolution.
 */

const fs = require('fs');
const path = require('path');
const store = require('./store');

/* The output directory name, exported so engine/forget.js deletes exactly the
   dir this module writes (a single source of truth: if this name changes,
   forget's cleanup follows it rather than silently leaving a privacy residue). */
const CHATS_DAILY_DIRNAME = 'chats-daily';

/* Day-file naming and recognition as ONE pair, so the write side and the prune
   side cannot drift: a format change touches only here. A day file is
   `<day>.md`; the recognizer accepts only a YYYY-MM-DD stem, which is what the
   default localDayOf produces. A custom dayOf yielding another format would
   simply not be recognized for pruning -- an under-prune, the safe direction. */
const DAY_STEM_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayFileName(day) { return `${day}.md`; }
function dayFromFileName(name) {
  if (typeof name !== 'string' || !name.endsWith('.md')) return null;
  const stem = name.slice(0, -3);
  return DAY_STEM_RE.test(stem) ? stem : null;
}

/* Direct-thread files are `chats/direct..<key>.json` (TWO dots) and project-room
   files are `<projectId>.<key>.json` (ONE dot), the same naming engine/chat.js
   uses. chat.js documents that the second dot is the guard: a project id never
   contains a dot, so even a project literally named "Direct" produces the
   one-dot `direct.<key>.json` and can never collide with a direct thread's
   `direct..<key>.json`. Order matters: the two-dot direct form also satisfies
   the looser project pattern, so direct is tested FIRST and returns; whatever
   reaches the project pattern is therefore a genuine project thread, INCLUDING
   one whose id is "direct". */
const DIRECT_THREAD_FILE = /^direct\.\.(.+)\.json$/;
const PROJECT_THREAD_FILE = /^([^.]+)\.(.+)\.json$/;

/* kosmos#5855: a rolled-over conversation's rows from before the ones its fresh file carries are only in a `.full`
   file beside its thread file (`<thread file>.<stamp>.<pid>.<ms>[.<n>].full`), which the two patterns above do not
   match; its fresh thread file names that file in `continues`.
   isRolledOverFileName recognises the name: any thread file's name, a dot, `.full` at the end. That is deliberately
   wide (a stray file named this way counts): counting too much refuses a run, counting too little prunes history. */
const ROLLED_OVER_SUFFIX = 'full';
/* How a thread file's name ends, as DIRECT_THREAD_FILE and PROJECT_THREAD_FILE above require. */
const THREAD_FILE_END = '.json';
/* The thread a set-aside file belongs to, or null: `<thread file's name>.<anything>.<suffix>` (or with nothing between). */
function asideThread(filename, suffix) {
  if (typeof filename !== 'string' || !filename.endsWith('.' + suffix)) return null;
  // Any ".json." may be where the thread file's name ends: a key may itself be "json" (`p.json.json`), so each is tried.
  for (let cut = filename.indexOf(THREAD_FILE_END + '.'); cut >= 0; cut = filename.indexOf(THREAD_FILE_END + '.', cut + 1)) {
    const desc = parseChatFileName(filename.slice(0, cut + THREAD_FILE_END.length));
    if (desc !== null) return desc;
  }
  return null;
}
function isRolledOverFileName(filename) {
  return asideThread(filename, ROLLED_OVER_SUFFIX) !== null;
}
/* The thread file's own name for a descriptor parseChatFileName returned: what that function was given. */
function threadFileName(desc) {
  return desc.kind === 'direct' ? `direct..${desc.key}${THREAD_FILE_END}` : `${desc.projectId}.${desc.key}${THREAD_FILE_END}`;
}
/* The most files one conversation's chain is followed through, as in engine/chat.js's asideChain. */
const CHAIN_MAX = 1000;
/**
 * kosmos#5855 step 2: the `.full` files a thread file CONTINUES, oldest first, read from `chatsDir`. `base` is the
 * thread file's own name and `key` its agent key; `parsed` is the file that names the newest one (the thread file,
 * or an earlier project's `.superseded` copy of it).
 *
 * The rule for following a name is engine/chat.js's asideChain's, restated here because that function reads only
 * Kosmos's own chats folder and this compiler is given a folder: the name is this thread file's name, a dot, and
 * `.full` at the end, with no path separator; the file parses, holds a message list, its `agent` is `key`, and its
 * `projectBornAt` is the one `parsed` carries. A test compares the two on files the real writer made.
 *
 * Returns `{ complete, earlier }`: `earlier` is [{ name, carried, messages }] as asideChain(..., true) gives it, and
 * `complete` is true only when the walk reached a file that names no earlier one. asideChain keeps what it read when
 * a link breaks; this compiler must not, because the days before the break would be rewritten short, so the caller
 * refuses the run unless `complete`.
 */
function followChain(chatsDir, base, key, parsed) {
  const ok = (n) => typeof n === 'string' && n.startsWith(base + '.') && n.endsWith('.' + ROLLED_OVER_SUFFIX)
    && !n.includes('/') && !n.includes('\\') && n.length < 300;
  const born = (parsed && parsed.projectBornAt) || null;
  let next = parsed && typeof parsed.continues === 'string' && parsed.continues ? parsed.continues : null;
  const earlier = [];
  const seen = new Set();
  while (ok(next) && !seen.has(next) && earlier.length < CHAIN_MAX) {
    seen.add(next);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(chatsDir, next), 'utf8')); } catch { return { complete: false, earlier }; }
    if (!rec || rec.agent !== String(key) || !Array.isArray(rec.messages)) return { complete: false, earlier };
    if ((rec.projectBornAt || null) !== born) return { complete: false, earlier };
    const cont = typeof rec.continues === 'string' ? rec.continues : null;
    const rows = rec.messages.filter((m) => m && typeof m === 'object' && typeof m.text === 'string');
    const carried = cont && Number.isInteger(rec.carried) && rec.carried > 0 ? Math.min(rec.carried, rows.length) : 0;
    earlier.unshift({ name: next, carried, messages: rows });
    next = cont;
  }
  // `next` is null only when the last file read names no earlier one (its `continues` is absent or not a string, as
  // asideChain reads it). An empty `continues` there is not that: it is a name that cannot be followed.
  return { complete: earlier.length > 0 && next === null, earlier };
}
/* kosmos#5866: the two other kinds of file engine/chat.js sets aside beside a thread file, under the same naming.
   `.superseded` is a WHOLE thread file: that of an earlier project of the same name, renamed aside when
   the first message of the later one arrived, whose own file then starts empty. So the two share no rows, and the
   set-aside one is read as a conversation of its own.
   `.damaged` is a thread file chat.js could not use as a conversation, renamed aside. It is never read here. */
const SUPERSEDED_SUFFIX = 'superseded';
const DAMAGED_SUFFIX = 'damaged';
/* When a set-aside file was set aside, read from its own name (`<thread file>.<stamp>.<pid>.<ms>[.<n>].<kind>`: the
   `<ms>` is the Date.now() chat.js's supersede puts there), as an ISO string, or null when the name carries none.
   Only 13 digits (what Date.now() gives until the year 2286) and only under a set-aside kind, so neither a live
   file's key nor a date someone typed into a name is read as that time. */
const SET_ASIDE_MS = new RegExp(`\\.(\\d{13})(?:\\.\\d{1,2})?\\.(?:${SUPERSEDED_SUFFIX}|${DAMAGED_SUFFIX}|${ROLLED_OVER_SUFFIX})$`);
function setAsideAt(filename) {
  const m = SET_ASIDE_MS.exec(String(filename));
  if (!m) return null;
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/* The words that mark a set-aside conversation's heading apart from the live one's. */
const EARLIER_PROJECT_NOTE = 'an earlier project of this name';
/* The second sign in a file that will not parse: `"continues"` followed by a non-empty string,
   anywhere in the raw text (wider than the parsed read, which takes the top-level field only). */
const NAMES_AN_EARLIER_FILE = /"continues"\s*:\s*"[^"]/;
/* What compileAll's summary says in `refused`, and the command's exit code for it (2 is a usage error). */
const REFUSED_ROLLED_OVER = 'rolled-over';
const EXIT_REFUSED = 3;
/* How many file names of each kind a refusal prints before it says "and N more": enough to find the files, short
   enough to read in a terminal. */
const REFUSAL_NAMES_SHOWN = 10;
/* A file or folder name as a refusal prints it: quoted and escaped as JSON does, then every character still outside
   printable ASCII written as a backslash-u escape. So the output is printable ASCII on one line whatever the name
   holds (a newline, a terminal escape, a right-to-left mark). */
function shownName(name) {
  return JSON.stringify(String(name)).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * Classify a filename in the chats dir. Returns a descriptor or null for
 * anything that is not a conversation file (seen-cursors, dotfiles, etc.).
 */
function parseChatFileName(filename) {
  if (!filename || typeof filename !== 'string' || filename.startsWith('.')) return null;
  const direct = DIRECT_THREAD_FILE.exec(filename);
  if (direct) return { kind: 'direct', key: direct[1] };
  const project = PROJECT_THREAD_FILE.exec(filename);
  if (project) return { kind: 'project', projectId: project[1], key: project[2] };
  return null;
}

/** A short human label for a conversation, used as the section heading. */
function conversationLabel(desc) {
  if (!desc) return 'Conversation';
  const label = desc.kind === 'direct' ? `Direct: ${desc.key}` : `${desc.projectId} : ${desc.key}`;
  // kosmos#5866: a set-aside conversation gets a heading of its own: never the live conversation's, and never another
  // set-aside one's unless the two began at the same moment (`earlier` says when the project began).
  return desc.earlier ? `${label} (${EARLIER_PROJECT_NOTE}, ${desc.earlier})` : label;
}

/* Default day/time derivation is LOCAL, which is what a person means by "daily".
   Both are injectable so tests are deterministic without depending on the
   runner's timezone (a UTC CI box and a Central laptop must not disagree). */
function localDayOf(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function localTimeOf(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

/* #3224: the LOCAL [start, end) millisecond window for a YYYY-MM-DD day string.
   `setDate(+1)` rolls the month and absorbs a DST-length day correctly (unlike
   start + 24h). Rejects (null) a string that is not a plain YYYY-MM-DD AND one
   whose components do not round-trip (2026-13-01, 2026-02-30 -- Date would
   silently normalize them into a different real day).

   ⚠️ This window is ALWAYS local, so it lines up with the DEFAULT `localDayOf`
   bucketing and with the default `misrouteCountForDay`. It does NOT reconcile
   with a NON-local injected `dayOf` (e.g. a UTC `at.slice(0,10)`): the regex
   accepts that string's shape but the window would then be a local-midnight span
   offset from the UTC day the rows were bucketed under, mis-counting near
   midnight. That mismatch is not reachable on the production path (default dayOf
   is local); a caller that injects a non-local dayOf must inject a matching
   `misrouteCountForDay` too. The guard protects shape and calendar validity, NOT
   timezone agreement with an injected dayOf. */
function dayWindowLocal(dayStr) {
  if (!DAY_STEM_RE.test(String(dayStr || ''))) return null;
  const [y, m, d] = dayStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (isNaN(start.getTime())) return null;
  // Reject a date the components did not round-trip to (Date normalized it away,
  // e.g. month 13 -> next January): that is a different day than the string names.
  if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

/* #3224: the default per-day suspected-misroute count for the digest. Read-only,
   derived from the message record we already keep (no new log/persistence); the
   digest surfaces only this integer. Lazy-required so dailylog keeps its light
   top-level dependency set and so no load-order coupling to the messaging engine
   is introduced. Any failure yields null (the line is omitted), never a throw
   that would fail the whole rollup. Injectable via compileAll's
   `misrouteCountForDay` opt for deterministic tests. */
function defaultMisrouteCountForDay(dayStr) {
  const win = dayWindowLocal(dayStr);
  if (!win) return null;
  try {
    const messages = require('./messages');
    const n = messages.suspectedMisrouteCount(win.start, win.end);
    return (Number.isInteger(n) && n >= 0) ? n : null;
  } catch { return null; }
}

/* #3224: the default per-day count of posts sent with --new (confirmed new after the
   which-room question), the companion to the misroute count. Same read-only, null-on-failure
   contract. Injectable via compileAll's `confirmedNewCountForDay`. */
function defaultConfirmedNewCountForDay(dayStr) {
  const win = dayWindowLocal(dayStr);
  if (!win) return null;
  try {
    const n = require('./messages').confirmedNewPostCount(win.start, win.end);
    return (Number.isInteger(n) && n >= 0) ? n : null;
  } catch { return null; }
}

/**
 * Flatten parsed conversations into per-message rows. Pure: no IO.
 * `conversations` is an array of `{ desc, parsed }`. A message with no usable
 * `at` cannot be placed on a day, so it is dropped and counted in `undated`
 * (honest rather than silently mis-bucketed).
 */
function flattenMessages(conversations, dayOf = localDayOf) {
  const rows = [];
  let undated = 0;
  for (const { desc, parsed } of conversations) {
    if (!parsed || !Array.isArray(parsed.messages)) continue;
    const label = conversationLabel(desc);
    for (const m of parsed.messages) {
      if (!m || typeof m !== 'object' || typeof m.text !== 'string') continue;
      const day = m.at ? dayOf(m.at) : null;
      if (!day) { undated += 1; continue; }
      rows.push({
        at: m.at,
        day,
        label,
        from: (typeof m.from === 'string' && m.from.trim()) ? m.from.trim() : null,
        text: m.text,
        attachments: attachmentNames(m),
      });
    }
  }
  return { rows, undated };
}

/** Names of any attachments on a message, for a "[shared: ...]" note. */
function attachmentNames(m) {
  const seen = new Set();
  if (m.attachment && typeof m.attachment === 'object' && m.attachment.name) seen.add(String(m.attachment.name));
  if (Array.isArray(m.attachments)) {
    for (const a of m.attachments) if (a && typeof a === 'object' && a.name) seen.add(String(a.name));
  }
  return [...seen];
}

/** Group rows by day, then by conversation, each ordered by time. Pure. */
function groupByDay(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  return byDay;
}

/**
 * Render one day's rows as Markdown. Pure. Conversations are ordered by their
 * first message that day; messages within a conversation are ordered by time.
 * `timeOf` is injectable for the same timezone-determinism reason as `dayOf`.
 * `misrouteCount` (#3224, optional): when a non-negative integer, appends one
 * counts-only "suspected cross-project misroutes today" line; omitted otherwise,
 * so the existing 3-arg callers are unchanged and a null/unavailable count never
 * renders as a false zero.
 */
function renderDay(dayStr, rows, timeOf = localTimeOf, misrouteCount, confirmedNewCount) {
  const sorted = [...rows].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const order = [];
  const groups = new Map();
  for (const r of sorted) {
    if (!groups.has(r.label)) { groups.set(r.label, []); order.push(r.label); }
    groups.get(r.label).push(r);
  }
  const lines = [];
  lines.push(`# Kosmos conversations - ${dayStr}`);
  lines.push('');
  lines.push('_Compiled from the per-conversation Chats files. Originals are kept unchanged. Times are local._');
  /* #3224: a single COUNTS-ONLY operational line -- how many room posts that day
     were suspected cross-project misroutes. No identifiers, no content: just the
     number, which is what keeps it inside this already-covered digest. Omitted
     (not "0") when the count is unavailable -- an injected non-local dayOf, or a
     record that could not be read -- so a missing count never reads as a clean
     zero. A caller that passes no count at all (the existing signature) is
     unchanged. */
  if (Number.isInteger(misrouteCount) && misrouteCount >= 0) {
    lines.push('');
    lines.push(`_Suspected cross-project misroutes today: ${misrouteCount} (heuristic, see kosmos#3224)._`);
  }
  /* #3224: posts an agent confirmed as new after Kosmos asked which room it meant. They are
     left out of the misroute count above, so this line keeps them visible (how often the
     question cost an agent a rerun). Counts only; omitted when zero or unavailable. */
  if (Number.isInteger(confirmedNewCount) && confirmedNewCount > 0) {
    lines.push('');
    lines.push(`_Posts confirmed as new after Kosmos asked which room they were for: ${confirmedNewCount}._`);
  }
  lines.push('');
  for (const label of order) {
    lines.push(`## ${label}`);
    lines.push('');
    for (const r of groups.get(label)) {
      const who = r.from === null ? 'You' : r.from;
      lines.push(`**${who}** - ${timeOf(r.at)}`);
      lines.push('');
      /* The message body is rendered as a blockquote: it is quoted verbatim
         content, and quoting keeps a message whose own text starts with `#`,
         `>` or `---` from being read as document structure and hijacking the
         per-conversation headings above it. */
      for (const bodyLine of r.text.split('\n')) lines.push(bodyLine ? `> ${bodyLine}` : '>');
      if (r.attachments && r.attachments.length) {
        lines.push('>');
        lines.push(`> _[shared: ${r.attachments.join(', ')}]_`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/**
 * Read + parse every conversation file in a chats dir (`now` is injectable for
 * tests). Returns `{ conversations, readable, readErrors, rolledOver, continued,
 * rolledOverFiles, continuedFiles, unknownFiles, unknownThrough, chainFiles }`, which the caller
 * needs to decide whether writing and pruning are safe:
 *   - `chainFiles` (kosmos#5855 step 2) are the `.full` files that were read: each
 *     was followed from a thread file whose whole chain could be followed
 *     (followChain), and that conversation in `conversations` holds the chain's
 *     rows, oldest first, with each file's carried copies counted once. Also
 *     in it: a `.full` file that is a byte-for-byte copy of one of those, or
 *     of a conversation file, of the same thread (its rows were read from the
 *     other).
 *   - `rolledOver` counts the files NAMED as a rolled-over conversation's `.full` file
 *     (isRolledOverFileName) that are NOT in `chainFiles`: they were not read
 *     as part of a conversation, so their rows are not returned.
 *     A FOLDER with such a name is not counted.
 *   - `continued` counts thread files that NAME an earlier file (`continues`)
 *     whose chain was not followed whole, INCLUDING one that names it but is
 *     otherwise not a readable conversation (cut short, or its messages are not a
 *     list). It still shows when the `.full` file is not in the listing: moved
 *     away by a person, or created by a rollover that landed after the folder
 *     was listed.
 *   - `rolledOverFiles` and `continuedFiles` are the file names behind those two
 *     counts, each sorted, for the refusal to show.
 *   - `unknownFiles` (kosmos#5866) are thread files this function does not read
 *     as conversations: every `.damaged` file, and a `.superseded` or live
 *     thread file that will not parse or holds no message list. `unknownThrough` is the latest moment any of them could last have
 *     gained a message (an ISO string, never later than `now`). It is null when
 *     there are none.
 *   - `readable` is true ONLY if the directory LISTING succeeded. A failed
 *     listing (permissions, a transient error, a wrong root, the dir absent)
 *     means "could not read the source", which is NOT "the source is empty".
 *   - `readErrors` counts recognized conversation files whose bytes could not be
 *     READ (an `fs.readFileSync` throw -- EISDIR, EACCES, a transient I/O error).
 *     A file whose bytes read fine but will not parse, or hold no message
 *     list, is NOT counted here: it goes to `unknownFiles`, and one that names
 *     an earlier file goes to `continuedFiles` (a file can be in both).
 * The caller prunes only when the listing succeeded AND no read errored, so a
 * transient failure at either level can never be read as "no conversations" and
 * wipe the compiled history.
 */
function readConversations(chatsDir, now = new Date()) {
  let names;
  try { names = fs.readdirSync(chatsDir); }
  catch {
    return {
      conversations: [], readable: false, readErrors: 0, rolledOver: 0, continued: 0, rolledOverFiles: [], continuedFiles: [],
      unknownFiles: [], unknownThrough: null, chainFiles: [],
    };
  }
  const out = [];
  let readErrors = 0;
  const rolledOverFiles = [];
  const continuedFiles = [];
  const unknownFiles = [];
  let unknownThrough = null;
  // kosmos#5855 step 2: conversations whose file names an earlier one, to be followed once the folder is listed.
  const naming = [];
  // Every file whose rows are in `out`, with its thread file's name: the conversation files, then the chain files.
  const whole = [];
  // A file not read as a conversation: remember it, and the latest moment one could last have gained a message.
  // That is the earliest of: when the file was last written, when a set-aside file's name says it was set aside, and
  // now. Each is an upper bound on its own.
  const nowIso = now.toISOString();
  const unknown = (name) => {
    unknownFiles.push(name);
    let when = nowIso;
    try { const m = fs.statSync(path.join(chatsDir, name)).mtime.toISOString(); if (m < when) when = m; } catch { /* unreadable: the other bounds */ }
    const aside = setAsideAt(name);   // null for a live file's name: only a set-aside name carries one
    if (aside !== null && aside < when) when = aside;
    if (unknownThrough === null || when > unknownThrough) unknownThrough = when;
  };
  const isFolder = (name) => { try { return fs.statSync(path.join(chatsDir, name)).isDirectory(); } catch { return false; } };
  for (const name of names) {
    if (isRolledOverFileName(name)) {
      let isDir = false;
      try { isDir = fs.statSync(path.join(chatsDir, name)).isDirectory(); } catch { /* cannot tell: count it, the safe way */ }
      if (!isDir) rolledOverFiles.push(name);
      continue;
    }
    if (asideThread(name, DAMAGED_SUFFIX) !== null) {
      if (!isFolder(name)) unknown(name);
      continue;
    }
    const earlier = asideThread(name, SUPERSEDED_SUFFIX);
    if (earlier !== null) {
      if (isFolder(name)) continue;
      let asideRaw;
      try { asideRaw = fs.readFileSync(path.join(chatsDir, name), 'utf8'); }
      catch { readErrors += 1; continue; }
      let asideParsed = null;
      try { asideParsed = JSON.parse(asideRaw); } catch {
        // will not parse: if it names an earlier file it had rolled over (kosmos#5855), as a live file in this state
        if (NAMES_AN_EARLIER_FILE.test(asideRaw)) { continuedFiles.push(name); continue; }
      }
      // An earlier project's file can itself have rolled over: the same second sign as a live file's (kosmos#5855),
      // read before anything else about it, as for a live file.
      const asideNames = Boolean(asideParsed && typeof asideParsed.continues === 'string' && asideParsed.continues);
      if (!asideParsed || !Array.isArray(asideParsed.messages)) {
        if (asideNames) continuedFiles.push(name);
        unknown(name);
        continue;
      }
      if (asideNames) naming.push({ name, base: threadFileName(earlier), key: earlier.key, at: out.length });
      // What tells this earlier project from another of the same name: when it began, else the file's own stamp.
      const born = typeof asideParsed.projectBornAt === 'string' && asideParsed.projectBornAt
        ? `begun ${shownName(asideParsed.projectBornAt)}` : `set aside as ${shownName(name)}`;
      whole.push({ base: threadFileName(earlier), name });
      out.push({ desc: { ...earlier, earlier: born }, parsed: asideParsed });
      continue;
    }
    const desc = parseChatFileName(name);
    if (!desc) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(chatsDir, name), 'utf8'); }
    catch { readErrors += 1; continue; }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      // Will not parse. If it names an earlier file it is a rolled-over conversation (kosmos#5855). Otherwise it is a
      // damaged thread file chat.js has not set aside yet (it does so at the next message): the same unknown rows as
      // a `.damaged` file, held from now and not only from then (kosmos#5866).
      if (NAMES_AN_EARLIER_FILE.test(raw)) continuedFiles.push(name); else unknown(name);
      continue;
    }
    const namesEarlier = Boolean(parsed && typeof parsed.continues === 'string' && parsed.continues);
    // A thread file with no message list is one chat.js would set aside as damaged at the next message: unknown too.
    if (!parsed || !Array.isArray(parsed.messages)) {
      if (namesEarlier) continuedFiles.push(name);
      unknown(name);
      continue;
    }
    if (namesEarlier) naming.push({ name, base: name, key: desc.key, at: out.length });
    whole.push({ base: name, name });
    out.push({ desc, parsed });
  }
  /* kosmos#5855 step 2: follow each of those to its `.full` files. A conversation is compiled whole when its chain is
     complete, every file in it is one this listing saw, and no other conversation's chain holds the same file (the
     writer never makes that; read twice, its rows would be in a day twice). Then its rows are the chain's, merged as
     engine/chat.js merges them (chainRows: a file's carried rows are served from the newer copy), and its `.full`
     files leave `rolledOverFiles`. Otherwise the file stays in `continuedFiles`, which refuses the run.
     A `.damaged` file of the same thread changes none of this: its rows are unknown as any `.damaged` file's are
     (kosmos#5866), so the prune is limited and a day it shares with readable rows is written without them. */
  const listed = new Set(rolledOverFiles);
  // Lazy-required, and only when a chain is merged, so dailylog keeps its light top-level dependency set.
  let chainRows = null;
  const chains = naming.map((c) => ({ ...c, chain: followChain(chatsDir, c.base, c.key, out[c.at].parsed) }));
  const holders = new Map();
  for (const c of chains) for (const a of c.chain.earlier) holders.set(a.name, (holders.get(a.name) || 0) + 1);
  const chainFiles = [];
  for (const c of chains) {
    if (!c.chain.complete || !c.chain.earlier.every((a) => listed.has(a.name) && holders.get(a.name) === 1)) {
      continuedFiles.push(c.name);
      continue;
    }
    const cur = out[c.at].parsed;
    // how many of the current file's leading rows copy the end of the file before it: within readThread's bounds, else 0
    const carried = Number.isInteger(cur.carried) && cur.carried >= 0 && cur.carried <= cur.messages.length ? cur.carried : 0;
    if (chainRows === null) chainRows = require('./chat').chainRows;
    const messages = chainRows(c.chain.earlier, cur.messages, carried);
    out[c.at] = { desc: out[c.at].desc, parsed: { ...cur, messages } };
    for (const a of c.chain.earlier) { chainFiles.push(a.name); whole.push({ base: c.base, name: a.name }); }
  }
  /* A `.full` file no chain reached that is, byte for byte, a file of the same thread whose rows are in `out` (a
     chain file, or a conversation file) holds no row that was not read. The writer leaves one when a rollover is
     interrupted between setting the full file aside (a hard link) and writing the fresh file: the first name stays
     when the next message rolls the same full file over again under a new name, or when a later project of the same
     name sets the thread file aside. Counted as read, so that such an interruption does not refuse every later run.
     (A conversation file whose own chain was not followed whole refuses the run whatever is counted here.) */
  const bytes = (n) => { try { return fs.readFileSync(path.join(chatsDir, n)); } catch { return null; } };
  for (const name of rolledOverFiles) {
    if (chainFiles.includes(name)) continue;
    const own = whole.filter((f) => name.startsWith(f.base + '.'));
    if (!own.length) continue;
    const mine = bytes(name);
    if (mine === null) continue;
    if (own.some((f) => { const theirs = bytes(f.name); return theirs !== null && mine.equals(theirs); })) chainFiles.push(name);
  }
  const read = new Set(chainFiles);
  for (let i = rolledOverFiles.length - 1; i >= 0; i -= 1) if (read.has(rolledOverFiles[i])) rolledOverFiles.splice(i, 1);
  chainFiles.sort();
  rolledOverFiles.sort();
  continuedFiles.sort();
  unknownFiles.sort();
  return {
    conversations: out, readable: true, readErrors,
    rolledOver: rolledOverFiles.length, continued: continuedFiles.length, rolledOverFiles, continuedFiles,
    unknownFiles, unknownThrough, chainFiles,
  };
}

/**
 * Compile the daily logs. Reads `chatsDir`, writes one `<day>.md` per day into
 * `outDir` (created if absent). Returns a summary. A run can be REFUSED
 * (kosmos#5855): then `refused` says why, `rolledOver`, `continued` and the two
 * `...Files` lists say what was seen, and nothing was written or pruned.
 * `held` (kosmos#5866) lists the days whose daily file this run would have pruned
 * and did not, because a thread file that is not read as a conversation
 * (`unknownFiles`) may be where its messages were. `now` is injectable. `onlyDay` restricts the write
 * to a single day (a targeted run); by default every day found is written.
 * `dayOf`/`timeOf`/`misrouteCountForDay` are injectable for deterministic tests
 * (`misrouteCountForDay(dayStr)` -> the per-day #3224 count, default derives the
 * local day window and reads the message record). `prune` (default
 * true) enables removing stale day files from `outDir`; the CLI turns it OFF for
 * an operator-supplied `--out` dir, so pruning a day-named file the operator
 * happens to keep in an arbitrary directory is never a surprise -- only the
 * tool's own managed rollup dir is pruned.
 */
function compileAll(opts = {}) {
  const chatsDir = opts.chatsDir || path.join(store.ROOT, 'chats');
  const outDir = opts.outDir || path.join(store.ROOT, CHATS_DAILY_DIRNAME);
  const dayOf = opts.dayOf || localDayOf;
  const timeOf = opts.timeOf || localTimeOf;
  const onlyDay = opts.onlyDay || null;
  const prune = opts.prune !== false;
  /* #3224: injectable for deterministic tests, same pattern as dayOf/timeOf.
     Default derives a read-only count from the already-kept message record. */
  const misrouteCountForDay = opts.misrouteCountForDay || defaultMisrouteCountForDay;
  const confirmedNewCountForDay = opts.confirmedNewCountForDay || defaultConfirmedNewCountForDay;

  const {
    conversations, readable, readErrors, rolledOver, continued, rolledOverFiles, continuedFiles, unknownFiles, unknownThrough,
    chainFiles,
  } = readConversations(chatsDir, opts.now || new Date());

  /* 🛑 kosmos#5855 FAIL CLOSED: a `.full` file no thread file led to (`rolledOver`), or a thread file whose earlier
     files could not all be followed (`continued`), means rows this run did not read. Without them it would REWRITE a
     day that straddles a rollover with only the rows the fresh file carried, and PRUNE every day whose rows are only
     in a `.full` file. So on either the run writes nothing and prunes nothing, and says why (`refused`), an
     `onlyDay` run too: that day may be the straddling one. `messages` and `undated` are 0 here because nothing was
     flattened, not because there are none. A chain that was followed whole (`chainFiles`) is in `conversations`
     and refuses nothing. */
  if (rolledOver > 0 || continued > 0) {
    return {
      conversations: conversations.length, messages: 0, days: 0, written: [], pruned: [], undated: 0,
      readable, readErrors, rolledOver, continued, rolledOverFiles, continuedFiles, unknownFiles, chainFiles, held: [],
      refused: REFUSED_ROLLED_OVER, chatsDir, outDir,
    };
  }

  const { rows, undated } = flattenMessages(conversations, dayOf);
  const byDay = groupByDay(rows);

  /* kosmos#5866 HELD DAYS: a thread file that is not read as a conversation (`unknownFiles`) may be the only place
     some days' messages ever were. Those days have no readable rows, so nothing below rewrites them: the only thing
     that would remove their daily file is the prune. None of that file's messages should be later than `unknownThrough`
     (taken from file times and names; the file itself is not read),
     so a daily file for that day or any EARLIER day is held: not pruned. Nothing else changes: every day that has
     readable rows is rewritten exactly as before, so no day is ever less current than it was without this.
     What it does not do: a day that has BOTH readable rows and that file's rows is rewritten without the latter,
     as before this change.
     If the day of that moment cannot be worked out (an injected `dayOf` that returns nothing for it), every daily
     file is held from the prune: not knowing where the line is, is not a reason to drop it. */
  const heldThrough = unknownThrough ? (dayOf(unknownThrough) || null) : null;
  const holdEvery = unknownFiles.length > 0 && heldThrough === null;
  const isHeld = (day) => holdEvery || (heldThrough !== null && day <= heldThrough);
  const held = [];

  const written = [];
  if (byDay.size) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* surfaced by the write below */ }
  }
  for (const [day, dayRows] of byDay) {
    if (onlyDay && day !== onlyDay) continue;
    const md = renderDay(day, dayRows, timeOf, misrouteCountForDay(day), confirmedNewCountForDay(day));
    fs.writeFileSync(path.join(outDir, dayFileName(day)), md);
    written.push(day);
  }
  written.sort();

  /* Prune stale day files so the rollup stays current when messages are edited
     or deleted at the source: a day whose messages are all gone leaves a `.md`
     that nothing above rewrites. Only on a FULL run (an `onlyDay` run is
     targeted and must not touch other days), and only files whose name is a
     compiled day rollup (`YYYY-MM-DD.md`) -- never anything else a person may
     have put in the dir. Not a substitute for forget.js clearing the whole dir
     (this runs only when the compiler is invoked); the two are complementary.

     🛑 FAIL CLOSED: prune ONLY when the source listing SUCCEEDED (`readable`)
     AND no recognized conversation file failed to read (`readErrors === 0`). If
     chats/ could not be listed, OR a conversation file's bytes could not be read
     this run, `byDay` is empty (or short) for a reason that is NOT "there are no
     conversations", and pruning on that would delete the compiled history for a
     transient failure. A successful, fully-read listing that is genuinely empty
     still prunes, which is correct: chats/ is there and has nothing, so every
     daily file is stale. (A file that read fine but is not valid JSON is not a
     read failure: it does not stop the prune here. It holds the days up to the one it could last have gained a message on,
     which the loop below skips -- kosmos#5866, see HELD DAYS above.) */
  const pruned = [];
  if (prune && !onlyDay && readable && readErrors === 0) {
    const keep = new Set(written);
    let existing = [];
    try { existing = fs.readdirSync(outDir); } catch { existing = []; }
    for (const name of existing) {
      const day = dayFromFileName(name);
      if (!day) continue;
      if (keep.has(day)) continue;
      // kosmos#5866: a held day's daily file may hold rows this run could not read; it is kept.
      if (isHeld(day)) { held.push(day); continue; }
      try { fs.rmSync(path.join(outDir, name)); pruned.push(day); } catch { /* leave it rather than fail the run */ }
    }
    pruned.sort();
  }
  held.sort();

  return {
    conversations: conversations.length,
    messages: rows.length,
    days: written.length,
    written,
    pruned,
    undated,
    readable,
    readErrors,
    rolledOver,
    continued,
    rolledOverFiles,
    continuedFiles,
    unknownFiles,
    chainFiles,
    held,
    refused: null,
    chatsDir,
    outDir,
  };
}

module.exports = {
  CHATS_DAILY_DIRNAME,
  dayFileName,
  dayFromFileName,
  parseChatFileName,
  isRolledOverFileName,
  followChain,
  conversationLabel,
  localDayOf,
  localTimeOf,
  dayWindowLocal,
  defaultMisrouteCountForDay,
  flattenMessages,
  groupByDay,
  renderDay,
  readConversations,
  shownName,
  setAsideAt,
  compileAll,
};

/* CLI: `node engine/dailylog.js [--all | --day YYYY-MM-DD] [--out <dir>]`.
   Default is --all (write every day found), which is what a once-a-day
   scheduled run wants; --day targets one day. */
if (require.main === module) {
  const USAGE = 'usage: node engine/dailylog.js [--all | --day YYYY-MM-DD] [--out <dir>]\n'
    + '  the default run prunes stale day files in the rollup dir; --out disables pruning\n'
    + '  a daily file with no readable messages left is kept when a conversation file that cannot be read as one may hold them\n'
    + `  exits ${EXIT_REFUSED}, having written and removed nothing, while the chats folder holds a file ending .full\n`
    + '  that was not read as part of a conversation, or a conversation file whose earlier files cannot all be followed\n';
  const die = (msg) => { process.stderr.write(`dailylog: ${msg}\n` + USAGE); process.exit(2); };
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--day' || argv[i] === '--out') {
      const val = argv[i + 1];
      // Fail loud on a missing value: `--day` with nothing after it must NOT
      // silently fall back to a full compile (the point of failing on typos).
      if (val === undefined || val.startsWith('--')) die(`${argv[i]} requires a value`);
      if (argv[i] === '--day') {
        // Fail loud on a malformed day rather than silently compiling zero files:
        // an unpadded `2026-9-3` matches no dayOf output and would write nothing.
        if (!DAY_STEM_RE.test(val)) die(`--day expects YYYY-MM-DD, got '${val}'`);
        opts.onlyDay = val;
      } else {
        opts.outDir = val;
        // An operator-supplied dir is not the tool's managed rollup dir, so do
        // NOT prune day-named files there -- deleting a file the operator kept
        // in their own directory would be a surprise.
        opts.prune = false;
      }
      i += 1;
    } else if (argv[i] === '--all') { /* the default; accepted explicitly */ }
    // Fail loud on an unrecognized flag rather than silently running a full
    // compile: a typo like `--dya 2026-09-13` should not quietly ignore the day.
    else die(`unrecognized argument '${argv[i]}'`);
  }
  const summary = compileAll(opts);
  if (summary.refused) {
    // kosmos#5855: say it on stderr, print no success line, and exit non-zero, so a scheduled run cannot read as
    // "compiled, nothing new".
    const list = (names) => names.slice(0, REFUSAL_NAMES_SHOWN).map((n) => `  ${shownName(n)}\n`).join('')
      + (names.length > REFUSAL_NAMES_SHOWN ? `  and ${names.length - REFUSAL_NAMES_SHOWN} more\n` : '');
    const earlier = summary.rolledOverFiles;
    const pointing = summary.continuedFiles;
    // What happened, where, which files, then three sentences that hold whatever the files are (an interrupted
    // rollover, a stray copy, a file that will not parse): what this tool does on finding them; what it needs before it
    // reads a conversation that reached its limit; and not to remove one on this message's say-so. The tool cannot tell
    // which case it is, so nothing here asserts one.
    process.stderr.write('dailylog: not compiled. Nothing was written or removed.\n'
      + `Found in ${shownName(summary.chatsDir)}:\n`
      + (earlier.length
        ? 'Files whose names end in .full after a conversation file\'s name, which this tool did not read as part of a conversation:\n' + list(earlier)
        : '')
      + (pointing.length
        ? 'Conversation files that refer to an earlier file this tool could not follow all the way back:\n' + list(pointing)
        : '')
      + 'This tool does not compile while a file listed here is present, and it changes none of them. It compiles a '
      + 'conversation that reached its message limit only when it can follow every earlier file from the '
      + 'conversation\'s own file. They can be Kosmos\'s own files, so do not move or delete one unless you know '
      + 'that it is not Kosmos\'s.\n');
    // exitCode, not exit(): the process ends once stderr has drained, so a piped reader gets the whole message.
    process.exitCode = EXIT_REFUSED;
  } else {
    process.stdout.write(
      `dailylog: ${summary.messages} messages across ${summary.conversations} conversations `
      + `-> ${summary.days} daily file(s) in ${summary.outDir}`
      + (summary.undated ? ` (${summary.undated} undated message(s) skipped)` : '')
      + (summary.pruned && summary.pruned.length ? ` (${summary.pruned.length} stale day file(s) pruned)` : '')
      + '\n',
    );
    if (summary.written.length) process.stdout.write(`dailylog: wrote ${summary.written.join(', ')}\n`);
    // kosmos#5866: what was kept from the prune, and the fact it rests on. No advice: the tool cannot tell why a file is so.
    if (summary.held.length) {
      const n = summary.unknownFiles.length;
      process.stdout.write(`dailylog: kept ${summary.held.length} daily file(s) with no readable messages left `
        + `(${summary.held.length > 1 ? 'between ' + summary.held[0] + ' and ' + summary.held[summary.held.length - 1] : summary.held[0]}), because `
        + `${n} file(s) in the chats folder could not be read as conversations and may hold messages from those days\n`);
    }
  }
}
