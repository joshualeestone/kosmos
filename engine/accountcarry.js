'use strict';
/**
 * kosmos#8048 item 3: what an agent would lose by moving from one Claude account folder to another.
 *
 * A move (engine/accountmove.js) writes the agent's account and restarts it, and the agent then runs with the TARGET
 * folder's own `skills/` and `settings.json`. Nothing carries them across. On Agent1s every account folder links both
 * back to ~/.claude, so nothing can be lost; on Mortals (measured 2026-11-05) the account folders are copies that have
 * drifted: two skills and two gate hooks are in ~/.claude only. A move onto such a folder drops them silently, which is
 * how a move once dropped the team's skills and pre-challenge gate.
 *
 * This reads both folders and names what is in the source and not in the target:
 *  - skills, by folder name under skills/ (a link counts: that is how Agent1s shares them);
 *  - hooks, by the script each hook command runs (its basename), across every event in settings.json "hooks", so a
 *    gate spelled `~/.claude/hooks/x.sh` in one folder and `$HOME/.claude/hooks/x.sh` in another is one gate.
 *
 * 🛑 A folder that cannot be read is "cannot tell", never "nothing lost": { ok: false, because }. A caller must not
 * read ok:false as safe. Reads only; never writes, never follows a link outside to write.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* The folder an account is, or null for the default account (accounts.js: unset CLAUDE_CONFIG_DIR is ~/.claude). */
function folderOf(dir, home = os.homedir()) {
  return typeof dir === 'string' && dir ? dir : path.join(home, '.claude');
}

function skillNames(dir) {
  const root = path.join(dir, 'skills');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (err) { if (err && err.code === 'ENOENT') return new Set(); throw err; }
  const out = new Set();
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(root, e.name)).isDirectory(); } catch { isDir = false; } }
    if (isDir) out.add(e.name);
  }
  return out;
}

/* The script a hook command runs: the basename of the first word that names a .sh/.js/.mjs/.py file, or else the
   whole command, trimmed (an inline command is its own identity). */
function hookId(command) {
  const words = String(command).trim().split(/\s+/);
  for (const w of words) {
    const bare = w.replace(/^["']|["']$/g, '');
    if (/\.(sh|js|mjs|cjs|py)$/.test(bare)) return path.basename(bare);
  }
  return String(command).trim();
}

function hookIds(dir) {
  const file = path.join(dir, 'settings.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err && err.code === 'ENOENT') return new Set(); throw err; }
  const j = JSON.parse(raw);   // a settings file that does not parse is "cannot tell" (the caller's catch)
  const out = new Set();
  const hooks = j && typeof j === 'object' && j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
  for (const groups of Object.values(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g && Array.isArray(g.hooks) ? g.hooks : []) {
        if (h && typeof h.command === 'string' && h.command.trim()) out.add(hookId(h.command));
      }
    }
  }
  return out;
}

/**
 * losses(fromDir, toDir, { home }) -> { ok: true, skills: [names], hooks: [scripts] } (sorted; empty when nothing is
 * lost), or { ok: false, because } when either folder cannot be read. fromDir/toDir: an account folder, or null/''
 * for the default account.
 */
function losses(fromDir, toDir, opts = {}) {
  const home = opts.home || os.homedir();
  const from = folderOf(fromDir, home);
  const to = folderOf(toDir, home);
  let fs1; let fs2; let fh; let th;
  try { fs1 = skillNames(from); fh = hookIds(from); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it is on' }; }
  try { fs2 = skillNames(to); th = hookIds(to); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it would move to' }; }
  return { ok: true, skills: [...fs1].filter((s) => !fs2.has(s)).sort(), hooks: [...fh].filter((h) => !th.has(h)).sort() };
}

/* One sentence for a person, or null when nothing is lost. */
function sentence(l) {
  if (!l || l.ok !== true) return null;
  const parts = [];
  if (l.skills.length) parts.push(`${l.skills.length === 1 ? 'the skill' : 'the skills'} ${l.skills.join(', ')}`);
  if (l.hooks.length) parts.push(`${l.hooks.length === 1 ? 'the hook' : 'the hooks'} ${l.hooks.join(', ')}`);
  return parts.length ? `On that account it would not have ${parts.join(', or ')}.` : null;
}

module.exports = { losses, sentence, hookId, skillNames, hookIds, folderOf };
