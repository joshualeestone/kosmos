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
  if (desc.kind === 'direct') return `Direct: ${desc.key}`;
  return `${desc.projectId} : ${desc.key}`;
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
 */
function renderDay(dayStr, rows, timeOf = localTimeOf) {
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
 * Read + parse every conversation file in a chats dir. Skips individual
 * unreadable/unparseable files. Returns `{ conversations, readable }`:
 * `readable` is true ONLY if the directory listing itself succeeded. A failed
 * listing (permissions, a transient I/O error, a momentarily-wrong root, or the
 * dir being absent) yields `readable: false` so the caller can fail closed and
 * NOT treat "could not read the source" as "the source is empty" -- the
 * distinction that keeps a transient failure from pruning the compiled history.
 */
function readConversations(chatsDir) {
  let names;
  try { names = fs.readdirSync(chatsDir); }
  catch { return { conversations: [], readable: false }; }
  const out = [];
  for (const name of names) {
    const desc = parseChatFileName(name);
    if (!desc) continue;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(chatsDir, name), 'utf8')); }
    catch { continue; }
    if (!parsed || !Array.isArray(parsed.messages)) continue;
    out.push({ desc, parsed });
  }
  return { conversations: out, readable: true };
}

/**
 * Compile the daily logs. Reads `chatsDir`, writes one `<day>.md` per day into
 * `outDir` (created if absent). Returns a summary. `onlyDay` restricts the write
 * to a single day (a targeted run); by default every day found is written.
 * `dayOf`/`timeOf` are injectable for deterministic tests.
 */
function compileAll(opts = {}) {
  const chatsDir = opts.chatsDir || path.join(store.ROOT, 'chats');
  const outDir = opts.outDir || path.join(store.ROOT, CHATS_DAILY_DIRNAME);
  const dayOf = opts.dayOf || localDayOf;
  const timeOf = opts.timeOf || localTimeOf;
  const onlyDay = opts.onlyDay || null;

  const { conversations, readable } = readConversations(chatsDir);
  const { rows, undated } = flattenMessages(conversations, dayOf);
  const byDay = groupByDay(rows);

  const written = [];
  if (byDay.size) {
    try { fs.mkdirSync(outDir, { recursive: true }); } catch { /* surfaced by the write below */ }
  }
  for (const [day, dayRows] of byDay) {
    if (onlyDay && day !== onlyDay) continue;
    const md = renderDay(day, dayRows, timeOf);
    fs.writeFileSync(path.join(outDir, `${day}.md`), md);
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

     🛑 FAIL CLOSED: prune ONLY when the source listing SUCCEEDED (`readable`).
     If chats/ could not be read (permissions, a transient error, a wrong root),
     `byDay` is empty for a reason that is NOT "there are no conversations", and
     pruning on that would delete the entire compiled history for a transient
     failure. A successful listing that is genuinely empty still prunes, which is
     correct: chats/ is there and has nothing, so every daily file is stale. */
  const pruned = [];
  if (!onlyDay && readable) {
    const keep = new Set(written);
    let existing = [];
    try { existing = fs.readdirSync(outDir); } catch { existing = []; }
    for (const name of existing) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue;
      const day = name.slice(0, 10);
      if (keep.has(day)) continue;
      try { fs.rmSync(path.join(outDir, name)); pruned.push(day); } catch { /* leave it rather than fail the run */ }
    }
    pruned.sort();
  }

  return {
    conversations: conversations.length,
    messages: rows.length,
    days: written.length,
    written,
    pruned,
    undated,
    readable,
    outDir,
  };
}

module.exports = {
  CHATS_DAILY_DIRNAME,
  parseChatFileName,
  conversationLabel,
  localDayOf,
  localTimeOf,
  flattenMessages,
  groupByDay,
  renderDay,
  readConversations,
  compileAll,
};

/* CLI: `node engine/dailylog.js [--all | --day YYYY-MM-DD] [--out <dir>]`.
   Default is --all (write every day found), which is what a once-a-day
   scheduled run wants; --day targets one day. */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--day') { opts.onlyDay = argv[i + 1]; i += 1; }
    else if (argv[i] === '--out') { opts.outDir = argv[i + 1]; i += 1; }
    else if (argv[i] === '--all') { /* default */ }
  }
  const summary = compileAll(opts);
  process.stdout.write(
    `dailylog: ${summary.messages} messages across ${summary.conversations} conversations `
    + `-> ${summary.days} daily file(s) in ${summary.outDir}`
    + (summary.undated ? ` (${summary.undated} undated message(s) skipped)` : '')
    + (summary.pruned && summary.pruned.length ? ` (${summary.pruned.length} stale day file(s) pruned)` : '')
    + '\n',
  );
  if (summary.written.length) process.stdout.write(`dailylog: wrote ${summary.written.join(', ')}\n`);
}
