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
 * above, the .mcp.json files, the managed server file), and each installed plugin's hooks, servers and language
 * servers. Every config home is read, not only the agent's own: Kosmos can move an agent to another account.
 *
 * What is a command: an object's `command` (with its `args` when a server gives them), and the helpers that run a
 * script (apiKeyHelper, awsAuthRefresh, awsCredentialExport, gcpAuthRefresh, otelHeadersHelper, proxyAuthHelper,
 * headersHelper, and any later `...Helper`). A command is split into words the way a shell would, enough to find paths;
 * it is not a shell.
 *
 * What a word names: an absolute path, a path from the home (`~/`, `$HOME`), or a path with a slash read from the agent
 * folder (hooks run there). A bare word that is a file in the agent folder counts when it is not the program itself.
 * The program itself, when bare, is found on PATH, which #5516 part 1 already covers. A word whose path depends on a
 * variable Kosmos cannot know is not guessed: it is reported, so the guard says it is not whole.
 *
 * Not covered here (stated gaps, later parts of #5774): what a script runs or reads in turn, the shell's own startup
 * files, environment settings that point a program at code, and hooks declared inside skills, agents and commands.
 */

const fs = require('fs');
const path = require('path');

const HELPER_KEYS = new Set(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper', 'headersHelper']);
const OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);

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
 * marked dynamic. `head` is true for the program of each simple command (the first word, after any NAME=value words).
 */
function shellWords(cmd, vars = {}) {
  const words = [];
  let cur = null;
  let head = true;
  let written = false;   // the next word follows '>': a file the command writes, not one it runs
  const start = () => { if (!cur) { cur = { text: '', dynamic: false, quoted: false, head, written }; written = false; } };
  const end = () => {
    if (!cur) return;
    const assign = cur.head && !cur.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(cur.text);
    if (assign) cur.head = false;
    words.push(cur);
    if (!assign) head = false;
    cur = null;
  };
  const readVar = (i) => {
    // At cmd[i] === '$'. Returns [replacement or null, next index]. Command substitution and odd forms are dynamic.
    const c = cmd[i + 1];
    if (c === '{') {
      const close = cmd.indexOf('}', i + 2);
      if (close < 0) return [null, cmd.length];
      const inner = cmd.slice(i + 2, close);
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(inner);
      const known = name && name[0] === inner && Object.prototype.hasOwnProperty.call(vars, name[0]);
      return [known ? vars[name[0]] : null, close + 1];
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(cmd.slice(i + 1));
    if (name) {
      const known = Object.prototype.hasOwnProperty.call(vars, name[0]);
      return [known ? vars[name[0]] : null, i + 1 + name[0].length];
    }
    if (c === '(') {   // $( ... ): skip to its matching close, so the substitution stays inside this word
      let depth = 0;
      for (let j = i + 1; j < cmd.length; j++) {
        if (cmd[j] === '(') depth++;
        else if (cmd[j] === ')' && --depth === 0) return [null, j + 1];
      }
      return [null, cmd.length];
    }
    return [null, i + 2];   // $1 $? and the like
  };
  const skipTick = (i) => { const close = cmd.indexOf('`', i + 1); return close < 0 ? cmd.length : close + 1; };
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
      if (c === '$') { const [v, n] = readVar(i); if (v === null) cur.dynamic = true; else cur.text += v; i = n; continue; }
      if (c === '`') { cur.dynamic = true; i = skipTick(i); continue; }
      cur.text += c; i++; continue;
    }
    if (c === "'" || c === '"') { start(); cur.quoted = true; quote = c; i++; continue; }
    if (c === '\\' && i + 1 < cmd.length) { start(); cur.text += cmd[i + 1]; i += 2; continue; }
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (OPERATORS.has(c)) {
      end();
      written = c === '>';
      if (c === '&' && cmd[i - 1] === '>') written = false;   // >& joins two outputs
      if (c !== '<' && c !== '>') head = true;
      i++; continue;
    }
    start();
    if (c === '$') { const [v, n] = readVar(i); if (v === null) cur.dynamic = true; else cur.text += v; i = n; continue; }
    if (c === '`') { cur.dynamic = true; i = skipTick(i); continue; }
    if (c === '~' && cur.text === '' && !cur.quoted && (i + 1 === cmd.length || cmd[i + 1] === '/') && vars.HOME) { cur.text += vars.HOME; i++; continue; }
    cur.text += c; i++;
  }
  end();
  return words;
}

/*
 * The file paths a list of words names. `cwd` is where the command runs (the agent folder); `vars` are the variables
 * Kosmos knows, for a script given inline. Returns { paths, unsafe }.
 */
function pathsOfWords(words, cwd, vars = {}, depth = 0) {
  const paths = [];
  const unsafe = [];
  let prev = '';
  for (const w of words) {
    const before = prev;
    prev = w.dynamic ? '' : w.text;
    if (w.written) continue;   // a redirection's target is written, not run
    let text = w.text;
    // A flag that carries a path (--require=/x.js): the part after the first '='.
    if (text.startsWith('-') && text.includes('=')) text = text.slice(text.indexOf('=') + 1);
    if (w.dynamic) {
      if (text.includes('/')) unsafe.push(`a path made when the command runs, ending ${text.slice(text.lastIndexOf('/')) || text}`);
      continue;
    }
    // The word after a shell's -c is a script given inline (bash -c "..."): read its words too, twice deep at most.
    if (/^-[A-Za-z]*c$/.test(before) && depth < 2) {
      const inner = pathsOfWords(shellWords(text, vars), cwd, vars, depth + 1);
      paths.push(...inner.paths); unsafe.push(...inner.unsafe);
      continue;
    }
    if (!text) continue;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) continue;   // a URL, not a file
    if (path.isAbsolute(text)) { if (!/^\/dev(\/|$)/.test(text)) paths.push(path.normalize(text)); continue; }
    if (text.includes('/')) { paths.push(path.resolve(cwd, text)); continue; }
    if (w.head) continue;   // a bare program is found on PATH (#5516 part 1)
    const local = path.join(cwd, text);
    try { if (fs.statSync(local).isFile()) paths.push(local); } catch { /* not a file here */ }
  }
  return { paths, unsafe };
}

/* Every command in a parsed config: { line, words } for a shell line, or { words } for a server's command and args. */
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
    const w = ws[0] || { text: '', dynamic: false };
    return { ...w, head };
  };
  return [one(cmd.program, true), ...cmd.args.map((a) => one(a, false))];
}

/*
 * The config files to read for an agent folder `dir`, given the config homes `homes` and the user home `home`.
 * Returns [{ file, pick }] where pick(json) returns the part Claude Code reads for this agent.
 */
function configSources(dir, homes, home, deps = {}) {
  const platform = deps.platform || process.platform;
  const whole = (j) => j;
  const out = [];
  const folders = [];   // the agent folder and every folder above, by given and resolved path
  const add = (d) => { if (d && !folders.includes(d)) folders.push(d); };
  for (const start of [path.resolve(dir), (() => { try { return fs.realpathSync.native(dir); } catch { return null; } })()]) {
    if (!start) continue;
    for (let d = start; ; d = path.dirname(d)) { add(d); if (path.dirname(d) === d) break; }
  }
  for (const h of homes) {
    for (const f of ['settings.json', 'settings.local.json', 'remote-settings.json']) out.push({ file: path.join(h, f), pick: whole });
  }
  for (const d of folders) {
    for (const f of ['settings.json', 'settings.local.json']) out.push({ file: path.join(d, '.claude', f), pick: whole });
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
    out.push({ file: path.join(md, 'managed-settings.json'), pick: whole }, { file: path.join(md, 'managed-mcp.json'), pick: whole });
    try { for (const f of fs.readdirSync(path.join(md, 'managed-settings.d')).filter((x) => x.endsWith('.json')).sort()) out.push({ file: path.join(md, 'managed-settings.d', f), pick: whole }); } catch { /* none */ }
  }
  return out;
}

/* Each installed plugin's folder, from each config home's record of installed plugins. */
function installedPluginDirs(homes) {
  const out = [];
  for (const h of homes) {
    for (const f of ['installed_plugins.json', 'installed_plugins_v2.json']) {
      const j = readJson(path.join(h, 'plugins', f));
      const plugins = j && j.plugins && typeof j.plugins === 'object' ? j.plugins : null;
      if (!plugins) continue;
      for (const entries of Object.values(plugins)) {
        for (const e of Array.isArray(entries) ? entries : [entries]) if (e && typeof e.installPath === 'string') out.push(path.resolve(e.installPath));
      }
    }
  }
  return [...new Set(out)];
}

/*
 * The scripts Claude Code's start-time commands run for the agent in `dir`.
 * Returns { files, pluginDirs, unsafe }: the script files (absolute, not yet resolved through links), the installed
 * plugin folders (whose own code runs, wherever they sit), and the commands whose script could not be worked out.
 */
function startCommandScripts(dir, { homes = [], home, ownHome = null, platform, managedDir: md } = {}) {
  const agentDir = path.resolve(dir);
  const files = [];
  const unsafe = [];
  const take = (cmds, vars, where) => {
    for (const c of cmds) {
      const r = pathsOfWords(wordsOf(c, vars), agentDir, vars);
      files.push(...r.paths);
      for (const u of r.unsafe) unsafe.push(`${u} (in ${where}: a command whose script path depends on something Kosmos cannot read)`);
    }
  };
  const baseVars = { HOME: home, CLAUDE_PROJECT_DIR: agentDir };
  if (ownHome) baseVars.CLAUDE_CONFIG_DIR = ownHome;
  for (const src of configSources(agentDir, homes, home, { platform, managedDir: md })) {
    const j = readJson(src.file);
    if (j === null) continue;
    const part = src.pick(j);
    if (part) take(commandsIn(part), baseVars, src.file);
  }
  const pluginDirs = installedPluginDirs(homes);
  for (const p of pluginDirs) {
    const vars = { ...baseVars, CLAUDE_PLUGIN_ROOT: p };
    for (const f of [path.join('.claude-plugin', 'plugin.json'), path.join('hooks', 'hooks.json'), '.mcp.json', '.lsp.json']) {
      const j = readJson(path.join(p, f));
      if (j !== null) take(commandsIn(j), vars, path.join(p, f));
    }
  }
  return { files: [...new Set(files)], pluginDirs, unsafe: [...new Set(unsafe)] };
}

module.exports = { startCommandScripts, shellWords, pathsOfWords, commandsIn, managedDir, HELPER_KEYS };
