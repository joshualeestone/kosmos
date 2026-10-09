/**
 * kosmos#5686: where an agent's own sessions live, per provider, as snapshot roots.
 *
 * An agent's full conversation is its provider's session record, and none of it is under the agent's folder or the
 * world's folder (measured on #5686, comment 6082225636). Each provider files it differently:
 *   Claude Code  <config root>/projects/<agent folder, every non-alphanumeric as '-'>/... . The flattening is many-to-one
 *                (`workers/a-b`, `workers/a.b`, a subfolder `workers/a/b` share one folder), so the folder is a root with
 *                an `only` list: the transcripts whose recorded working folder is this agent's (engine/status.js
 *                transcriptCwd, compared as status.js's workdirBelongs does). Both spellings of the folder are tried, as
 *                status.js does. Deliberately wider than status.js, which reads the top level only: a session's
 *                subagent transcripts (<session>/subagents/agent-*.jsonl) are the agent's conversation too.
 *   Gemini       <gemini home>/tmp/<slug>/chats, the slug looked up for the agent folder in <gemini home>/projects.json
 *                (engine/geminisession.js forWorkdir's rule). One slug per folder, so the whole chats folder is a root.
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
 * sessionsFor(agentDir, { id, claudeRoots, geminiHome, codexHome }) -> [{ name, path, optional: true, only? }]
 *   id     the agent's stored name; every name built from it must pass the snapshot's rootNameProblem, or nothing is
 *          returned (an id such as `aux` or `secrets` would otherwise fail the whole world's snapshot)
 *   names  `sessions/<id>/claude` (the first config root, the folder as on disk), `-raw` (as given), `-<n>` (the n-th
 *          config root); `sessions/<id>/gemini`; `sessions/<id>/codex`
 * Reads folder listings, projects.json and the head of each session file. Never throws: a provider it cannot read
 * contributes nothing.
 */
const fs = require('fs');
const path = require('path');
const trust = require('./trust');
const codexsession = require('./codexsession');
const { transcriptCwd } = require('./status');
const { rootNameProblem } = require('./backupsnapshot');

const flatten = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');   // engine/status.js's rule for a Claude project folder
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const idOf = (p) => { try { const st = fs.statSync(p, { bigint: true }); return `${st.dev}:${st.ino}`; } catch { return null; } };

// The real path of `<base>/<rest...>`, only if no part below base is a link and it is a folder; base itself may be a
// link (a config folder kept elsewhere). Else null.
function exactFolder(base, ...rest) {
  try {
    let at = fs.realpathSync(base);
    for (const part of rest) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) return null;
    }
    return isDir(at) ? at : null;   // no part below base is a link, so `at` is the real path
  } catch { return null; }
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
  const canon = trust.canonicalOnDisk(agentDir);
  return (cwd) => typeof cwd === 'string' && !!cwd && (cwd === agentDir || cwd === canon || trust.canonicalOnDisk(cwd) === canon);
}

function claudeRoots(agentDir, claudeRootsIn, id, belongs) {
  const canon = trust.canonicalOnDisk(agentDir);
  const spellings = [['', flatten(canon)], ['-raw', flatten(agentDir)]];
  const out = [], seen = new Set();
  (Array.isArray(claudeRootsIn) ? claudeRootsIn : []).forEach((root, i) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) return;
    for (const [tag, flat] of spellings) {
      const real = exactFolder(root, 'projects', flat);
      const fid = real ? idOf(real) : null;
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      // The name comes from WHICH root and WHICH spelling, never from how many were found.
      const only = filesUnder(real, (n) => n.endsWith('.jsonl')).filter((rel) => belongs(transcriptCwd(path.join(real, rel))));
      if (only.length) out.push({ name: `sessions/${id}/claude${i ? `-${i + 1}` : ''}${tag}`, path: real, optional: true, only });
    }
  });
  return out;
}

function geminiRoot(agentDir, geminiHome, id) {
  if (typeof geminiHome !== 'string' || !path.isAbsolute(geminiHome)) return null;
  let map;
  try { map = JSON.parse(fs.readFileSync(path.join(geminiHome, 'projects.json'), 'utf8')).projects; } catch { return null; }
  if (!map || typeof map !== 'object') return null;
  const want = trust.canonicalOnDisk(path.resolve(agentDir));
  for (const [cwd, slug] of Object.entries(map)) {
    if (trust.canonicalOnDisk(cwd) !== want) continue;
    // The slug becomes a folder name under tmp/: one plain segment only, never a path out of it.
    if (typeof slug !== 'string' || !slug || slug === '.' || slug === '..' || /[\\/\0]/.test(slug)) return null;
    const real = exactFolder(geminiHome, 'tmp', slug, 'chats');
    return real ? { name: `sessions/${id}/gemini`, path: real, optional: true } : null;
  }
  return null;
}

function codexRoot(agentDir, codexHome, id, belongs) {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) return null;
  const real = exactFolder(codexHome, 'sessions');
  if (!real) return null;
  const only = filesUnder(real, (n) => /^rollout-.*\.jsonl$/.test(n), 3).filter((rel) => {
    const meta = codexsession.metaOf(path.join(real, rel));
    return !!meta && belongs(meta.cwd);
  });
  return only.length ? { name: `sessions/${id}/codex`, path: real, optional: true, only } : null;
}

function sessionsFor(agentDir, opts) {
  const o = opts || {};
  if (typeof agentDir !== 'string' || !path.isAbsolute(agentDir) || typeof o.id !== 'string') return [];
  // Every name this id can build must be one the snapshot accepts.
  for (const n of ['claude', 'gemini', 'codex']) if (rootNameProblem(`sessions/${o.id}/${n}`)) return [];
  const belongs = belongsTo(agentDir);
  const roots = claudeRoots(agentDir, o.claudeRoots, o.id, belongs);
  const g = geminiRoot(agentDir, o.geminiHome, o.id);
  if (g) roots.push(g);
  const c = codexRoot(agentDir, o.codexHome, o.id, belongs);
  if (c) roots.push(c);
  return roots;
}

module.exports = { sessionsFor, flatten };
