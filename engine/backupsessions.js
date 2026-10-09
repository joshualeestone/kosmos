/**
 * kosmos#5686: where an agent's own sessions live, per provider, in the shape a snapshot takes.
 *
 * An agent's full conversation is its provider's session record, and none of it is under the agent's folder or the
 * world's folder (measured on #5686, comment 6082225636). Each provider files it differently:
 *   Claude Code  <config root>/projects/<agent folder, every non-alphanumeric as '->/*.jsonl, one folder per agent
 *                folder (the rule engine/status.js reads transcripts by). Both spellings are tried: the folder as given
 *                and as it is on disk (case, symlinks), as status.js does.
 *   Gemini       <gemini home>/tmp/<slug>/chats/session-*.jsonl, the slug looked up for the agent folder in
 *                <gemini home>/projects.json (engine/geminisession.js forWorkdir's rule).
 *   Codex        <codex home>/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl, ONE date tree for every agent: a rollout
 *                belongs to the agent whose folder its first line (session_meta.cwd) names (engine/codexsession.js).
 *                So Codex gives FILES, not a folder: a snapshot root would carry every other agent's sessions.
 *
 * Only session folders and session files are returned, never a provider's whole folder: those hold sign-ins
 * (.credentials.json, oauth_creds.json, auth.json) beside the sessions.
 *
 * sessionsFor(agentDir, { id, claudeRoots, geminiHome, codexHome }) -> { roots, codexFiles }
 *   id           the agent's stored name: lowercase letters, digits and hyphens (the caller derives it)
 *   claudeRoots  Claude config folders to look in (the agent's own account first); geminiHome, codexHome likewise
 *   roots        [{ name: 'sessions/<id>/claude' | 'sessions/<id>/gemini', path }] for the snapshot's roots
 *   codexFiles   absolute paths of this agent's Codex rollouts
 * Reads only folder listings, projects.json and each rollout's first line. Never throws: a provider it cannot read
 * contributes nothing.
 */
const fs = require('fs');
const path = require('path');
const trust = require('./trust');
const codexsession = require('./codexsession');

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const flatten = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');   // engine/status.js's rule for a Claude project folder
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const idOf = (p) => { try { const st = fs.statSync(p, { bigint: true }); return `${st.dev}:${st.ino}`; } catch { return null; } };

function claudeFolders(agentDir, claudeRoots) {
  const canon = trust.canonicalOnDisk(agentDir);
  const flats = [...new Set([flatten(canon), flatten(agentDir)])];
  const out = [], seen = new Set();
  for (const root of Array.isArray(claudeRoots) ? claudeRoots : []) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) continue;
    for (const flat of flats) {
      const p = path.join(root, 'projects', flat);
      const id = isDir(p) ? idOf(p) : null;
      if (id && !seen.has(id)) { seen.add(id); out.push(p); }
    }
  }
  return out;
}

function geminiFolder(agentDir, geminiHome) {
  if (typeof geminiHome !== 'string' || !path.isAbsolute(geminiHome)) return null;
  let map;
  try { map = JSON.parse(fs.readFileSync(path.join(geminiHome, 'projects.json'), 'utf8')).projects; } catch { return null; }
  if (!map || typeof map !== 'object') return null;
  const want = trust.canonicalOnDisk(path.resolve(agentDir));
  for (const [cwd, slug] of Object.entries(map)) {
    if (trust.canonicalOnDisk(cwd) !== want) continue;
    // The slug becomes a folder name under tmp/: one plain segment only, never a path out of it.
    if (typeof slug !== 'string' || !slug || slug === '.' || slug === '..' || /[\\/\0]/.test(slug)) return null;
    const p = path.join(geminiHome, 'tmp', slug, 'chats');
    return isDir(p) ? p : null;
  }
  return null;
}

function codexRollouts(agentDir, codexHome) {
  if (typeof codexHome !== 'string' || !path.isAbsolute(codexHome)) return [];
  const want = trust.canonicalOnDisk(agentDir);
  const out = [];
  for (const file of codexsession.rollouts(codexHome)) {
    const meta = codexsession.metaOf(file);
    if (meta && typeof meta.cwd === 'string' && trust.canonicalOnDisk(meta.cwd) === want) out.push(file);
  }
  return out.sort();
}

function sessionsFor(agentDir, opts) {
  const o = opts || {};
  if (typeof agentDir !== 'string' || !path.isAbsolute(agentDir) || typeof o.id !== 'string' || !ID.test(o.id)) return { roots: [], codexFiles: [] };
  const roots = [];
  claudeFolders(agentDir, o.claudeRoots).forEach((p, i) => roots.push({ name: `sessions/${o.id}/claude${i ? `-${i + 1}` : ''}`, path: p }));
  const g = geminiFolder(agentDir, o.geminiHome);
  if (g) roots.push({ name: `sessions/${o.id}/gemini`, path: g });
  return { roots, codexFiles: codexRollouts(agentDir, o.codexHome) };
}

module.exports = { sessionsFor, flatten };
