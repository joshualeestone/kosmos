/**
 * kosmos#5686: where an agent's own sessions live, per provider, as snapshot roots.
 *
 * An agent's full conversation is its provider's session record, and none of it is under the agent's folder or the
 * world's folder (measured on #5686, comment 6082225636). Each provider files it differently:
 *   Claude Code  <config root>/projects/<agent folder, every non-alphanumeric as '-'>/... . The flattening is many-to-one
 *                (`workers/a-b`, `workers/a.b`, a subfolder `workers/a/b` share one folder), so the folder is a root with
 *                an `only` list: the transcripts whose recorded working folder is this agent's (engine/status.js
 *                transcriptCwd, compared as status.js's workdirBelongs does), each with everything under its
 *                <session>/ folder (subagent transcripts, tool results), and memory/ when the folder is this agent's
 *                alone (see claudeOwned). Both spellings of the folder are tried, as status.js does.
 *   Gemini       <gemini home>/tmp/<slug>/chats, the slug looked up for the agent folder in <gemini home>/projects.json
 *                (engine/geminisession.js forWorkdir's rule), with `only` its session-*.jsonl files, as forWorkdir reads.
 *   Codex        <codex home>/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl, ONE date tree for every agent: the sessions
 *                folder is a root with an `only` list, the rollouts whose first line names this agent's folder
 *                (engine/codexsession.js metaOf).
 * With `only`, nothing else in the folder is stored or named (engine/backupsnapshot.js listRoots).
 *
 * Never a provider's whole folder as such: sign-ins (.credentials.json, oauth_creds.json, auth.json) sit beside the
 * sessions. No part below the provider's folder may be a link (to ~, to another agent's folder, to all of projects/);
 * the provider's folder itself may be. The folder's real path is returned, so the snapshot walks what was checked.
 * A transcript Claude Code wrote under a shortened name (a very long folder) is not found, as status.js does not find it.
 *
 * sessionsFor(agentDir, { id, claudeRoots, geminiHome, codexHome, grokHome?, moreHomes? }) -> [{ name, path, optional: true, only? }]
 *   moreHomes [{ provider: 'codex'|'gemini'|'grok', home, tag }]: further homes of this agent's sessions (kosmos#5883), each
 *          named sessions/<id>/<provider><tag>, tag a hyphen and 1 to 16 lowercase letters or digits, one per FOLDER.
 *   (or { name, refused, optional: true } where a session folder is a link: the snapshot records it as skipped)
 *   id     the agent's stored name, one plain segment of lowercase letters, digits and hyphens (any other id gives
 *          nothing: the caller derives it); every name built from it must pass the snapshot's rootNameProblem, or nothing is
 *          returned (an id such as `aux` or `secrets` would otherwise fail the whole world's snapshot)
 *   names  `sessions/<id>/claude` (the first config root, the folder as on disk), `-raw` (as given), `-<n>` (the n-th
 *          config root); `sessions/<id>/gemini`; `sessions/<id>/codex`
 *          The `-<n>` comes from the position in claudeRoots, so the caller must pass them in a FIXED order (status.js
 *          configRoots' readdir order is not one): sort them by folder name, or names change between snapshots.
 * Reads folder listings, projects.json and the head of each session file. Never throws: a provider it cannot read
 * contributes nothing.
 */
const fs = require('fs');
const path = require('path');
const trust = require('./trust');
const codexsession = require('./codexsession');
const { transcriptCwd } = require('./status');
const { rootNameProblem } = require('./backupsnapshot');

const ID_SEGMENT = /^[a-z0-9][a-z0-9-]{0,31}$/;
const flatten = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');   // engine/status.js's rule for a Claude project folder
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const idOf = (p) => { try { const st = fs.statSync(p, { bigint: true }); return `${st.dev}:${st.ino}`; } catch { return null; } };

/* { real } for `<base>/<rest...>` with no link below base; { link: true } when a part below base exists and is a link
   (refused, and said so); {} when it is not there. */
function folderCheck(base, ...rest) {
  try {
    let at = fs.realpathSync(base);
    for (const part of rest) {
      at = path.join(at, part);
      let st;
      try { st = fs.lstatSync(at); } catch { return {}; }
      if (st.isSymbolicLink()) return { link: true };
    }
    return isDir(at) ? { real: at } : {};
  } catch { return {}; }
}

// Every regular file (no links) under dir whose name passes keep, as '/'-separated paths relative to dir. Bounded.
function filesUnder(dir, keep, maxDepth = 6) {
  const out = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth < maxDepth) walk(r, depth + 1);
      else if (e.isFile() && keep(e.name)) out.push(r);
    }
  };
  walk('', 0);
  return out.sort();
}

// A recorded working folder is this agent's: as recorded, or the same folder on disk (status.js workdirBelongs).
function belongsTo(agentDir) {
  const canon = trust.canonicalOnDisk(path.resolve(agentDir));
  return (cwd) => typeof cwd === 'string' && !!cwd && (cwd === agentDir || cwd === canon || trust.canonicalOnDisk(cwd) === canon);
}

function claudeRoots(agentDir, claudeRootsIn, id, belongs) {
  const canon = trust.canonicalOnDisk(agentDir);
  const spellings = [['', flatten(canon)]];
  if (flatten(agentDir) !== flatten(canon)) spellings.push(['-raw', flatten(agentDir)]);
  const out = [], seen = new Set();
  (Array.isArray(claudeRootsIn) ? claudeRootsIn : []).forEach((root, i) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) return;
    for (const [tag, flat] of spellings) {
      // The name comes from WHICH root and WHICH spelling, never from how many were found.
      const name = `sessions/${id}/claude${i ? `-${i + 1}` : ''}${tag}`;
      const c = folderCheck(root, 'projects', flat);
      // A link where the board would read sessions (status.js follows it): refused, and said so in the snapshot.
      if (c.link) { if (!out.some((x) => x.name === name)) out.push({ name, refused: 'a session folder that is a link (not followed)', optional: true }); continue; }
      const real = c.real;
      const fid = real ? idOf(real) : null;
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      const only = claudeOwned(real, belongs);
      if (only.length) out.push({ name, path: real, optional: true, only });
    }
  });
  return out;
}

/* What in one Claude project folder is this agent's. A session is its <session>.jsonl at the top, owned when its
   recorded working folder is the agent's (status.js reads ownership the same way); EVERYTHING under <session>/ (its
   subagent transcripts, whatever their own working folder, a worktree for instance; its tool-results/) goes with it.
   memory/ (Claude Code's per-project memory) belongs to the folder, not a session: kept only when every session in the
   folder is this agent's (one that does not say whose it is counts against), because the flattening can give two
   folders one projects folder. Files more than six folders below a session are not taken (filesUnder's depth). */
function claudeOwned(real, belongs) {
  let top;
  try { top = fs.readdirSync(real, { withFileTypes: true }); } catch { return []; }
  const only = [];
  let foreign = false, mine = false;
  for (const e of top) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const cwd = transcriptCwd(path.join(real, e.name));
    if (belongs(cwd)) {
      mine = true;
      only.push(e.name);
      const session = e.name.slice(0, -'.jsonl'.length);
      if (top.some((d) => d.isDirectory() && d.name === session)) for (const rel of filesUnder(path.join(real, session), () => true)) only.push(`${session}/${rel}`);
    } else foreign = true;   // another folder's, or one that does not say: either way memory/ may not be this agent's
  }
  if (mine && !foreign && top.some((d) => d.isDirectory() && d.name === 'memory')) for (const rel of filesUnder(path.join(real, 'memory'), () => true)) only.push(`memory/${rel}`);
  return only.sort();
}

function geminiRoot(agentDir, geminiHome, id, tag = '') {
  if (typeof geminiHome !== 'string' || !path.isAbsolute(geminiHome)) return null;
  let map;
  try { map = JSON.parse(fs.readFileSync(path.join(geminiHome, 'projects.json'), 'utf8')).projects; } catch { return null; }
  if (!map || typeof map !== 'object') return null;
  const want = trust.canonicalOnDisk(path.resolve(agentDir));
  for (const [cwd, slug] of Object.entries(map)) {
    if (trust.canonicalOnDisk(cwd) !== want) continue;
    // The slug becomes a folder name under tmp/: one plain segment only, never a path out of it.
    if (typeof slug !== 'string' || !slug || slug === '.' || slug === '..' || /[\\/\0]/.test(slug)) return null;
    const c = folderCheck(geminiHome, 'tmp', slug, 'chats');
    if (c.link) return { name: `sessions/${id}/gemini${tag}`, refused: 'a session folder that is a link (not followed)', optional: true };
    const real = c.real;
    if (!real) return null;
    // The session files forWorkdir reads, named. Two agent folders mapped to one slug would both name them: the snapshot
    // then leaves both out and records why, since it cannot tell whose they are.
    const only = filesUnder(real, (n) => /^session-.*\.jsonl$/.test(n), 0);
    return only.length ? { name: `sessions/${id}/gemini${tag}`, path: real, optional: true, only } : null;
  }
  return null;
}

function codexRoot(agentDir, codexHome, id, belongs, tag = '') {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) return null;
  const c = folderCheck(codexHome, 'sessions');
  if (c.link) return { name: `sessions/${id}/codex${tag}`, refused: 'a session folder that is a link (not followed)', optional: true };
  const real = c.real;
  if (!real) return null;
  const only = filesUnder(real, (n) => /^rollout-.*\.jsonl$/.test(n), 3).filter((rel) => {
    const meta = codexsession.metaOf(path.join(real, rel));
    return !!meta && belongs(meta.cwd);
  });
  return only.length ? { name: `sessions/${id}/codex${tag}`, path: real, optional: true, only } : null;
}

/* kosmos#5883 slice 2: Grok keeps each conversation in <grok home>/sessions/<encoded cwd>/<session id>/. The folder
   name is NOT matched (review 1): Grok encodes it with Rust's urlencoding (not encodeURIComponent: ! ' ( ) * differ)
   and slugs plus hashes a name past the folder-name byte cap. Matched instead, as the board's reader does
   (engine/groksession.js forWorkdir), on each session's summary.json info.cwd, canonicalized on both sides, by that
   reader's own summaries() and summaryOf(). So every spelling the agent was launched under is found, in one root over
   the sessions folder whose `only` lists each matched session's files.
   Only the conversation record is named: chat_history, events and updates (.jsonl) and summary.json; NOT
   system_prompt.txt or prompt_context.json (instructions and context), never the locks, never a link. Sessions of a
   Grok WORKTREE (a different launch folder) are not this agent's by cwd and are not taken (#5883). */
const GROK_KEEP = ['chat_history.jsonl', 'events.jsonl', 'updates.jsonl', 'summary.json'];
function grokRoot(agentDir, grokHome, id, tag = '') {
  if (typeof grokHome !== 'string' || !path.isAbsolute(grokHome)) return null;
  const c = folderCheck(grokHome, 'sessions');
  if (c.link) return { name: `sessions/${id}/grok${tag}`, refused: 'a session folder that is a link (not followed)', optional: true };
  if (!c.real) return null;
  const gs = require('./groksession');
  const want = trust.canonicalOnDisk(path.resolve(agentDir));
  const only = [];
  for (const file of gs.summaries(grokHome)) {
    const sm = gs.summaryOf(file);
    const cwd = sm && sm.info && typeof sm.info.cwd === 'string' ? sm.info.cwd : null;
    if (!cwd || trust.canonicalOnDisk(cwd) !== want) continue;
    const sessionDir = path.dirname(file);
    let rel;
    try { rel = path.relative(c.real, fs.realpathSync(sessionDir)); } catch { continue; }   // gone meanwhile
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length !== 2) continue;
    for (const f of GROK_KEEP) {
      let st;
      try { st = fs.lstatSync(path.join(sessionDir, f)); } catch { continue; }
      if (st.isFile()) only.push(rel.split(path.sep).concat(f).join('/'));
    }
  }
  return only.length ? { name: `sessions/${id}/grok${tag}`, path: c.real, optional: true, only: only.sort() } : null;
}

function sessionsFor(agentDir, opts) {
  const o = opts || {};
  // One plain segment: an id holding '/' would nest its names under another agent's (`x/claude` under `x`).
  if (typeof agentDir !== 'string' || !path.isAbsolute(agentDir) || typeof o.id !== 'string' || !ID_SEGMENT.test(o.id)) return [];
  const belongs = belongsTo(agentDir);
  const roots = claudeRoots(agentDir, o.claudeRoots, o.id, belongs);
  const g = geminiRoot(agentDir, o.geminiHome, o.id);
  if (g) roots.push(g);
  const c = codexRoot(agentDir, o.codexHome, o.id, belongs);
  if (c) roots.push(c);
  const k = grokRoot(agentDir, o.grokHome, o.id);
  if (k) roots.push(k);
  // kosmos#5883: more homes the same agent's sessions can be in (a Codex runtime home, a named account's), each under a
  // tag the CALLER derives from the folder itself, so one folder keeps one name across snapshots whatever the agent's
  // account is now. A home that resolves to one already read is skipped (one folder, one root per agent).
  const seenReal = new Set(roots.filter((r) => r.path).map((r) => r.path));
  for (const x of Array.isArray(o.moreHomes) ? o.moreHomes : []) {
    if (!x || typeof x.tag !== 'string' || !/^-[a-z0-9]{1,16}$/.test(x.tag)) continue;
    const r = x.provider === 'codex' ? codexRoot(agentDir, x.home, o.id, belongs, x.tag)
      : x.provider === 'gemini' ? geminiRoot(agentDir, x.home, o.id, x.tag)
      : x.provider === 'grok' ? grokRoot(agentDir, x.home, o.id, x.tag) : null;
    if (r && (!r.path || !seenReal.has(r.path))) { roots.push(r); if (r.path) seenReal.add(r.path); }
  }
  // Every name actually built must be one the snapshot accepts; if any is not, none is returned (a refused name would
  // fail the whole world's snapshot).
  return roots.some((r) => rootNameProblem(r.name)) ? [] : roots;
}

module.exports = { sessionsFor, flatten };
