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
 *  - hooks, by the script each hook command runs (its basename), so a gate spelled `~/.claude/hooks/x.sh` in one folder
 *    and `$HOME/.claude/hooks/x.sh` in another is one gate. A hook is KEPT only when the target wires that script under
 *    the same event and matcher, the target does not set "disableAllHooks", and the script file (when the command names
 *    a path this can resolve) exists for the target with the same contents (review 1: a name alone could read a gate
 *    that will not fire as kept).
 *  - Not compared: skills and hooks that come from plugins (enabledPlugins). Named here so nobody reads this as covering
 *    them.
 *
 * 🛑 A folder that cannot be read is "cannot tell", never "nothing lost": { ok: false, because }. A caller must not
 * read ok:false as safe. Reads only; never writes, never follows a link outside to write.
 */
const crypto = require('node:crypto');
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

/* The file a hook command runs, resolved for one folder: ~ and $HOME are the home, $CLAUDE_CONFIG_DIR is the folder
   (Claude Code sets it to the account folder). Null when the command names no script path this can resolve. */
function scriptPath(command, folder, home) {
  for (const w of String(command).trim().split(/\s+/)) {
    let bare = w.replace(/^["']|["']$/g, '');
    if (!/\.(sh|js|mjs|cjs|py)$/.test(bare)) continue;
    bare = bare.replace(/^~(?=\/)/, home).replace(/\$\{?HOME\}?/g, home).replace(/\$\{?CLAUDE_CONFIG_DIR\}?/g, folder);
    return path.isAbsolute(bare) && !bare.includes('$') ? bare : null;
  }
  return null;
}
function digest(file) { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } }

/* Every hook a folder's settings.json wires: { id (script basename), wiring (event + matcher + id), file (resolved for
   this folder, or null), sum (its contents' hash, or null when it cannot be read) }, and whether all hooks are off. */
function hookEntries(dir, home) {
  const file = path.join(dir, 'settings.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err && err.code === 'ENOENT') return { off: false, list: [] }; throw err; }
  const j = JSON.parse(raw);   // a settings file that does not parse is "cannot tell" (the caller's catch)
  const list = [];
  const hooks = j && typeof j === 'object' && j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      const matcher = g && typeof g.matcher === 'string' ? g.matcher : '';
      for (const h of g && Array.isArray(g.hooks) ? g.hooks : []) {
        if (!h || typeof h.command !== 'string' || !h.command.trim()) continue;
        const id = hookId(h.command);
        const at = scriptPath(h.command, dir, home);
        list.push({ id, wiring: `${event}\n${matcher}\n${id}`, file: at, sum: at ? digest(at) : null });
      }
    }
  }
  return { off: !!(j && j.disableAllHooks === true), list };
}
/* The hook ids a folder wires, as a set (kept for callers that only want names). */
function hookIds(dir, home = os.homedir()) { return new Set(hookEntries(dir, home).list.map((h) => h.id)); }

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
  try { fs1 = skillNames(from); fh = hookEntries(from, home); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it is on' }; }
  try { fs2 = skillNames(to); th = hookEntries(to, home); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it would move to' }; }
  const lost = new Set();
  if (!fh.off) {
    for (const h of fh.list) {
      /* A hook that does not run where the agent is now (its script missing there) is not one it has to lose. */
      if (h.file && h.sum === null) continue;
      const same = th.off ? [] : th.list.filter((t) => t.wiring === h.wiring);
      const kept = same.some((t) => (h.file ? t.file !== null && t.sum !== null && t.sum === h.sum : true));
      if (!kept) lost.add(h.id);
    }
  }
  return { ok: true, skills: [...fs1].filter((s) => !fs2.has(s)).sort(), hooks: [...lost].sort() };
}

/* One sentence for a person, or null when nothing is lost. */
function sentence(l) {
  if (!l || l.ok !== true) return null;
  const parts = [];
  if (l.skills.length) parts.push(`${l.skills.length === 1 ? 'the skill' : 'the skills'} ${l.skills.join(', ')}`);
  if (l.hooks.length) parts.push(`${l.hooks.length === 1 ? 'the hook' : 'the hooks'} ${l.hooks.join(', ')}`);
  return parts.length ? `On that account it would not have ${parts.join(', or ')}.` : null;
}

module.exports = { losses, sentence, hookId, skillNames, hookIds, hookEntries, scriptPath, folderOf };
