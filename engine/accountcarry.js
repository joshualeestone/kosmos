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
 *  - skills, by folder name under skills/ (a link counts: that is how Agent1s shares them), and by the contents of
 *    their SKILL.md (review 2: a stale same-named copy is not the same skill);
 *  - hooks, by the script each hook command runs (its basename), so a gate spelled `~/.claude/hooks/x.sh` in one folder
 *    and `$HOME/.claude/hooks/x.sh` in another is one gate. A hook is KEPT only when the target wires that script under
 *    the same event and matcher, the target does not set "disableAllHooks", and the script file (when the command names
 *    a path this can resolve) exists for the target with the same contents (review 1: a name alone could read a gate
 *    that will not fire as kept).
 *  - Hooks of any other type are compared as written (review 6). A hook's `if`, `timeout`, `async` and `shell` are part
 *    of its wiring (#8063): a gate with a narrower `if` on the target is not the same gate.
 *  - A hook whose command names a script this cannot resolve (%USERPROFILE%, a path with a space in it, or a relative
 *    or $CLAUDE_PROJECT_DIR path when the caller does not name the agent's working folder as `project`) cannot be
 *    checked, so the answer is "cannot tell" (#8063), with what IS known said beside it, never kept on its wiring alone.
 *  - The exec form (`command` plus `args`) is compared by its arguments, and its script resolved as one word.
 *  - Not compared: skills and hooks that come from plugins (enabledPlugins), commands/, agents/, CLAUDE.md, and the
 *    rest of settings.json (permissions, env). Named here, and in the sentence a person reads (sentence() says "skills
 *    and hook scripts"), so nobody reads this as covering them.
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

/* name -> the SKILL.md's contents hash ('' when it has none), for every skill folder. */
/* Review 6: a skill is its whole folder (SKILL.md and the scripts and references beside it), hashed by each file's
   path and contents, at most MAX_SKILL_FILES files deep; a folder past that hashes what it read and says so in its
   sum, so two such folders differ unless their first files match. */
const MAX_SKILL_FILES = 400;
/* #8063 item 3: the skill read runs on the board's thread, so it is bounded by folders visited and bytes read, not only
   files: a file past MAX_FILE_BYTES is hashed by its first MAX_FILE_BYTES and its size, and past MAX_SKILL_BYTES in one
   skill or MAX_SKILL_DIRS folders the walk stops and the sum says it was cut (two cut folders differ unless what was
   read matches). */
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_DIRS = 200;
function folderSum(root) {
  const h = crypto.createHash('sha256');
  let n = 0;
  let dirs = 0;
  let bytes = 0;
  let cut = false;
  const seen = new Set();   // review 7: real folders already walked, so a link loop ends
  const walk = (rel) => {
    let real = null;
    try { real = fs.realpathSync(path.join(root, rel)); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    if (++dirs > MAX_SKILL_DIRS) { cut = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (n >= MAX_SKILL_FILES || bytes >= MAX_SKILL_BYTES) { cut = true; return; }   // a file left unread: cut
      const r = path.join(rel, e.name);
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(root, r)).isDirectory(); } catch { isDir = false; } }
      if (isDir) { walk(r); continue; }
      n += 1;
      const d = cappedDigest(path.join(root, r));
      bytes += d ? d.read : 0;
      h.update(r + '\0' + (d ? d.sum : 'unreadable') + '\0');
    }
  };
  /* Review 1: SKILL.md first, outside every cap, so a large folder sorted ahead of it cannot hide a changed SKILL.md. */
  { const d = cappedDigest(path.join(root, 'SKILL.md')); h.update('SKILL.md\0' + (d ? d.sum : 'unreadable') + '\0'); }
  walk('');
  if (cut) h.update('truncated');
  return { sum: h.digest('hex'), cut };
}
function skillSums(dir) {
  const out = new Map();
  /* Review 5: a skill folder with no readable SKILL.md is not a skill Claude Code loads, so it is not kept. */
  for (const n of skillNames(dir)) { if (digest(path.join(dir, 'skills', n, 'SKILL.md'))) out.set(n, folderSum(path.join(dir, 'skills', n))); }   // { sum, cut }
  return out;
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
    const bare = w.replace(/["']/g, '');   // review 7: quotes anywhere in the word, as a shell removes them
    if (/\.(sh|js|mjs|cjs|py|ps1|bat|cmd)$/i.test(bare)) return bare.split(/[\\/]/).pop();   // review 2: a Windows board's scripts too (either separator)
  }
  return String(command).trim();
}

/* The file a hook command runs, resolved for one folder: ~ and $HOME are the home; $CLAUDE_CONFIG_DIR is the folder
   for an account Kosmos launches with it set, and EMPTY for the default account (review 3: its agents run with it
   unset, so `$CLAUDE_CONFIG_DIR/hooks/x.sh` there is `/hooks/x.sh`, which does not fire). Null when the command names
   no script path this can resolve. */
function scriptPath(command, folder, home, project) {
  const words = String(command).trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    /* Review 7: quotes come off the whole word first (`"$HOME"/.claude/x.sh` is the shell's /home/.claude/x.sh). */
    const bare = words[i].replace(/["']/g, '');
    if (!/\.(sh|js|mjs|cjs|py|ps1|bat|cmd)$/i.test(bare)) continue;
    /* #8063 review 2: a bare name as the command itself (`gate.sh`) is looked up on PATH, not in the working folder. */
    if (i === 0 && !/[\\/]/.test(bare)) return null;
    return resolveWord(bare, folder, home, project);
  }
  return null;
}
/* One script word, quotes already off, resolved for one folder, or null. #8063: $CLAUDE_PROJECT_DIR and a relative path
   are the agent's own working folder (its launch job's WorkingDirectory), which a move does not change, when the caller
   names it (`project`); without it they cannot be resolved. A `${VAR:-default}` is what the shell gives: the variable
   when set and not empty, else the default. */
function resolveWord(word, folder, home, project) {
  const cfg = path.resolve(folder) === path.resolve(home, '.claude') ? '' : folder;
  let bare = word;
  {
    const vars = { HOME: home, CLAUDE_CONFIG_DIR: cfg, ...(project ? { CLAUDE_PROJECT_DIR: project } : {}) };
    const val = (name) => (Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : null);
    let guard = 0;
    while (/\$\{(\w+):-([^{}]*)\}/.test(bare) && guard++ < 8) {
      bare = bare.replace(/\$\{(\w+):-([^{}]*)\}/, (m, name, dflt) => { const v = val(name); return v === null ? m : (v || dflt); });
      if (/\$\{(\w+):-/.test(bare) && !/\$\{(HOME|CLAUDE_CONFIG_DIR|CLAUDE_PROJECT_DIR):-/.test(bare)) break;
    }
    bare = bare.replace(/^~(?=[\/\\])/, home).replace(/\$\{?HOME\}?/g, home).replace(/\$\{?CLAUDE_CONFIG_DIR\}?/g, cfg);   // review 6: ~\ too
    if (project) bare = bare.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, project);
    /* Review 5: shell syntax left after the substitutions (`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`, a brace, a default)
       is a path this cannot resolve, never a path to read: a garbage path would fail to read and be skipped as "does
       not run here", which reads a loss as none. */
    if (/[$`{}%]|:-/.test(bare)) return null;   // #8063: %USERPROFILE% and the like are not resolved either
    if (path.isAbsolute(bare)) return bare;
    return project && !/^~/.test(bare) ? path.join(project, bare) : null;
  }
}
function digest(file) { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } }
/* #8063 item 3: a file's hash read no further than MAX_FILE_BYTES: { sum, read }, or null when it cannot be read. */
function cappedDigest(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const want = Math.min(size, MAX_FILE_BYTES);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) { const k = fs.readSync(fd, buf, got, want - got, got); if (k <= 0) break; got += k; }
    const h = crypto.createHash('sha256').update(buf.subarray(0, got));
    if (size > MAX_FILE_BYTES) h.update('\0size ' + size);
    return { sum: h.digest('hex'), read: got };
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}
/* #8063 item 1: the fields beside the command that change when or how a hook runs, as one string in the wiring. */
const HOOK_RUN_FIELDS = ['if', 'timeout', 'async', 'shell', 'once'];
function runFields(h) {
  const o = {};
  for (const k of HOOK_RUN_FIELDS) if (Object.prototype.hasOwnProperty.call(h, k)) o[k] = h[k];
  /* Review 1: the defaults written out are the defaults (async false), and a timeout is a number however written. */
  if (o.async === false) delete o.async;
  if (Object.prototype.hasOwnProperty.call(o, 'timeout') && Number.isFinite(Number(o.timeout))) o.timeout = Number(o.timeout);
  return Object.keys(o).length ? '\n' + JSON.stringify(o) : '';
}

/* Every hook a folder's settings.json wires: { id (script basename), wiring (event + matcher + id + the run fields),
   file (resolved for this folder, or null), sum (its contents' hash, or null when it cannot be read), unresolved (it
   names a script this cannot resolve) }, and whether all hooks are off. */
function hookEntries(dir, home, project) {
  const file = path.join(dir, 'settings.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { if (err && err.code === 'ENOENT') return { off: false, list: [] }; throw err; }
  const j = JSON.parse(raw);   // a settings file that does not parse is "cannot tell" (the caller's catch)
  const list = [];
  const hooks = j && typeof j === 'object' && j.hooks && typeof j.hooks === 'object' ? j.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      /* Review 6: no matcher, "" and "*" all mean every tool to Claude Code. */
      const raw = g && typeof g.matcher === 'string' ? g.matcher.trim() : '';
      /* Review 7: a plain alternation in any order, with or without ^...$, is one matcher (Bash|Edit is Edit|Bash). */
      const plain = raw.replace(/^\^(.*)\$$/, '$1');
      const matcher = raw === '' || raw === '*' ? '*' : (/^[\w|]+$/.test(plain) ? plain.split('|').filter(Boolean).sort().join('|') : raw);
      for (const h of g && Array.isArray(g.hooks) ? g.hooks : []) {
        /* Review 5: a prompt hook (type "prompt", no script) is compared by its event, matcher and words. */
        if (h && h.type === 'prompt' && typeof h.prompt === 'string' && h.prompt.trim()) {
          const id = `a prompt hook on ${event}`;
          list.push({ id, wiring: `${event}\n${matcher}\nprompt\n${crypto.createHash('sha256').update(h.prompt.trim()).digest('hex')}${runFields(h)}`, file: null, sum: null });
          continue;
        }
        if (!h || typeof h !== 'object') continue;
        /* #8063 review 1: the exec form ({ command, args: [...] }, which Kosmos writes for its own Windows report hook) is
           compared by its arguments too, and the script among them resolved as one word, spaces and all. */
        if (typeof h.command === 'string' && h.command.trim() && Array.isArray(h.args)) {
          const words = [h.command, ...h.args].map((x) => String(x));
          const script = words.find((x) => /\.(sh|js|mjs|cjs|py|ps1|bat|cmd)$/i.test(x.trim()));
          const oneX = (x) => x.replace(/^~(?=[\/\\]|$)/, home).replace(/\$\{?HOME\}?/g, home).split(path.resolve(dir)).join('<CFG>').split(home).join('<HOME>');
          const id = script ? script.trim().split(/[\\/]/).pop() : words.join(' ');
          const at = script ? resolveWord(script.trim(), dir, home, project) : null;
          const sum = at ? digest(at) : null;
          if (at && sum === null && fs.existsSync(at)) throw new Error(`the hook script ${at} cannot be read`);
          const key = 'exec\n' + words.filter((x) => x !== script).map(oneX).join('\0') + (script ? '\n' + id : '');
          list.push({ id, wiring: `${event}\n${matcher}\n${key}${runFields(h)}`, file: at, sum, unresolved: !!script && at === null });
          continue;
        }
        if (typeof h.command !== 'string' || !h.command.trim()) {
          /* Review 6: any other hook (a type this does not know) is compared as written, never skipped. */
          const keys = Object.keys(h).sort();
          const body = JSON.stringify(h, keys);
          if (body === '{}') continue;
          list.push({ id: `a ${typeof h.type === 'string' ? h.type : 'untyped'} hook on ${event}`, wiring: `${event}\n${matcher}\nother\n${crypto.createHash('sha256').update(body).digest('hex')}`, file: null, sum: null });
          continue;
        }
        const id = hookId(h.command);
        const at = scriptPath(h.command, dir, home, project);
        /* Review 2: the wiring keeps the command's arguments (`gate.sh pre` and `gate.sh post` are two hooks), with the
           home and folder spellings made one, so the same gate spelled ~ or $HOME still matches. */
        /* Review 4: the spellings made one inside the arguments too (~, $HOME, the folder or $CLAUDE_CONFIG_DIR), so the
           same hook written two ways is not a false loss. */
        /* Review 6: expand first, then name the folder, then the home: `~/.claude-b/x` in account .claude-b is <CFG>/x. */
        const one = (x) => x.replace(/^["']|["']$/g, '').replace(/^~(?=[\/\\]|$)/, home).replace(/\$\{?HOME\}?/g, home)
          .replace(/\$\{?CLAUDE_CONFIG_DIR\}?/g, path.resolve(dir)).split(path.resolve(dir)).join('<CFG>').split(home).join('<HOME>');
        const args = String(h.command).trim().split(/\s+/).filter((x) => !/\.(sh|js|mjs|cjs|py|ps1|bat|cmd)["']?$/i.test(x) && !/^(bash|sh|node|python3?|pwsh|powershell)$/.test(x)).map(one).join(' ');
        const sum = at ? digest(at) : null;
        /* Review 6: a script that is there but cannot be read is "cannot tell" for the whole folder, never "does not
           run here". */
        if (at && sum === null && fs.existsSync(at)) throw new Error(`the hook script ${at} cannot be read`);
        /* An inline command (no script) is its own identity: its key is the normalised text, its id the text as written. */
        /* #8063 review 2: scriptless means no word names a script, not "the id is the whole command": a bare `gate.sh` is
           a script, and one this cannot resolve. */
        const scriptless = !String(h.command).trim().split(/\s+/).some((x) => /\.(sh|js|mjs|cjs|py|ps1|bat|cmd)["']?$/i.test(x));
        const key = scriptless ? String(h.command).trim().split(/\s+/).map(one).join(' ') : `${id}\n${args}`;
        /* #8063 item 2: a command that names a script this cannot resolve cannot be checked. */
        const unresolved = !scriptless && at === null;
        list.push({ id, wiring: `${event}\n${matcher}\n${key}${runFields(h)}`, file: at, sum, unresolved });
      }
    }
  }
  return { off: !!(j && j.disableAllHooks === true), list };
}
/* The hook ids a folder wires, as a set (kept for callers that only want names). */
function hookIds(dir, home = os.homedir(), project) { return new Set(hookEntries(dir, home, project).list.map((h) => h.id)); }

/**
 * losses(fromDir, toDir, { home }) -> { ok: true, skills: [names], hooks: [scripts] } (sorted; empty when nothing is
 * lost), or { ok: false, because } when either folder cannot be read, or { ok: false, because, unchecked, ...the
 * lists } when a hook the agent has now names a script this cannot resolve (#8063). fromDir/toDir: an account folder,
 * or null/'' for the default account. opts: { home, project (the agent's working folder) }.
 */
function losses(fromDir, toDir, opts = {}) {
  const home = opts.home || os.homedir();
  const from = folderOf(fromDir, home);
  const to = folderOf(toDir, home);
  let fs1; let fs2; let fh; let th;
  /* Review 7: two folders whose skills/ is one real folder have nothing to compare there, so it is not walked twice. */
  let sameSkills = false;
  try { sameSkills = fs.realpathSync(path.join(from, 'skills')) === fs.realpathSync(path.join(to, 'skills')); } catch { sameSkills = false; }
  const project = opts.project || null;   // #8063: the agent's working folder, for relative and $CLAUDE_PROJECT_DIR hooks
  try { fs1 = sameSkills ? new Map() : skillSums(from); fh = hookEntries(from, home, project); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it is on' }; }
  try { fs2 = sameSkills ? new Map() : skillSums(to); th = hookEntries(to, home, project); }
  catch { return { ok: false, because: 'we could not read the skills and hooks of the account it would move to' }; }
  const lost = new Set();
  const hookChanged = new Set();
  if (!fh.off) {
    /* #8063 item 2: a hook the agent has now whose script path cannot be resolved is not one this can check on either
       side, so the answer is "cannot tell", and a move needs the person to accept the loss. */
    for (const h of fh.list) {
      if (h.unresolved) continue;   // named below, where the answer becomes cannot tell
      /* A hook that does not run where the agent is now (its script missing there) is not one it has to lose. */
      if (h.file && h.sum === null) continue;
      const same = th.off ? [] : th.list.filter((t) => t.wiring === h.wiring);
      /* Review 7: the script there with other contents is a different copy, said as one, and still blocks --yes
         (a gate that differs is not the gate the agent has). */
      if (h.file && same.some((t) => t.file && t.sum !== null && t.sum !== h.sum) && !same.some((t) => t.sum === h.sum)) { hookChanged.add(h.id); continue; }
      /* Review 4: a target script that resolves must be there, whatever the source side is; with both resolvable, the
         same contents. */
      const kept = same.some((t) => (h.file ? t.file !== null && t.sum !== null && t.sum === h.sum : (t.file ? t.sum !== null : true)));
      if (!kept) lost.add(h.id);
    }
  }
  /* Review 3: a skill the target has in another copy is said apart from one it does not have: the copy may be the
     newer one, so it is a difference to read, not a loss. Only `skills` and `hooks` are losses. */
  const known = { ok: true, skills: [...fs1.keys()].filter((s) => !fs2.has(s)).sort(),
    changed: [...fs1.keys()].filter((s) => fs2.has(s) && fs2.get(s).sum !== fs1.get(s).sum).sort(), hooks: [...lost].sort(),
    hooksChanged: [...hookChanged].sort() };
  /* #8063 review 2: a skill read only in part (past a cap) that reads the same is said as such, so "same" is not claimed
     for what was not read. Only when there is one: the shape the callers already read stays as it was. */
  const cut = [...fs1.keys()].filter((s) => fs2.has(s) && fs2.get(s).sum === fs1.get(s).sum && (fs1.get(s).cut || fs2.get(s).cut)).sort();
  if (cut.length) known.partlyRead = cut;
  /* #8063 item 2: a hook the agent has now whose script path cannot be resolved cannot be checked, so the answer is
     cannot tell (a move needs the person to accept the loss). Review 1: what IS known is still said beside it. */
  const unchecked = fh.off ? [] : [...new Set(fh.list.filter((h) => h.unresolved).map((h) => h.id))].sort();
  if (!unchecked.length) return known;
  const also = sentence(known);
  return { ...known, ok: false, unchecked,
    because: `we could not check ${unchecked.length === 1 ? 'the hook' : 'the hooks'} ${unchecked.join(', ')}: ${unchecked.length === 1 ? 'its script path is' : 'their script paths are'} not one we can follow.${also ? ' ' + also : ''}` };
}

/* Whether a move loses anything: a skill or hook the target does not have. A different copy is not a loss. */
function loses(l) { return !!l && l.ok === true && (l.skills.length > 0 || l.hooks.length > 0 || (Array.isArray(l.hooksChanged) && l.hooksChanged.length > 0)); }
/* One or two sentences for a person, or null when nothing is lost or different. */
function sentence(l) {
  if (!l || l.ok !== true) return null;
  const parts = [];
  if (l.skills.length) parts.push(`${l.skills.length === 1 ? 'the skill' : 'the skills'} ${l.skills.join(', ')}`);
  if (l.hooks.length) parts.push(`${l.hooks.length === 1 ? 'the hook' : 'the hooks'} ${l.hooks.join(', ')}`);
  const changed = Array.isArray(l.changed) ? l.changed : [];
  const out = [];
  if (parts.length) out.push(`On that account it would not have ${parts.join(', or ')} it has now.`);
  if (changed.length) out.push(`That account has a different copy of ${changed.length === 1 ? 'the skill' : 'the skills'} ${changed.join(', ')}.`);
  const hc = Array.isArray(l.hooksChanged) ? l.hooksChanged : [];
  if (hc.length) out.push(`It has a different copy of ${hc.length === 1 ? 'the hook' : 'the hooks'} ${hc.join(', ')}, which may not do what the agent's does now.`);
  return out.length ? out.join(' ') : null;
}

module.exports = { losses, loses, sentence, hookId, skillNames, skillSums, hookIds, hookEntries, scriptPath, folderOf };
