'use strict';

/*
 * #5774 part 1: the scripts that Claude Code's start-time config RUNS, outside the sandbox, for a token-only agent.
 *
 * #5516 part 2 denies the config itself (settings, the global config, the server files, the config homes' code
 * folders). A command in that config can still name a script that sits anywhere else (a hook running
 * `bash ~/scripts/x.sh`, a status line, an auth helper, a server started as `node /path/server.js`), and that script runs
 * outside the sandbox each time the command does. If the agent's file tools can rewrite the script, the guard is open
 * through it. This module reads the commands Claude Code will run for the agent and names the script files they point
 * at, so the guard can deny them in both layers.
 *
 * What is read (Claude Code 2.1.296, read from its binary): every settings tier (each config home's settings files and
 * remote settings, the agent folder's and each folder above's .claude settings, the managed settings and their drop-in
 * folder), every server tier (each global config's own servers and its entries for the agent folder and the folders
 * above, the .mcp.json files, the managed server file), and each installed plugin's manifest and the hook, server and
 * language-server files it uses. Every config home is read, not only the agent's own: Kosmos can move an agent to
 * another account.
 *
 * What is a command: an object's `command` (with its `args` when a server gives them), and the helpers that run a
 * script (apiKeyHelper, awsAuthRefresh, awsCredentialExport, gcpAuthRefresh, otelHeadersHelper, proxyAuthHelper,
 * headersHelper, and any later `...Helper`). The managed policyHelpers entries are read through their `command`; a
 * script given inline in one is not read. A command is split into words the way a shell would, enough to find paths;
 * it is not a shell. The settings `env` values are known variables when every tier that sets one agrees on it.
 *
 * Which words name a script: an absolute path, a path from the home, or a path with a slash read from the agent folder
 * (hooks run there); a path found inside a word (require('/x.js')); the value of a NAME=value word; the commands inside
 * $(...) and backticks, and after a shell's -c or an interpreter's -e. The script word after an interpreter (bash x.sh,
 * node x.js) counts whether or not it exists, since the agent could create it. Another bare word counts when it is a
 * file in the agent folder. A bare program is found on PATH, which #5516 part 1 covers. An existing FOLDER is never a
 * script (cd "$CLAUDE_PROJECT_DIR" must not deny the agent its own folder). A word whose value Kosmos cannot know is
 * reported when it is a path, a program, or an interpreter's script, so the guard says it is not whole.
 *
 * Not covered here (stated gaps, later parts of #5774): what a script or program runs or reads in turn (a script that
 * sources another, npm or make reading the agent folder's package.json or Makefile), the shell's own startup files,
 * environment settings that point a program at code, and hooks declared inside skills, agents and commands.
 */

const fs = require('fs');
const path = require('path');

const HELPER_KEYS = new Set(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper', 'headersHelper']);
const OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);
/* Programs whose first plain argument is a script they run. */
const INTERPRETER = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|source|\.|node|nodejs|deno|bun|tsx|ts-node|ruby|perl|php|lua|Rscript|osascript|pwsh|powershell(?:\.exe)?|python[0-9.]*)$/;
/* An interpreter's flags after which the next word is a script given inline. */
const INLINE_FLAG = /^(?:-[A-Za-z]*c|-e|--eval|-p|--print|-Command|-c)$/;

/* Where Claude Code 2.1.296 reads managed settings, by platform (its own switch, read from the binary). */
function managedDir(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/*
 * Split a command line into words, as a shell would, for finding paths. Quotes and backslashes are honoured; the
 * operators ; & | ( ) < > and newlines end a word. A variable is replaced when `vars` names it, otherwise the word is
 * marked dynamic. Each word records `head` (the program of its simple command), `assign` (a NAME=value before the
 * program), `written` (a redirection's target) and `subs` (the commands inside its $(...) and backticks).
 */
function shellWords(cmd, vars = {}) {
  const words = [];
  let cur = null;
  let head = true;
  let written = false;   // the next word follows '>': a file the command writes, not one it runs
  const start = () => { if (!cur) { cur = { text: '', dynamic: false, quoted: false, head, written, assign: false, subs: [] }; written = false; } };
  const end = () => {
    if (!cur) return;
    const assign = cur.head && !cur.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(cur.text);
    if (assign) { cur.head = false; cur.assign = true; }
    words.push(cur);
    if (!assign) head = false;
    cur = null;
  };
  const known = (name) => Object.prototype.hasOwnProperty.call(vars, name);
  const readVar = (i) => {
    // At cmd[i] === '$'. Returns [replacement or null, next index, inner command or null].
    const c = cmd[i + 1];
    if (c === '{') {
      const close = cmd.indexOf('}', i + 2);
      if (close < 0) return [null, cmd.length, null];
      const inner = cmd.slice(i + 2, close);
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(inner);
      return [name && name[0] === inner && known(name[0]) ? vars[name[0]] : null, close + 1, null];
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(cmd.slice(i + 1));
    if (name) return [known(name[0]) ? vars[name[0]] : null, i + 1 + name[0].length, null];
    if (c === '(') {   // $( ... ): to its matching close, so it stays inside this word; its command is read too
      let depth = 0;
      for (let j = i + 1; j < cmd.length; j++) {
        if (cmd[j] === '(') depth++;
        else if (cmd[j] === ')' && --depth === 0) return [null, j + 1, cmd.slice(i + 2, j)];
      }
      return [null, cmd.length, cmd.slice(i + 2)];
    }
    return [null, i + 2, null];   // $1 $? and the like
  };
  const dollar = (i) => {
    const [v, n, sub] = readVar(i);
    if (v === null) cur.dynamic = true; else cur.text += v;
    if (sub !== null) cur.subs.push(sub);
    return n;
  };
  const tick = (i) => {
    const close = cmd.indexOf('`', i + 1);
    cur.dynamic = true;
    cur.subs.push(cmd.slice(i + 1, close < 0 ? cmd.length : close));
    return close < 0 ? cmd.length : close + 1;
  };
  let i = 0;
  let quote = null;
  while (i < cmd.length) {
    const c = cmd[i];
    if (quote === "'") {
      if (c === "'") quote = null; else cur.text += c;
      i++; continue;
    }
    if (quote === '"') {
      if (c === '"') { quote = null; i++; continue; }
      if (c === '\\' && i + 1 < cmd.length && '"\\$`'.includes(cmd[i + 1])) { cur.text += cmd[i + 1]; i += 2; continue; }
      if (c === '$') { i = dollar(i); continue; }
      if (c === '`') { i = tick(i); continue; }
      cur.text += c; i++; continue;
    }
    if (c === "'" || c === '"') { start(); cur.quoted = true; quote = c; i++; continue; }
    if (c === '\\' && i + 1 < cmd.length) { start(); cur.text += cmd[i + 1]; i += 2; continue; }
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (OPERATORS.has(c)) {
      end();
      const afterRedirect = c === '&' && cmd[i - 1] === '>';   // the & of >& or 2>&1 continues the redirection
      written = c === '>' || (afterRedirect && !/[0-9-]/.test(cmd[i + 1] || ''));
      if (c !== '<' && c !== '>' && !afterRedirect) head = true;
      i++; continue;
    }
    start();
    if (c === '$') { i = dollar(i); continue; }
    if (c === '`') { i = tick(i); continue; }
    if (c === '~' && cur.text === '' && !cur.quoted && (i + 1 === cmd.length || cmd[i + 1] === '/') && vars.HOME) { cur.text += vars.HOME; i++; continue; }
    cur.text += c; i++;
  }
  end();
  return words;
}

/* An absolute path inside a word that is not itself a path (require('/x.js'), --config=/x). */
const INNER_ABS = /(?:^|[^A-Za-z0-9_.~/$-])(\/[^\s'"`()<>;|&,]+)/g;

/*
 * The file paths a list of words names. `cwd` is where the command runs (the agent folder); `vars` are the variables
 * Kosmos knows. Returns { paths, unsafe }: candidate script paths (folders are filtered later, by scriptPaths) and the
 * words whose value cannot be known.
 */
function pathsOfWords(words, cwd, vars = {}, depth = 0) {
  const paths = [];
  const unsafe = [];
  const more = (line) => {
    if (depth >= 3) return;
    const r = pathsOfWords(shellWords(line, vars), cwd, vars, depth + 1);
    paths.push(...r.paths); unsafe.push(...r.unsafe);
  };
  let prog = '';         // the program of the current simple command
  let scriptSlot = false;   // the next plain word is the script the program (an interpreter) runs
  let prev = '';
  for (const w of words) {
    const before = prev;
    prev = w.dynamic ? '' : w.text;
    for (const s of w.subs || []) more(s);   // the command inside $(...) or backticks runs too
    if (w.head) { prog = path.basename(w.text); scriptSlot = INTERPRETER.test(prog); }
    if (w.written) continue;   // a redirection's target is written, not run
    if (w.assign) { more(w.text.slice(w.text.indexOf('=') + 1)); continue; }   // BASH_ENV=/x.sh, NODE_OPTIONS=...
    let text = w.text;
    const inline = INTERPRETER.test(prog) && INLINE_FLAG.test(before);   // only an interpreter's -c or -e (mkdir -p is not)
    const isFlag = !w.head && !w.dynamic && text.startsWith('-');
    // A flag that carries a path (--require=/x.js): the part after the first '='.
    if (isFlag && text.includes('=')) text = text.slice(text.indexOf('=') + 1);
    const inScriptSlot = scriptSlot && !w.head && !isFlag && !inline;
    if (inScriptSlot) scriptSlot = false;
    if (w.dynamic) {
      if (text.includes('/') || w.head || inScriptSlot || inline) unsafe.push(`a ${w.head ? 'program' : 'path'} made when the command runs${text.includes('/') ? ', ending ' + text.slice(text.lastIndexOf('/')) : ''}`);
      continue;
    }
    if (inline) { scriptSlot = false; more(text); for (const m of text.matchAll(INNER_ABS)) paths.push(path.normalize(m[1])); continue; }
    if (!text || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) continue;   // a URL is not a file
    if (path.isAbsolute(text)) { if (!/^\/dev(\/|$)/.test(text)) paths.push(path.normalize(text)); continue; }
    if (/^\.{0,2}\//.test(text) || (text.includes('/') && !/['"()=,:]/.test(text))) { paths.push(path.resolve(cwd, text)); continue; }
    if (text.includes('/')) { for (const m of text.matchAll(INNER_ABS)) paths.push(path.normalize(m[1])); continue; }
    if (w.head || isFlag) continue;   // a bare program is found on PATH (#5516 part 1)
    const local = path.join(cwd, text);
    if (inScriptSlot) { paths.push(local); continue; }   // bash check.sh: the agent could create it
    try { if (fs.statSync(local).isFile()) paths.push(local); } catch { /* not a file here */ }
  }
  return { paths, unsafe };
}

/* Every command in a parsed config: { line } for a shell line, or { program, args } for a server's command and args. */
function commandsIn(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 32) return out;
  if (Array.isArray(node)) { for (const x of node) commandsIn(x, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'command' && typeof v === 'string') {
      if (Array.isArray(node.args) && node.args.every((a) => typeof a === 'string')) out.push({ program: v, args: node.args });
      else out.push({ line: v });
    } else if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) {
      out.push({ line: v });
    } else if (v && typeof v === 'object') {
      commandsIn(v, out, depth + 1);
    }
  }
  return out;
}

/* The words of one command. A server's args are literal words (no shell), with ${VAR} expanded as Claude Code does. */
function wordsOf(cmd, vars) {
  if (cmd.line !== undefined) return shellWords(cmd.line, vars);
  const one = (s, head) => {
    const ws = shellWords(`"${s.replace(/(["\\`])/g, '\\$1')}"`, vars);
    const w = ws[0] || { text: '', dynamic: false, subs: [] };
    return { ...w, head, assign: false, written: false };
  };
  return [one(cmd.program, true), ...cmd.args.map((a) => one(a, false))];
}

/* The agent folder and every folder above it, by given and resolved path. */
function foldersFrom(dir) {
  const folders = [];
  for (const start of [path.resolve(dir), (() => { try { return fs.realpathSync.native(dir); } catch { return null; } })()]) {
    if (!start) continue;
    for (let d = start; ; d = path.dirname(d)) { if (!folders.includes(d)) folders.push(d); if (path.dirname(d) === d) break; }
  }
  return folders;
}

/*
 * The config files to read for an agent folder `dir`, given the config homes `homes` and the user home `home`.
 * Returns [{ file, pick, settings }] where pick(json) returns the part Claude Code reads for this agent, and settings
 * marks a settings tier (whose `env` hooks see).
 */
function configSources(dir, homes, home, deps = {}) {
  const platform = deps.platform || process.platform;
  const whole = (j) => j;
  const out = [];
  const folders = foldersFrom(dir);
  for (const h of homes) {
    for (const f of ['settings.json', 'settings.local.json', 'remote-settings.json']) out.push({ file: path.join(h, f), pick: whole, settings: true });
  }
  for (const d of folders) {
    for (const f of ['settings.json', 'settings.local.json']) out.push({ file: path.join(d, '.claude', f), pick: whole, settings: true });
    out.push({ file: path.join(d, '.mcp.json'), pick: whole });
  }
  /* The global config: its own servers, and its project entries for the agent folder and the folders above (never
     the whole file: it holds every project on the computer). */
  const globals = [path.join(home, '.claude.json'), ...homes.map((h) => path.join(h, '.claude.json')), ...homes.map((h) => path.join(h, '.config.json'))];
  const pickGlobal = (j) => {
    if (!j || typeof j !== 'object') return null;
    const { projects, ...rest } = j;
    const mine = projects && typeof projects === 'object' ? folders.map((d) => projects[d]).filter(Boolean) : [];
    return [rest, ...mine];
  };
  for (const g of [...new Set(globals)]) out.push({ file: g, pick: pickGlobal });
  const md = deps.managedDir !== undefined ? deps.managedDir : managedDir(platform);
  if (md) {
    out.push({ file: path.join(md, 'managed-settings.json'), pick: whole, settings: true }, { file: path.join(md, 'managed-mcp.json'), pick: whole });
    try { for (const f of fs.readdirSync(path.join(md, 'managed-settings.d')).filter((x) => x.endsWith('.json')).sort()) out.push({ file: path.join(md, 'managed-settings.d', f), pick: whole, settings: true }); } catch { /* none */ }
  }
  return out;
}

/* Each installed plugin, from each config home's record of installed plugins: { dir, home, id }. */
function installedPlugins(homes) {
  const out = [];
  const seen = new Set();
  for (const h of homes) {
    for (const f of ['installed_plugins.json', 'installed_plugins_v2.json']) {
      const j = readJson(path.join(h, 'plugins', f));
      const plugins = j && j.plugins && typeof j.plugins === 'object' ? j.plugins : null;
      if (!plugins) continue;
      for (const [id, entries] of Object.entries(plugins)) {
        for (const e of Array.isArray(entries) ? entries : [entries]) {
          if (!e || typeof e.installPath !== 'string') continue;
          const dir = path.resolve(e.installPath);
          if (seen.has(h + '\0' + dir)) continue;
          seen.add(h + '\0' + dir);
          out.push({ dir, home: h, id });
        }
      }
    }
  }
  return out;
}

/* A plugin's config files: its manifest, the default hook, server and language-server files, and any the manifest
   points at by path. */
function pluginConfigFiles(dir) {
  const files = [path.join(dir, '.claude-plugin', 'plugin.json'), path.join(dir, 'hooks', 'hooks.json'), path.join(dir, '.mcp.json'), path.join(dir, '.lsp.json')];
  const manifest = readJson(files[0]);
  if (manifest && typeof manifest === 'object') {
    for (const k of ['hooks', 'mcpServers', 'lspServers']) {
      for (const p of [].concat(manifest[k] || [])) {
        if (typeof p === 'string') files.push(path.resolve(dir, p.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, dir)));
      }
    }
  }
  return [...new Set(files)];
}

/*
 * The scripts Claude Code's start-time commands run for the agent in `dir`.
 * Returns { files, pluginDirs, unsafe }: the script files (absolute, not yet resolved through links; never an existing
 * folder), the installed plugin folders (whose own code runs, wherever they sit), and the commands whose script could
 * not be worked out.
 */
function startCommandScripts(dir, { homes = [], home, ownHome = null, platform, managedDir: md } = {}) {
  const agentDir = path.resolve(dir);
  const raw = [];
  const unsafe = [];
  const sources = configSources(agentDir, homes, home, { platform, managedDir: md }).map((s) => ({ ...s, json: readJson(s.file) })).filter((s) => s.json !== null);
  /* The settings env, which hooks see: a variable every tier that sets it agrees on is known; one set two ways is not. */
  const envValues = new Map();
  for (const s of sources.filter((x) => x.settings)) {
    const env = s.json && typeof s.json.env === 'object' && s.json.env ? s.json.env : {};
    for (const [k, v] of Object.entries(env)) { if (!envValues.has(k)) envValues.set(k, new Set()); envValues.get(k).add(String(v)); }
  }
  const settingsEnv = {};
  for (const [k, vs] of envValues) if (vs.size === 1) settingsEnv[k] = [...vs][0];
  // Shell variables for reading the commands, not an environment for a child (so not engine/win32env.js's business).
  const baseVars = { ...settingsEnv, HOME: home, CLAUDE_PROJECT_DIR: agentDir, ...(ownHome ? { CLAUDE_CONFIG_DIR: ownHome } : {}) };
  const take = (cmds, vars, where) => {
    for (const c of cmds) {
      const r = pathsOfWords(wordsOf(c, vars), agentDir, vars);
      raw.push(...r.paths);
      for (const u of r.unsafe) unsafe.push(`${u} (in ${where}: a command whose script Kosmos cannot read)`);
    }
  };
  for (const s of sources) {
    const part = s.pick(s.json);
    if (part) take(commandsIn(part), baseVars, s.file);
  }
  const plugins = installedPlugins(homes);
  for (const p of plugins) {
    const vars = { ...baseVars, CLAUDE_PLUGIN_ROOT: p.dir, CLAUDE_PLUGIN_DATA: path.join(p.home, 'plugins', 'data', p.id.replace(/[^a-zA-Z0-9\-_]/g, '-')) };
    for (const f of pluginConfigFiles(p.dir)) {
      const j = readJson(f);
      if (j !== null) take(commandsIn(j), vars, f);
    }
  }
  /* Never a folder: `cd "$CLAUDE_PROJECT_DIR"` or `rg x ~/work` names one, and denying it would take the agent's own
     work away. A script is a file, or a path with nothing there yet (which the agent could create). */
  const files = [];
  for (const p of new Set(raw)) {
    let st = null;
    try { st = fs.statSync(p); } catch { st = null; }
    if (st && st.isDirectory()) continue;
    files.push(p);
  }
  return { files, pluginDirs: [...new Set(plugins.map((p) => p.dir))], unsafe: [...new Set(unsafe)] };
}

module.exports = { startCommandScripts, shellWords, pathsOfWords, commandsIn, managedDir, HELPER_KEYS };
