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
 * folder, and on macOS the managed preferences, device-level and per-user), every server tier (each global config's own servers and its entries for the agent folder and the folders
 * above, the .mcp.json files, the managed server file), and each installed plugin's manifest and the hook, server and
 * language-server files it uses. Every config home is read, not only the agent's own: Kosmos can move an agent to
 * another account. A config file that exists but cannot be read is named, so the guard says it is not whole.
 *
 * What is a command: an object's `command`, and the helpers that run a script (apiKeyHelper, awsAuthRefresh,
 * awsCredentialExport, gcpAuthRefresh, otelHeadersHelper, proxyAuthHelper, headersHelper, and any later `...Helper`).
 * A server's command is a program started directly, with its args as literal words; any other command is a POSIX shell
 * line, split into words the way a shell would, enough to find paths (it is not a shell; the guard does not run on
 * Windows). The managed policyHelpers entries are read through their `command`; a script given inline in one is not
 * read. The settings `env` values are known variables when every tier that sets one agrees on it.
 *
 * Which words name a script. Where something RUNS: the program, the script after an interpreter (bash x.sh, deno run
 * x.ts, whether or not it exists yet, since the agent could create it), the script after a runner's flag (java -jar,
 * awk -f), input to a shell (bash < x.sh), a flag's path
 * value (--require=/x.js), a NAME=value before a program (BASH_ENV=/x.sh), the commands inside $(...), backticks, and
 * an interpreter's -c or -e, and a path inside a word (require('/x.js')). A program behind a wrapper (env, nohup,
 * timeout, if/then, { ... }) is the program. Anywhere else a path is an argument the program reads or writes, and it
 * counts only outside the agent folder: the agent's own files (jq . package.json) are its work, not code. An existing
 * FOLDER is never a script. A bare program is found on PATH, which #5516 part 1 covers. A word Kosmos cannot know is
 * named when it is where something runs, or an unquoted pattern in a path there (not the test command `[`), so the
 * guard says it is not whole.
 *
 * Not covered here (stated gaps, later parts of #5774): what a script or program runs or reads in turn (a script that
 * sources another, npm or make reading the agent folder's package.json or Makefile), the shell's own startup files,
 * environment settings that point a program at code, and hooks declared inside skills, agents and commands.
 */

const fs = require('fs');
const path = require('path');

const HELPER_KEYS = new Set(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper', 'headersHelper']);
/* The keys whose entries are servers, started directly rather than through a shell. */
const SERVER_KEYS = new Set(['mcpServers', 'lspServers', 'managedMcpServers']);
const OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);
/* Programs whose first plain argument is a script they run. */
const INTERPRETER = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|source|\.|node|nodejs|deno|bun|tsx|ts-node|ruby|perl|php|lua|Rscript|osascript|pwsh|python[0-9.]*)$/;
/* Runners whose script comes after a subcommand (deno run x.ts). */
const RUNNER_SUB = { deno: /^run$/, bun: /^(?:run|x)$/, uv: /^run$/, go: /^run$/ };
/* Words before the real program: it is the next word that is not a flag, a NAME=value or (for timeout) a duration. */
const WRAPPER = /^(?:env|exec|nohup|time|sudo|doas|g?timeout|nice|ionice|command|builtin|xargs|stdbuf|caffeinate|npx|pnpx|bunx|uvx|if|then|elif|else|while|until|do|!|\{)$/;
/* A wrapper's flags that take the next word as their value (sudo -u bob bash x.sh). */
const WRAPPER_VALUE_FLAGS = { sudo: /^-[ughpCDrtU]$/, doas: /^-[uC]$/, env: /^-[uCP]$/, timeout: /^-[sk]$/, gtimeout: /^-[sk]$/, nice: /^-n$/, ionice: /^-[cnp]$/, xargs: /^-[InPLdEs]$/ };
/* An interpreter's flags after which the next word is a script given inline, by interpreter (review 3: bash -p is not). */
function inlineFlag(prog, word) {
  if (/^(?:(?:ba|z|da|k|fi|c|tc)?sh|python[0-9.]*)$/.test(prog)) return /^-[A-Za-z]*c$/.test(word);
  if (/^(?:node|nodejs|bun|deno)$/.test(prog)) return /^(?:-e|--eval|-p|--print)$/.test(word);
  if (/^(?:perl|ruby|osascript|lua)$/.test(prog)) return /^-[eE]$/.test(word);
  if (prog === 'php') return word === '-r';
  if (prog === 'pwsh') return /^-(?:c|Command)$/i.test(word);
  return false;
}
/* Programs that run a script named after a flag (java -jar x.jar, awk -f x.awk), not given as their first argument. */
const SCRIPT_FLAG = { java: /^-jar$/, awk: /^-f$/, gawk: /^-f$/, mawk: /^-f$/, sed: /^-f$/, gsed: /^-f$/, jq: /^(?:-f|--from-file)$/, make: /^-f$/, gmake: /^-f$/, gdb: /^-x$/, vim: /^-S$/, nvim: /^-S$/ };

/* Where Claude Code 2.1.296 reads managed settings, by platform (its own switch, read from the binary). */
function managedDir(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  return '/etc/claude-code';
}

/* { json } for a readable JSON file, { missing: true } when there is none, { error } when it is there and unreadable. */
function readJsonFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { missing: true };
    return { error: (e && e.code) || String(e) };
  }
  try { return { json: JSON.parse(text) }; } catch { return { error: 'not valid JSON' }; }
}

/* A property list as JSON (plutil), in the same shape as readJsonFile. */
function readPlistFile(file) {
  try { fs.statSync(file); } catch (e) { return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? { missing: true } : { error: (e && e.code) || String(e) }; }
  try {
    const out = require('child_process').execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return { json: JSON.parse(out) };
  } catch { return { error: 'plutil could not convert it' }; }
}

/*
 * Split a command line into words, as a shell would, for finding paths. Quotes and backslashes are honoured; the
 * operators ; & | ( ) < > and newlines end a word. A variable is replaced when `vars` names it, otherwise the word is
 * marked dynamic. Each word records `head` (the first word of its simple command), `assign` (a NAME=value before it),
 * `written` (a redirection's target), `input` (a file given on standard input), `heredoc` (a here-document's delimiter
 * or a here-string), `globbed` (an unquoted * ? or [) and `subs` (the commands inside its $(...) and backticks).
 */
function shellWords(cmd, vars = {}) {
  const words = [];
  let cur = null;
  let head = true;
  let written = false;
  let input = false;
  let heredoc = false;
  const start = () => {
    if (cur) return;
    cur = { text: '', dynamic: false, quoted: false, globbed: false, head, written, input, heredoc, assign: false, subs: [] };
    written = false; input = false; heredoc = false;
  };
  const end = () => {
    if (!cur) return;
    const assign = cur.head && !cur.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(cur.text);
    if (assign) { cur.head = false; cur.assign = true; }
    words.push(cur);
    if (!assign && !cur.written && !cur.input && !cur.heredoc) head = false;
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
      if (c === '\\' && cmd[i + 1] === '\n') { i += 2; continue; }
      if (c === '$') { i = dollar(i); continue; }
      if (c === '`') { i = tick(i); continue; }
      cur.text += c; i++; continue;
    }
    if (c === '\\' && cmd[i + 1] === '\n') { end(); i += 2; continue; }   // a line continuation is a space
    if (c === "'" || c === '"') { start(); cur.quoted = true; quote = c; i++; continue; }
    if (c === '\\' && i + 1 < cmd.length) { start(); cur.text += cmd[i + 1]; i += 2; continue; }
    if (c === ' ' || c === '\t') { end(); i++; continue; }
    if (OPERATORS.has(c)) {
      if ((c === '>' || c === '<') && cur && !cur.quoted && !cur.dynamic && /^[0-9]+$/.test(cur.text)) cur = null;   // 2>: a descriptor, not a word
      end();
      const prevC = cmd[i - 1] || '';
      const nextC = cmd[i + 1] || '';
      if (c === '>') { written = true; input = false; }
      else if (c === '<' && nextC === '<') {   // <<EOF, <<-EOF, <<<word: the next word is not a file
        i += 2;
        if (cmd[i] === '<' || cmd[i] === '-') i++;
        heredoc = true;
        continue;
      } else if (c === '<') { input = true; written = false; }
      else if (c === '&' && prevC === '>') written = !/[0-9-]/.test(nextC);   // >&file writes it; 2>&1 joins outputs
      else if (c === '&' && nextC === '>') { /* &> and &>>: the redirection follows */ }
      else if (c === '|' && prevC === '>') written = true;   // >| writes, ignoring noclobber
      else { written = false; input = false; head = true; }
      i++; continue;
    }
    start();
    if (c === '$') { i = dollar(i); continue; }
    if (c === '`') { i = tick(i); continue; }
    if (c === '~' && cur.text === '' && !cur.quoted && (i + 1 === cmd.length || cmd[i + 1] === '/') && vars.HOME) { cur.text += vars.HOME; i++; continue; }
    if (c === '*' || c === '?' || c === '[') cur.globbed = true;
    cur.text += c; i++;
  }
  end();
  return words;
}

/* An absolute path inside a word that is not itself a path (require('/x.js'), --config=/x). */
const INNER_ABS = /(?:^|[^A-Za-z0-9_.~/$-])(\/[^\s'"`()<>;|&,]+)/g;

/*
 * The file paths a list of words names. `cwd` is where the command runs (the agent folder); `vars` are the variables
 * Kosmos knows. Returns { paths, unsafe }: candidate script paths (folders are filtered by startCommandScripts) and the
 * words whose value cannot be known.
 */
function pathsOfWords(words, cwd, vars = {}, depth = 0) {
  const paths = [];
  const runPaths = [];   // the subset named where something runs
  const unsafe = [];
  const more = (line) => {
    if (depth >= 3) return;
    const r = pathsOfWords(shellWords(line, vars), cwd, vars, depth + 1);
    paths.push(...r.paths); runPaths.push(...r.runPaths); unsafe.push(...r.unsafe);
  };
  let cwdReal = cwd;
  try { cwdReal = fs.realpathSync.native(cwd); } catch { /* as given */ }
  const inAgentFolder = (p) => [cwd, cwdReal].some((d) => p === d || p.startsWith(d + path.sep));
  let prog = '';
  let scriptSlot = false;   // the next plain word is the script the program (an interpreter) runs
  let runnerSub = null;     // deno run x.ts: the subcommand that keeps the script slot open
  let pendingHead = false;  // a wrapper came first; the program is still to come
  let durationNext = false; // timeout 5 node x.js
  let wrapper = '';         // the wrapper whose flags are being read
  let valueNext = false;    // the word after a wrapper's value flag is that flag's value
  let flagScriptNext = false;   // java -jar x.jar: the next word is the script
  let prev = '';
  for (const w of words) {
    const before = prev;
    prev = w.dynamic ? '' : w.text;
    for (const s of w.subs || []) more(s);   // the command inside $(...) or backticks runs too
    if (w.written || w.heredoc) continue;     // a redirection's target is written, not run; a delimiter is no file
    if (w.assign) { more(w.text.slice(w.text.indexOf('=') + 1)); continue; }   // BASH_ENV=/x.sh, NODE_OPTIONS=...
    if (w.head) { pendingHead = false; durationNext = false; flagScriptNext = false; }
    let isHead = w.head;
    if (pendingHead && !w.input) {
      if (valueNext) { valueNext = false; continue; }
      if (!w.dynamic && w.text.startsWith('-')) { valueNext = !!(WRAPPER_VALUE_FLAGS[wrapper] && WRAPPER_VALUE_FLAGS[wrapper].test(w.text)); continue; }   // a wrapper's own flag
      if (!w.dynamic && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { more(w.text.slice(w.text.indexOf('=') + 1)); continue; }   // env X=/y
      if (durationNext && /^[0-9.]+[smhd]?$/.test(w.text)) { durationNext = false; continue; }
      pendingHead = false; isHead = true;
    }
    if (isHead) {
      prog = w.dynamic ? '' : path.basename(w.text);
      if (!w.dynamic && WRAPPER.test(prog)) { pendingHead = true; durationNext = /timeout$/.test(prog); wrapper = prog; valueNext = false; continue; }
      scriptSlot = INTERPRETER.test(prog);
      runnerSub = RUNNER_SUB[prog] || null;
    }
    let text = w.text;
    const inline = !isHead && inlineFlag(prog, before);   // only an interpreter's -c or -e (mkdir -p is not)
    const isFlag = !isHead && !w.input && text.startsWith('-');
    const flagScript = flagScriptNext && !isHead && !isFlag;
    flagScriptNext = !isHead && !w.dynamic && !!(SCRIPT_FLAG[prog] && SCRIPT_FLAG[prog].test(text));
    // A flag that carries a path (--require=/x.js): the part after the first '='.
    const flagValue = isFlag && text.includes('=');
    if (flagValue) text = text.slice(text.indexOf('=') + 1);
    if (!isHead && !isFlag && !inline && !w.dynamic && runnerSub) {
      const sub = runnerSub; runnerSub = null;
      if (sub.test(text)) { scriptSlot = true; continue; }
      if (!INTERPRETER.test(prog)) scriptSlot = false;
    }
    const inScriptSlot = scriptSlot && !isHead && !isFlag && !inline && !w.input;
    if (inScriptSlot) scriptSlot = false;
    const runs = isHead || inScriptSlot || w.input || flagValue || inline || flagScript;   // where something RUNS
    if (w.dynamic) {
      // A flag's unknown value names a path only when it has a slash (--header="$H" names nothing).
      if (runs && (!flagValue || text.includes('/'))) unsafe.push(`a ${isHead ? 'program' : 'path'} made when the command runs${text.includes('/') ? ', ending ' + text.slice(text.lastIndexOf('/')) : ''}`);
      continue;
    }
    if (inline) { scriptSlot = false; more(text); for (const m of text.matchAll(INNER_ABS)) paths.push(path.normalize(m[1])); continue; }
    if (!text || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) continue;   // a URL is not a file
    // A pattern counts where it names a path or a script; `[` and `[[` as the program are the test command (review 3).
    if (w.globbed && runs && (text.includes('/') || !isHead)) { unsafe.push(`a pattern where a script is named (${text}), which Kosmos does not expand`); continue; }
    let p = null;
    if (path.isAbsolute(text)) p = /^\/dev(\/|$)/.test(text) ? null : path.normalize(text);
    else if (/^\.{0,2}\//.test(text) || (text.includes('/') && (runs || w.quoted || !/['"()=,:]/.test(text)))) p = path.resolve(cwd, text);   // a quoted or run-position word is the path itself
    else if (text.includes('/')) { for (const m of text.matchAll(INNER_ABS)) paths.push(path.normalize(m[1])); continue; }
    else if (runs && !isHead) p = path.join(cwd, text);   // bash check.sh: the agent could create it
    if (!p) continue;
    if (!runs && inAgentFolder(p)) continue;   // an argument in the agent's own folder is its work, not code
    paths.push(p);
    if (runs) runPaths.push(p);
  }
  return { paths, runPaths, unsafe };
}

/* Every command in a parsed config: { line } for a shell line, { program, args } for a server (started directly). */
function commandsIn(node, out = [], depth = 0, server = false) {
  if (!node || typeof node !== 'object' || depth > 32) return out;
  if (Array.isArray(node)) { for (const x of node) commandsIn(x, out, depth + 1, server); return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'command' && typeof v === 'string') {
      const args = Array.isArray(node.args) ? node.args.filter((a) => typeof a === 'string') : null;
      if (server || args) out.push({ program: v, args: args || [] });
      else out.push({ line: v });
    } else if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) {
      out.push({ line: v });
    } else if (v && typeof v === 'object') {
      commandsIn(v, out, depth + 1, server || SERVER_KEYS.has(k));
    }
  }
  return out;
}

/* The words of one command. A server's command and args are literal words (no shell), with ${VAR} expanded. */
function wordsOf(cmd, vars) {
  if (cmd.line !== undefined) return shellWords(cmd.line, vars);
  const one = (s, head) => {
    const ws = shellWords(`"${s.replace(/(["\\`])/g, '\\$1')}"`, vars);
    const w = ws[0] || { text: '', dynamic: false, subs: [] };
    return { ...w, head, assign: false, written: false, input: false, heredoc: false, globbed: false };
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
  let own = [path.resolve(dir)];
  try { own = [...own, fs.realpathSync.native(dir)]; } catch { /* as given */ }
  for (const h of homes) {
    for (const f of ['settings.json', 'settings.local.json', 'remote-settings.json']) out.push({ file: path.join(h, f), pick: whole, settings: true });
  }
  for (const d of folders) {
    // The agent folder's own two settings files (by either path) are rewritten by the guard itself (an unreadable one
    // is kept as a dated copy and replaced, #4491 review 18), so their old text never loads: unreadable there is not a gap.
    for (const f of ['settings.json', 'settings.local.json']) out.push({ file: path.join(d, '.claude', f), pick: whole, settings: true, rewritten: own.includes(d) });
    out.push({ file: path.join(d, '.mcp.json'), pick: whole });
  }
  /* The global config: its own servers, and its project entries for the agent folder and the folders above (never
     the whole file: it holds every project on the computer). */
  const globals = [...(home ? [path.join(home, '.claude.json')] : []), ...homes.map((h) => path.join(h, '.claude.json')), ...homes.map((h) => path.join(h, '.config.json'))];
  const pickGlobal = (j) => {
    if (!j || typeof j !== 'object') return null;
    // Only its servers and helpers (review 3): the rest of the file is runtime state, cached feature config included.
    const own = { mcpServers: j.mcpServers };
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) own[k] = v;
    const projects = j.projects;
    const mine = projects && typeof projects === 'object' ? folders.map((d) => projects[d]).filter(Boolean) : [];
    return [own, ...mine];
  };
  for (const g of [...new Set(globals)]) out.push({ file: g, pick: pickGlobal });
  const md = deps.managedDir !== undefined ? deps.managedDir : managedDir(platform);
  if (md) {
    out.push({ file: path.join(md, 'managed-settings.json'), pick: whole, settings: true }, { file: path.join(md, 'managed-mcp.json'), pick: whole });
    try { for (const f of fs.readdirSync(path.join(md, 'managed-settings.d')).filter((x) => x.endsWith('.json')).sort()) out.push({ file: path.join(md, 'managed-settings.d', f), pick: whole, settings: true }); } catch { /* none */ }
  }
  /* Review 3: on macOS, managed preferences (MDM), device-level and per-user, which 2.1.296 reads through plutil. */
  const prefs = deps.managedPrefsDir !== undefined ? deps.managedPrefsDir : (platform === 'darwin' ? '/Library/Managed Preferences' : null);
  if (prefs) {
    let user = null;
    try { user = require('os').userInfo().username; } catch { user = null; }
    for (const f of [path.join(prefs, 'com.anthropic.claudecode.plist'), ...(user ? [path.join(prefs, user, 'com.anthropic.claudecode.plist')] : [])]) out.push({ file: f, pick: whole, settings: true, plist: true });
  }
  return out;
}

/* Each installed plugin, from each config home's record of installed plugins: { dir, home, id }. A record that cannot
   be read, or an install path that is not absolute, is named in `unsafe`. */
function installedPlugins(homes, unsafe) {
  const out = [];
  const seen = new Set();
  for (const h of homes) {
    for (const f of ['installed_plugins.json', 'installed_plugins_v2.json']) {
      const file = path.join(h, 'plugins', f);
      const r = readJsonFile(file);
      if (r.error) { unsafe.push(`${file} (could not be read: ${r.error}), so its plugins are unknown`); continue; }
      const plugins = r.json && r.json.plugins && typeof r.json.plugins === 'object' ? r.json.plugins : null;
      if (!plugins) continue;
      for (const [id, entries] of Object.entries(plugins)) {
        for (const e of Array.isArray(entries) ? entries : [entries]) {
          if (!e || typeof e.installPath !== 'string') continue;
          if (!path.isAbsolute(e.installPath)) { unsafe.push(`the plugin ${id} (its folder is not a full path: ${JSON.stringify(e.installPath)})`); continue; }
          const dir = path.normalize(e.installPath);
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
  const manifest = readJsonFile(files[0]).json;
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
 * Returns { files, runFiles, pluginDirs, unsafe }: the script files (absolute, not yet resolved through links; never an existing
 * folder; runFiles are those named where something runs), the installed plugin folders (whose own code runs, wherever they sit; never the agent folder, a folder above
 * it or the home), and what could not be worked out.
 */
function startCommandScripts(dir, { homes = [], home, ownHome = null, platform, managedDir: md, managedPrefsDir } = {}) {
  const agentDir = path.resolve(dir);
  const raw = [];
  const runRaw = new Set();
  const unsafe = [];
  const sources = [];
  for (const s of configSources(agentDir, homes, home, { platform, managedDir: md, managedPrefsDir })) {
    const r = s.plist ? readPlistFile(s.file) : readJsonFile(s.file);
    if (r.error) { if (!s.rewritten) unsafe.push(`${s.file} (could not be read: ${r.error}), so the commands in it are unknown`); }
    else if (!r.missing) sources.push({ ...s, json: r.json });
  }
  /* The settings env, which hooks see: a variable every tier that sets it agrees on is known; one set two ways, or to
     something other than a string, is not. */
  const envValues = new Map();
  for (const s of sources.filter((x) => x.settings)) {
    const env = s.json && typeof s.json.env === 'object' && s.json.env ? s.json.env : {};
    for (const [k, v] of Object.entries(env)) {
      if (!envValues.has(k)) envValues.set(k, new Set());
      envValues.get(k).add(typeof v === 'string' ? v : '\0not a string');
    }
  }
  const settingsEnv = {};
  for (const [k, vs] of envValues) if (vs.size === 1 && !vs.has('\0not a string')) settingsEnv[k] = [...vs][0];
  // Shell variables for reading the commands, not an environment for a child (so not engine/win32env.js's business).
  const baseVars = { ...settingsEnv, ...(home ? { HOME: home } : {}), CLAUDE_PROJECT_DIR: agentDir, ...(ownHome ? { CLAUDE_CONFIG_DIR: ownHome } : {}) };
  const take = (cmds, vars, where) => {
    for (const c of cmds) {
      const r = pathsOfWords(wordsOf(c, vars), agentDir, vars);
      raw.push(...r.paths);
      for (const p of r.runPaths) runRaw.add(p);
      for (const u of r.unsafe) unsafe.push(`${u} (in ${where}: a command whose script Kosmos cannot read)`);
    }
  };
  for (const s of sources) {
    const part = s.pick(s.json);
    if (part) take(commandsIn(part), baseVars, s.file);
  }
  /* A plugin folder is denied whole, so one that is the agent folder, a folder above it, the home or a config home would
     take the agent's own work away: named instead. */
  const never = new Set([...foldersFrom(agentDir), ...(home ? [path.resolve(home)] : []), ...homes.map((h) => path.resolve(h))]);
  const realOf = (d) => { try { return fs.realpathSync.native(d); } catch { return d; } };
  for (const d of [...never]) never.add(realOf(d));
  const plugins = installedPlugins(homes, unsafe).filter((p) => {
    if (!never.has(p.dir) && !never.has(realOf(p.dir))) return true;   // review 3: by its resolved path too, and never a config home
    unsafe.push(`the plugin ${p.id} (its folder ${p.dir} holds the agent's own work or a config home, so Kosmos does not deny it whole)`);
    return false;
  });
  for (const p of plugins) {
    const vars = { ...baseVars, CLAUDE_PLUGIN_ROOT: p.dir, CLAUDE_PLUGIN_DATA: path.join(p.home, 'plugins', 'data', p.id.replace(/[^a-zA-Z0-9\-_]/g, '-')) };
    for (const f of pluginConfigFiles(p.dir)) {
      const r = readJsonFile(f);
      if (r.error) unsafe.push(`${f} (could not be read: ${r.error}), so the commands in it are unknown`);
      else if (!r.missing) take(commandsIn(r.json), vars, f);
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
  return { files, runFiles: files.filter((f) => runRaw.has(f)), pluginDirs: [...new Set(plugins.map((p) => p.dir))], unsafe: [...new Set(unsafe)] };
}

module.exports = { startCommandScripts, shellWords, pathsOfWords, commandsIn, managedDir, HELPER_KEYS };
