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
 * above, the .mcp.json files, the managed server file), and each installed plugin's manifest and the hook, server,
 * language-server and monitor files it uses. Every config home is read, not only the agent's own: Kosmos can move an agent to
 * another account. A config file that exists but cannot be read is named, so the guard says it is not whole.
 *
 * What is a command: an object's `command`, and the helpers that run a script (apiKeyHelper, awsAuthRefresh,
 * awsCredentialExport, gcpAuthRefresh, otelHeadersHelper, proxyAuthHelper, headersHelper, and any later `...Helper`).
 * A server's command is a program started directly, with its args as literal words; any other command is a POSIX shell
 * line, split into words the way a shell would, enough to find paths (it is not a shell; the guard does not run on
 * Windows). The managed policyHelpers entries are read through their `command`; a script given inline in one is not
 * read. The settings `env` values are known variables when every tier that sets one agrees on it.
 *
 * Which words name a script. Where something RUNS: the program, every plain word after an interpreter (bash x.sh, deno run
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
 * sources another, a program not in the folder-runner list reading the folder it runs in), the shell's own startup files,
 * environment settings that point a program at code, and hooks declared inside skills, agents and commands.
 */

const fs = require('fs');
const path = require('path');

/* #5516 part 2: the names Claude Code 2.1.296 gives its global config file, `.claude${suffix}.json` (the suffix comes
   from its OAuth environment; production's is empty). Read from the installed binary, so a new suffix in a later
   version is a gap until added here. One list, used here and by the guard (engine/setup-assistant.js). */
const CLAUDE_GLOBAL_CONFIG_SUFFIXES = ['', '-staging-oauth', '-local-oauth', '-custom-oauth'];
const runnerSay = (name, place) => `${name} run in ${place} (it runs code that folder supplies: its package.json, node_modules, Makefile, .git hooks, build or test config, which Kosmos cannot list); change the command to run a script by its full path`;
/* Where a command runs when a cd Kosmos cannot follow moved it. */
const UNKNOWN_RUN_CWD = '/\0unknown';
/* System folders macOS seals (SIP): nothing the agent runs can write there, so a path in them needs no deny rule. Not
   /usr/local, which is writable. */
const SEALED = /^\/(?:System|bin|sbin|usr\/(?:bin|sbin|lib|libexec|share))\//;
/* What $PATH reads as here: a marker, so `PATH="$HOME/bin:$PATH"` is read as one known folder and the rest. */
const PATH_MARK = '\u0000PATH';
// Review 9: processWrapper too (2.1.296's own list of command settings: a launcher prefix for background sessions).
const HELPER_KEYS = new Set(['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper', 'headersHelper', 'processWrapper']);
/* The keys whose entries are servers, started directly rather than through a shell. */
const SERVER_KEYS = new Set(['mcpServers', 'lspServers', 'managedMcpServers']);
const OPERATORS = new Set([';', '&', '|', '(', ')', '<', '>', '\n']);
/* Programs whose first plain argument is a script they run. */
const INTERPRETER = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|source|\.|node|nodejs|deno|bun|tsx|ts-node|ruby|perl|php|lua|Rscript|osascript|pwsh|python[0-9.]*)$/;
/* Runners whose script comes after a subcommand (deno run x.ts). */
const RUNNER_SUB = { deno: /^run$/, bun: /^(?:run|x)$/, uv: /^run$/, go: /^run$/ };
/* Review 8: a runner's word that is no file (bun start, bun test, deno task, uv run hook, uv sync) names a script or
   task in package.json, deno.json or pyproject.toml, which is the folder's own code. */
const PACKAGE_SCRIPT_RUNNER = /^(?:bun|deno|uv)$/;
/* Words before the real program: it is the next word that is not a flag, a NAME=value or (for timeout) a duration. */
const WRAPPER = /^(?:arch|env|exec|nohup|time|sudo|doas|g?timeout|nice|ionice|command|builtin|xargs|stdbuf|caffeinate|npx|pnpx|bunx|uvx|watch|parallel|setsid|chronic|flock|script|export|if|then|elif|else|while|until|do|!|\{)$/;
/* Review 6: a word with a script's file extension is code wherever it sits in the command, so an unlisted wrapper
   (some-runner hook.sh) cannot hide it. */
const SCRIPT_EXT = /\.(?:sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|pl|php|lua|ps1|jar|awk|scpt|applescript|swift|kts)$/i;
/* Review 7: a runner's own change-folder flag, which moves where it runs (uv --directory /x run s.py, make -C /x). */
const CHDIR_FLAGS = { uv: /^--directory$/, make: /^-C$/, gmake: /^-C$/, npm: /^--prefix$/, pnpm: /^(?:-C|--dir)$/, yarn: /^--cwd$/, bun: /^--cwd$/, git: /^-C$/, go: /^-C$/ };
/* Review 6: programs that run code the folder they run in supplies (package.json scripts and node_modules, a Makefile,
   build scripts, test configs, git hooks). Run in the agent folder, that code is the agent's, so Kosmos names it. */
/* Review 17: and the formatters, linters and build tools that load config CODE from the folder (eslint.config.js,
   prettier.config.js, .envrc, Gemfile, Package.swift, mypy plugins...). The list is partial; see the plan's gaps. */
const FOLDER_RUNNER = /^(?:npm|pnpm|yarn|npx|pnpx|bunx|make|gmake|just|rake|cargo|mvn|gradle|git|pytest|tox|jest|vitest|eslint|prettier|stylelint|pre-commit|lint-staged|husky|direnv|bundle|rails|rspec|poetry|pdm|hatch|mypy|dotnet|tsc|swift|composer|phpunit|gulp|grunt|webpack|vite|next|nx|turbo|lerna)$/;
/* A wrapper's flags that take the next word as their value (sudo -u bob bash x.sh). */
const WRAPPER_VALUE_FLAGS = { sudo: /^-[ughpCDrtU]$/, doas: /^-[uC]$/, env: /^-[uCP]$/, timeout: /^-[sk]$/, gtimeout: /^-[sk]$/, nice: /^-n$/, ionice: /^-[cnp]$/, xargs: /^-[InPLdEs]$/, watch: /^-n$/, parallel: /^-[jS]$/, flock: /^-[wE]$/, exec: /^-a$/ };
/* A program's own flags that take the next word as a value, so it is not the script (review 4). */
const VALUE_FLAGS = {
  uv: /^(?:--with|--with-requirements|--python|-p|--from|--project|--env-file|--extra|--group|--index|--package)$/,
  deno: /^(?:--config|-c|--import-map|--env-file|--lock|--location|--cert)$/, bun: /^(?:--env-file|--config|-c)$/,
  bash: /^-[oO]$/, sh: /^-[oO]$/, zsh: /^-[oO]$/, ruby: /^-[Ir]$/, perl: /^-[IM]$/, osascript: /^-l$/, tsx: /^--tsconfig$/,
  python: /^-[XWm]$/, python3: /^-[XWm]$/, node: /^(?:--env-file|--inspect-port|--title)$/,
};
/* python -m mod: a module, not a script file (a module in the agent folder is a stated gap). */
const MODULE_FLAG = /^python[0-9.]* -m$/;
/* A package name (npx @scope/pkg), not a path. */
const PACKAGE_NAME = /^@[\w.-]+\/[\w.-]+(?:@\S*)?$/;
/* An interpreter's flags after which the next word is a script given inline, by interpreter (review 3: bash -p is not). */
function inlineFlag(prog, word) {
  if (/^(?:(?:ba|z|da|k|fi|c|tc)?sh)$/.test(prog)) return /^-[A-Za-z]*c[A-Za-z]*$/.test(word);   // review 5: -ce too
  if (/^python[0-9.]*$/.test(prog)) return /^-[A-Za-z]*c$/.test(word);
  if (/^(?:node|nodejs|bun|deno)$/.test(prog)) return /^(?:-e|--eval|-p|--print)$/.test(word);
  if (/^(?:perl|ruby)$/.test(prog)) return /^-[A-Za-z]*[eE]$/.test(word);   // review 9: -pe, -ne, -lne
  if (/^(?:osascript|lua)$/.test(prog)) return word === '-e';
  if (prog === 'php') return word === '-r';
  if (prog === 'pwsh') return /^-(?:c|Command)$/i.test(word);
  return false;
}
/* Programs that run a script named after a flag (java -jar x.jar, awk -f x.awk), not given as their first argument. */
const SCRIPT_FLAG = { node: /^(?:-r|--require|--import|--loader|--experimental-loader)$/, bun: /^(?:-r|--preload)$/, java: /^(?:-jar|-cp|-classpath|--class-path)$/, awk: /^-f$/, gawk: /^-f$/, mawk: /^-f$/, sed: /^-f$/, gsed: /^-f$/, jq: /^(?:-f|--from-file)$/, make: /^-f$/, gmake: /^-f$/, gdb: /^-x$/, vim: /^-S$/, nvim: /^-S$/ };

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
  text = text.replace(/^\uFEFF/, '');
  if (!text.trim()) return { json: {} };   // review 4: an empty file holds nothing (Claude Code reads it as no settings)
  try { return { json: JSON.parse(text) }; } catch { /* once more: a file caught mid-write by its writer (review 10) */ }
  try { return { json: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; } catch { return { error: 'not valid JSON' }; }
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
  let heredocMode = null;   // 'body' (<<), 'dash' (<<-) or 'string' (<<<)
  const bodies = [];        // here-document delimiters waiting for their body, which starts at the next newline
  const start = () => {
    if (cur) return;
    cur = { text: '', dynamic: false, quoted: false, globbed: false, assignable: false, head, written, input, heredoc, heredocMode, assign: false, subs: [] };
    written = false; input = false; heredoc = false; heredocMode = null;
  };
  const end = () => {
    if (!cur) return;
    // Review 5: an assignment is NAME= with the name unquoted; its value may be quoted (FOO="1" bash x.sh).
    const assign = cur.head && cur.assignable;
    if (assign) { cur.head = false; cur.assign = true; }
    words.push(cur);
    if (cur.heredoc && cur.heredocMode !== 'string') bodies.push(cur);
    if (cur.written || cur.input || cur.heredoc) cur.head = false;   // review 13: < state.json jq: the program comes after
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
      // ${VAR} and, review 5, ${VAR:-default} / ${VAR-default}: the value when Kosmos knows it (set, so no default).
      const plain = name && (name[0] === inner || /^:?-/.test(inner.slice(name[0].length)));
      return [plain && known(name[0]) ? vars[name[0]] : null, close + 1, null];
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
    if (c === '\\' && cmd[i + 1] === '\n') { i += 2; continue; }   // a line continuation is deleted (ba\<newline>sh is bash)
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
        heredocMode = cmd[i] === '<' ? 'string' : cmd[i] === '-' ? 'dash' : 'body';
        if (cmd[i] === '<' || cmd[i] === '-') i++;
        heredoc = true;
        continue;
      } else if (c === '<') { input = true; written = false; }
      else if (c === '&' && prevC === '>') written = !/[0-9-]/.test(nextC);   // >&file writes it; 2>&1 joins outputs
      else if (c === '&' && nextC === '>') { /* &> and &>>: the redirection follows */ }
      else if (c === '|' && prevC === '>') written = true;   // >| writes, ignoring noclobber
      else { written = false; input = false; head = true; }
      if (c === '\n' && bodies.length) {
        // Review 6: a here-document's body runs to its delimiter line; it is the delimiter word's body, not commands.
        let j = i + 1;
        for (const w of bodies) {
          const lines = [];
          while (j < cmd.length) {
            let nl = cmd.indexOf('\n', j);
            if (nl < 0) nl = cmd.length;
            const line = cmd.slice(j, nl);
            j = nl + 1;
            if ((w.heredocMode === 'dash' ? line.replace(/^\t+/, '') : line) === w.text) break;
            lines.push(line);
          }
          w.body = lines.join('\n');
        }
        bodies.length = 0;
        i = j;
        continue;
      }
      i++; continue;
    }
    if (c === '#' && !cur) {   // review 6: a comment runs to the end of the line (an apostrophe in it opens no quote)
      const nl = cmd.indexOf('\n', i);
      i = nl < 0 ? cmd.length : nl;
      continue;
    }
    // Review 9: $'...' (ANSI-C, backslash escapes) and $"..." (a double-quoted string) are quotes, not variables.
    if (c === '$' && cmd[i + 1] === "'") {
      start(); cur.quoted = true;
      let j = i + 2;
      while (j < cmd.length && cmd[j] !== "'") { if (cmd[j] === '\\' && j + 1 < cmd.length) { cur.text += cmd[j + 1]; j += 2; } else { cur.text += cmd[j]; j++; } }
      if (j >= cmd.length) quote = "'";   // never closed
      i = j + 1; continue;
    }
    if (c === '$' && cmd[i + 1] === '"') { start(); cur.quoted = true; quote = '"'; i += 2; continue; }
    start();
    if (c === '$') { i = dollar(i); continue; }
    if (c === '`') { i = tick(i); continue; }
    // ~ at a word's start, and (review 8) after the = or a : of an assignment (PATH=~/bin:~/x), is the home.
    if (c === '~' && (cur.text === '' || (cur.assignable && /[=:]$/.test(cur.text))) && !cur.quoted && (i + 1 === cmd.length || /[/:]/.test(cmd[i + 1])) && vars.HOME) { cur.text += vars.HOME; i++; continue; }
    if (c === '*' || c === '?' || c === '[') cur.globbed = true;
    if (c === '=' && !cur.quoted && !cur.assignable && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cur.text)) cur.assignable = true;
    cur.text += c; i++;
  }
  end();
  if (quote) words.unterminated = true;   // review 6: where the command ends is unknown
  return words;
}

/* An absolute path inside a word that is not itself a path (require('/x.js'), --config=/x). */
const INNER_ABS = /(?:^|[^A-Za-z0-9_.~/$-])(\/[^\s'"`()<>;|&,]+)/g;

/*
 * The file paths a list of words names. `cwd` is where the command runs (the agent folder); `vars` are the variables
 * Kosmos knows. Returns { paths, unsafe }: candidate script paths (folders are filtered by startCommandScripts) and the
 * words whose value cannot be known.
 */
function pathsOfWords(words, cwd, vars = {}, depth = 0, cwdsIn = null, anchoredIn = true, deferRunners = false) {
  const paths = [];
  const runPaths = [];   // the subset named where something runs
  const runners = [];    // folder runners: { name, where, place }
  const unsafe = [];
  /* Review 4: the folders this line may be in. `cd` (pushd) moves it, and a relative path is read from every folder
     seen so far (a subshell's cd is not undone, so this over-counts rather than misses); a cd Kosmos cannot follow
     makes a relative script unknowable. */
  const cwds = cwdsIn ? [...cwdsIn] : [cwd];
  let cwdUnknown = false;
  /* Review 11: a hook or status line runs in the session's CURRENT folder (2.1.296 passes the session's cwd), which the
     agent moves with cd into any folder inside its own. So until the line cd's somewhere absolute, a relative script
     could be one the agent made in any subfolder: it is named. A server runs in the project folder (anchored). */
  let anchored = anchoredIn;
  let lastCwd = cwds[cwds.length - 1];   // where the line most recently cd'd to
  const pathDirs = [];   // review 6: folders a PATH= assignment put in front, where a bare program is then found
  const codePaths = [];  // review 7: the paths in an interpreter's code position, where a folder is code too
  const UNKNOWN_CWD = UNKNOWN_RUN_CWD;
  const more = (line) => {
    if (depth >= 3) { unsafe.push('commands nested too deep for Kosmos to read'); return; }   // review 8: named, not dropped
    const r = pathsOfWords(shellWords(line, vars), cwd, vars, depth + 1, cwds, anchored, deferRunners);
    paths.push(...r.paths); runPaths.push(...r.runPaths); codePaths.push(...r.codePaths); runners.push(...(r.runners || [])); unsafe.push(...r.unsafe);
  };
  let cwdReal = cwd;
  try { cwdReal = fs.realpathSync.native(cwd); } catch { /* as given */ }
  const inAgentFolder = (p) => [cwd, cwdReal].some((d) => p === d || p.startsWith(d + path.sep));
  if (words.unterminated) unsafe.push('a quote that is never closed, so where the command ends is unknown');
  const assignment = (w, t) => {
    const name = t.slice(0, t.indexOf('='));
    const value = t.slice(t.indexOf('=') + 1);
    if (name !== 'PATH') { more(value); return; }
    if (w.dynamic) { unsafe.push('a PATH made when the command runs'); return; }
    for (const c of value.split(':')) {
      if (!c || c === PATH_MARK) continue;
      for (const d of cwds) { const r = path.resolve(d, c); if (!pathDirs.includes(r)) pathDirs.push(r); }
    }
  };
  /* Review 7: decided at the end of the command, so a change-folder flag on it counts; a folder Kosmos cannot follow
     may be the agent's. */
  let runnerPending = null;
  let cmdCwd = null;   // where this one command runs, when a change-folder flag moved it
  const flushRunner = () => {
    /* Review 15: wherever it runs. In another folder it runs THAT folder's package.json, Makefile, .git hooks or test
       config, which the agent's tools can rewrite there just as well, so it is named everywhere, not only in the agent
       folder; Kosmos cannot list every file such a program may read. */
    const where = cmdCwd || lastCwd;
    const place = where === UNKNOWN_CWD ? 'a folder Kosmos cannot read' : inAgentFolder(where) ? 'the agent folder' : where;
    // Decided by startCommandScripts, which knows the folders the guard denies whole (a plugin's own folder is covered).
    if (runnerPending && deferRunners) runners.push({ name: runnerPending, where, place });
    else if (runnerPending) unsafe.push(runnerSay(runnerPending, place));
    runnerPending = null;
  };
  const folderRunner = (name) => { if (!runnerPending) runnerPending = name; };
  const chdir = (w, t) => {
    if (w.dynamic) { cwdUnknown = true; cmdCwd = UNKNOWN_CWD; return; }
    for (const d of [...cwds]) { const r = path.resolve(d, t); if (!cwds.includes(r)) cwds.push(r); }
    cmdCwd = path.resolve(cmdCwd && cmdCwd !== UNKNOWN_CWD ? cmdCwd : lastCwd, t);
  };
  let chdirNext = false;
  let trapDone = false;   // trap's command line has been read
  let inlineProgDone = false;   // awk's or sed's program text has been read
  let packageScriptNext = false;   // bun run <name>: a package.json script when <name> is no file
  let slotTaken = false;   // the first plain word after an interpreter is its script (or the folder it runs)
  let prog = '';
  let scriptSlot = false;   // the next plain word is the script the program (an interpreter) runs
  let runnerSub = null;     // deno run x.ts: the subcommand that keeps the script slot open
  let pendingHead = false;  // a wrapper came first; the program is still to come
  let durationNext = false; // timeout 5 node x.js
  let wrapper = '';         // the wrapper whose flags are being read
  let valueNext = false;    // the word after a wrapper's value flag is that flag's value
  let splitNext = false;    // env -S "bash x.sh": the next word is a command line
  let flagScriptNext = false;   // java -jar x.jar: the next word is the script
  let skipNext = false;     // a program's flag that takes a value (uv run --with x, python -X utf8)
  let cdNext = false;       // the word after cd is the folder it moves to
  let inExec = false;       // find ... -exec cmd ... ;
  let prev = '';
  for (const w of words) {
    const before = prev;
    prev = w.dynamic ? '' : w.text;
    for (const s of w.subs || []) more(s);   // the command inside $(...) or backticks runs too
    if (w.written) continue;     // a redirection's target is written, not run
    if (w.heredoc) {   // a delimiter is no file; a here-document given to a shell IS its script (review 6)
      if (w.heredocMode === 'string' && !w.dynamic && /^(?:(?:ba|z|da|k|fi|c|tc)?sh)$/.test(prog)) more(w.text);   // bash <<< "cmd" (review 10)
      else if (w.heredocMode === 'string' && w.dynamic && /^(?:(?:ba|z|da|k|fi|c|tc)?sh)$/.test(prog)) unsafe.push('a here-string given to a shell, made when the command runs');
      if (typeof w.body === 'string' && /^(?:(?:ba|z|da|k|fi|c|tc)?sh)$/.test(prog)) more(w.body);
      else if (typeof w.body === 'string' && INTERPRETER.test(prog)) for (const m of w.body.matchAll(INNER_ABS)) { paths.push(path.normalize(m[1])); runPaths.push(path.normalize(m[1])); }
      continue;
    }
    if (w.assign) { assignment(w, w.text); continue; }   // BASH_ENV=/x.sh, NODE_OPTIONS=..., PATH=...
    if (w.head) { flushRunner(); cmdCwd = null; chdirNext = false; trapDone = false; inlineProgDone = false; packageScriptNext = false; slotTaken = false; pendingHead = false; durationNext = false; flagScriptNext = false; skipNext = false; splitNext = false; inExec = false; }
    if (cdNext) {
      cdNext = false;
      if (w.head) { if (vars.HOME) { cwds.push(vars.HOME); lastCwd = vars.HOME; anchored = true; } }   // a bare cd goes home
      else if (w.dynamic || w.text === '-') { cwdUnknown = true; lastCwd = UNKNOWN_CWD; continue; }
      else if (!w.text.startsWith('-')) { for (const d of [...cwds]) { const t = path.resolve(d, w.text); if (!cwds.includes(t)) cwds.push(t); } lastCwd = path.resolve(lastCwd, w.text); if (path.isAbsolute(w.text)) anchored = true; continue; }
      else { cdNext = true; continue; }   // cd -P dir
    }
    let isHead = w.head;
    if (pendingHead && !w.input) {
      if (splitNext) { splitNext = false; pendingHead = false; more(w.text); continue; }
      if (valueNext) { valueNext = false; continue; }
      if (!w.dynamic && wrapper === 'env' && /^(?:-S|--split-string)$/.test(w.text)) { splitNext = true; continue; }
      if (!w.dynamic && wrapper === 'env' && w.text.startsWith('--split-string=')) { pendingHead = false; more(w.text.slice(w.text.indexOf('=') + 1)); continue; }
      if (!w.dynamic && w.text.startsWith('-')) {   // a wrapper's own flag
        // Review 15: a wrapper flag's =value that is a path (uvx --from=/src tool) is code the program comes from.
        const eq = w.text.indexOf('=');
        if (eq > 0 && /\//.test(w.text.slice(eq + 1))) { const p = path.resolve(cwds[0], w.text.slice(eq + 1)); paths.push(p); runPaths.push(p); codePaths.push(p); }
        valueNext = !!(WRAPPER_VALUE_FLAGS[wrapper] && WRAPPER_VALUE_FLAGS[wrapper].test(w.text));
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { assignment(w, w.text); continue; }   // env X=/y, export PATH=...
      if (wrapper === 'flock' && !w.dynamic && durationNext) { durationNext = false; continue; }   // flock's lock file
      if (wrapper === 'script' && !w.dynamic && before === '-c') { pendingHead = false; more(w.text); continue; }
      if (durationNext && /^[0-9.]+[smhd]?$/.test(w.text)) { durationNext = false; continue; }
      pendingHead = false; isHead = true;
    }
    if (inExec && !w.dynamic && (w.text === ';' || w.text === '+')) { inExec = false; prog = 'find'; scriptSlot = false; runnerSub = null; continue; }
    if (isHead) {
      prog = w.dynamic ? '' : path.basename(w.text);
      if (!w.dynamic && (prog === 'cd' || prog === 'pushd')) { cdNext = true; continue; }
      if (!w.dynamic && WRAPPER.test(prog)) { if (FOLDER_RUNNER.test(prog)) folderRunner(prog); pendingHead = true; durationNext = /timeout$|^flock$/.test(prog); wrapper = prog; valueNext = false; continue; }
      if (!w.dynamic && FOLDER_RUNNER.test(prog)) folderRunner(prog);
      // A bare program after PATH=dir: found in that folder first.
      if (!w.dynamic && !w.text.includes('/')) for (const d of pathDirs) { const p = path.join(d, w.text); paths.push(p); runPaths.push(p); }
      scriptSlot = INTERPRETER.test(prog);
      runnerSub = RUNNER_SUB[prog] || null;
    }
    // Review 14: trap's first argument is a command line run later (trap '~/h/clean.sh' EXIT).
    if (!isHead && prog === 'trap' && !w.dynamic && !trapDone) { trapDone = true; if (!w.text.startsWith('-')) more(w.text); continue; }
    if (!isHead && prog === 'find' && !w.dynamic && /^-(?:exec|execdir|ok|okdir)$/.test(w.text)) { inExec = true; pendingHead = true; wrapper = ''; continue; }
    // Review 13: a value flag's value that looks like a file (node --env-file ~/.env, ruby -r /h/pre.rb) is code the
    // program loads, as the --flag=value spelling already counts; any other value (python -X utf8) is skipped.
    let valueCode = false;
    if (skipNext) {
      skipNext = false;
      if (w.dynamic || !(w.text.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(w.text))) continue;
      valueCode = true;
    }
    if (chdirNext) { chdirNext = false; chdir(w, w.text); continue; }
    if (!isHead && !w.input && w.text.startsWith('-') && CHDIR_FLAGS[prog]) {
      const eq = w.text.indexOf('=');
      if (eq < 0 && CHDIR_FLAGS[prog].test(w.text)) { chdirNext = true; continue; }
      if (eq > 0 && CHDIR_FLAGS[prog].test(w.text.slice(0, eq))) { chdir(w, w.text.slice(eq + 1)); continue; }
    }
    let text = w.text;
    if (!w.dynamic && PACKAGE_NAME.test(text)) continue;   // @scope/pkg (npx's program too) is a package, not a path (review 4)
    // Review 16: a runner's specifier (npm:foo, jsr:@std/x, node:fs) is not a file either.
    if (!w.dynamic && /^[a-z][a-z0-9+.-]*:[^/\\]/i.test(text) && !text.includes('://')) continue;
    // Review 16: the program text of awk, sed and jq is code too; the absolute paths in it count (awk 'BEGIN{system("/x.sh")}').
    if (!isHead && !w.dynamic && /^(?:g|m)?awk$|^g?sed$|^jq$/.test(prog) && !inlineProgDone && !flagScriptNext && !text.startsWith('-')) {
      inlineProgDone = true;
      for (const m of text.matchAll(INNER_ABS)) { paths.push(path.normalize(m[1])); runPaths.push(path.normalize(m[1])); }
      if (!/^\.?\.?\//.test(text) && !path.isAbsolute(text)) continue;
    }
    const inline = !isHead && inlineFlag(prog, before);   // only an interpreter's -c or -e (mkdir -p is not)
    const isFlag = !isHead && !w.input && !valueCode && (text.startsWith('-') || (/^\+[A-Za-z]+$/.test(text) && INTERPRETER.test(prog)));   // bash +x
    // Review 13: a short flag with its path glued on (ruby -r/h/pre.rb, gcc -I./x): the path is the flag's value.
    const glued = isFlag && !text.includes('=') && /^-[A-Za-z]{1,2}(?:\/|~\/|\.{1,2}\/)/.test(text);
    const flagScript = (flagScriptNext && !isHead && !isFlag) || valueCode;
    flagScriptNext = !isHead && !w.dynamic && !!(SCRIPT_FLAG[prog] && SCRIPT_FLAG[prog].test(text));
    if (isFlag && !w.dynamic && !flagScriptNext && VALUE_FLAGS[prog] && VALUE_FLAGS[prog].test(text)) { skipNext = true; if (MODULE_FLAG.test(prog + ' ' + text)) { scriptSlot = false; folderRunner(`${prog} -m`); } continue; }
    // A flag that carries a path (--require=/x.js): the part after the first '=', when it looks like a path (review 4:
    // --max-old-space-size=4096 names no file).
    const flagValue = isFlag && (text.includes('=') || glued);
    if (glued) text = text.replace(/^-[A-Za-z]{1,2}/, '');
    else if (flagValue) {
      text = text.slice(text.indexOf('=') + 1);
      if (!w.dynamic && !text.includes('/') && !/\.[A-Za-z0-9]{1,5}$/.test(text)) continue;
      if (!w.dynamic && /[*?]/.test(text)) continue;   // --include="*.ts" is a pattern, not a file (review 7)
    }
    if (!isHead && !isFlag && !inline && !w.dynamic && !flagScript && runnerSub) {
      const sub = runnerSub; runnerSub = null;
      if (sub.test(text)) { scriptSlot = true; packageScriptNext = PACKAGE_SCRIPT_RUNNER.test(prog); continue; }
      packageScriptNext = PACKAGE_SCRIPT_RUNNER.test(prog);   // bun start: the word itself
      if (!INTERPRETER.test(prog)) scriptSlot = false;
    }
    if (packageScriptNext && !isHead && !isFlag && !inline && !w.dynamic) {
      packageScriptNext = false;
      if (!text.includes('/') && !/\.[A-Za-z0-9]{1,5}$/.test(text)) folderRunner(`${prog} ${text}`);   // a package script, not a file
    }
    const inScriptSlot = scriptSlot && !isHead && !isFlag && !inline && !w.input && !flagScript;
    /* Review 5: every plain word after an interpreter counts, not only the first: a flag that takes a value
       (bash -o pipefail x.sh, ruby -I lib x.rb) would otherwise take the slot and leave the real script as an argument.
       A list of such flags is always partial; counting them all costs a data argument of the hook being denied too. */
    const codeSlot = (inScriptSlot && !slotTaken) || flagScript;
    if (inScriptSlot) slotTaken = true;
    // A script extension counts anywhere, except on a pattern (case *.py), find -name '*.py': review 7).
    // Review 10: input is what runs only for a shell or interpreter (bash < x.sh); jq . < state.json reads a file.
    const runs = isHead || inScriptSlot || (w.input && INTERPRETER.test(prog)) || flagValue || inline || flagScript || (!w.dynamic && !w.globbed && !/[*?\s]/.test(text) && (SCRIPT_EXT.test(text) || (/\.command$/i.test(text) && /^[~./]|\//.test(text))));   // where something RUNS (review 16: .command only as a path, not a jq filter)
    if (w.dynamic) {
      // A flag's unknown value names a path only when it has a slash (--header="$H" names nothing).
      // Review 12: only where the script itself sits; a later argument the hook passes ("$FOO", "$@") names no script.
      if ((isHead || codeSlot || (w.input && INTERPRETER.test(prog)) || inline || flagScript || (flagValue && text.includes('/'))) && runs) unsafe.push(`a ${isHead ? 'program' : 'path'} made when the command runs${text.includes('/') ? ', ending ' + text.slice(text.lastIndexOf('/')) : ''}`);
      continue;
    }
    if (inline) {
      // A shell's inline script is shell; another interpreter's (perl -pe, node -e) is not, so only the absolute
      // paths in it are taken (review 9: its code read as shell named nonsense files).
      scriptSlot = false;
      if (/^(?:(?:ba|z|da|k|fi|c|tc)?sh)$/.test(prog)) more(text);
      else {
        for (const m of text.matchAll(INNER_ABS)) { paths.push(path.normalize(m[1])); runPaths.push(path.normalize(m[1])); }
        // Review 17: python -c and node -e import from the folder they run in (sys.path '', ./node_modules).
        if (/^(?:python[0-9.]*|node|nodejs|deno|bun)$/.test(prog)) folderRunner(`${prog} ${before}`);
      }
      continue;
    }
    if (!text || text === '{}' || text.includes(PATH_MARK) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) continue;   // a URL, find's {} placeholder or $PATH is not a file
    // A pattern counts where it names a path or a script; `[` and `[[` as the program are the test command (review 3).
    if (w.globbed && runs && (text.includes('/') || !isHead)) { unsafe.push(`a pattern where a script is named (${text}), which Kosmos does not expand`); continue; }
    let ps = [];
    let relative = false;
    if (path.isAbsolute(text)) ps = /^\/dev(\/|$)/.test(text) ? [] : [path.normalize(text)];
    else if (/^\.{0,2}\//.test(text) || (text.includes('/') && (runs || w.quoted || !/['"()=,:]/.test(text)))) { relative = true; ps = cwds.map((d) => path.resolve(d, text)); }   // a quoted or run-position word is the path itself
    else if (text.includes('/')) { for (const m of text.matchAll(INNER_ABS)) paths.push(path.normalize(m[1])); continue; }
    else if (runs && !isHead) { relative = true; ps = cwds.map((d) => path.join(d, text)); }   // bash check.sh: the agent could create it
    if (relative && runs && cwdUnknown) unsafe.push(`a script named from a folder a cd moved to that Kosmos cannot read (${text})`);
    // Review 11: where the script itself sits (not a later argument of an interpreter, such as a hook's mode word).
    const scriptWord = isHead || codeSlot || (w.input && INTERPRETER.test(prog)) || flagValue || (!w.dynamic && !w.globbed && !/[*?\s]/.test(text) && (SCRIPT_EXT.test(text) || (/\.command$/i.test(text) && /^[~./]|\//.test(text))));
    if (relative && runs && !anchored && !cwdUnknown && scriptWord) unsafe.push(`a script named relative to the folder the session is in, which the agent can move into any of its own subfolders (${text}); name it by a full path or from $CLAUDE_PROJECT_DIR`);
    for (const p of ps) {
      if (SEALED.test(p)) continue;   // review 16: a system path the agent can never write (SIP) needs no rule
      if (!runs && inAgentFolder(p)) continue;   // an argument in the agent's own folder is its work, not code
      paths.push(p);
      if (runs) runPaths.push(p);
      if (codeSlot || isHead) codePaths.push(p);   // review 15: a folder as the program means the parse went wrong: named
      /* Review 17: a program in a package folder (node_modules/.bin/x, .venv/bin/python) loads the rest of that folder's
         code, which one file's rule does not cover: named like a folder runner, at the package's root. */
      const pkg = (isHead || codeSlot) ? /^(.*?)\/(?:node_modules|\.?venv|vendor)\//.exec(p) : null;
      if (pkg) {
        const place = inAgentFolder(pkg[1]) ? 'the agent folder' : pkg[1];
        if (deferRunners) runners.push({ name: path.basename(p), where: pkg[1], place }); else unsafe.push(runnerSay(path.basename(p), place));
      }
    }
  }
  flushRunner();
  return { paths, runPaths, codePaths, unsafe, ...(deferRunners ? { runners } : {}) };
}

/* Every command in a parsed config: { line } for a shell line, { program, args } for a server (started directly). */
function commandsIn(node, out = [], depth = 0, server = false, helper = false) {
  if (depth > 32) { out.push({ tooDeep: true }); return out; }   // review 16: named, as every other limit here
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const x of node) commandsIn(x, out, depth + 1, server, helper); return out; }
  for (const [k, v] of Object.entries(node)) {
    // Review 9: inside a helper object (the managed policyHelper / policyHelpers), a path or executable is a program.
    if (helper && (k === 'path' || k === 'executable') && typeof v === 'string') { out.push({ program: v, args: [], exec: true }); continue; }
    if (k === 'command' && typeof v === 'string') {
      const args = Array.isArray(node.args) ? node.args.filter((a) => typeof a === 'string') : null;
      // A server starts in the project folder. Review 13: an exec-form HOOK (command and args) runs, like a shell
      // line, in the session's current folder, and only ${CLAUDE_PROJECT_DIR} and the plugin variables are expanded.
      if (server) out.push({ program: v, args: args || [], server: true });
      else if (args) out.push({ program: v, args, exec: true });
      else out.push({ line: v });
    } else if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) {
      out.push({ line: v });
    } else if (v && typeof v === 'object') {
      commandsIn(v, out, depth + 1, server || SERVER_KEYS.has(k), helper || /Helpers?$/.test(k));
    }
  }
  return out;
}

/* The words of one command. A server's command and args are literal words (no shell), with ${VAR} expanded. */
function wordsOf(cmd, vars) {
  if (cmd.line !== undefined) return shellWords(cmd.line, vars);
  if (cmd.exec) {
    const one = (s, head) => {
      let dynamic = false;
      const text = s.replace(/\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}/g, (m, n) => (Object.prototype.hasOwnProperty.call(vars, n) ? vars[n] : (dynamic = true, '')))
        .replace(/\$\{user_config\.[^}]*\}/g, () => { dynamic = true; return ''; });
      return { text, dynamic, quoted: true, globbed: false, head, assign: false, written: false, input: false, heredoc: false, subs: [] };
    };
    return [one(cmd.program, true), ...cmd.args.map((a) => one(a, false))];
  }
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
    // Review 12 asked to skip the agent's own two: not done, since the guard keeps every key outside the sandbox block
    // in both (settings.json is merged; cleanLocalSettings leaves process-starting keys), so their commands still run.
    for (const f of ['settings.json', 'settings.local.json']) out.push({ file: path.join(d, '.claude', f), pick: whole, settings: true, rewritten: own.includes(d) });
    out.push({ file: path.join(d, '.mcp.json'), pick: whole });
  }
  /* The global config: its own servers, and its project entries for the agent folder and the folders above (never
     the whole file: it holds every project on the computer). */
  // Review 5: by every name Claude Code gives it (an OAuth environment suffix), as the guard denies it.
  const globals = [...CLAUDE_GLOBAL_CONFIG_SUFFIXES.flatMap((sfx) => [...(home ? [path.join(home, `.claude${sfx}.json`)] : []), ...homes.map((h) => path.join(h, `.claude${sfx}.json`))]), ...homes.map((h) => path.join(h, '.config.json'))];
  const pickGlobal = (j) => {
    if (!j || typeof j !== 'object') return null;
    // Only its servers and helpers (review 3): the rest of the file is runtime state, cached feature config included.
    const own = { mcpServers: j.mcpServers };
    for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) own[k] = v;
    const projects = j.projects;
    // Review 15: the project entries the same way, servers and helpers only (the most-churned part of the file).
    const pick = (e) => { const o = { mcpServers: e.mcpServers }; for (const [k, v] of Object.entries(e)) if (typeof v === 'string' && (HELPER_KEYS.has(k) || /Helper$/.test(k))) o[k] = v; return o; };
    const mine = projects && typeof projects === 'object' ? folders.map((d) => projects[d]).filter((e) => e && typeof e === 'object').map(pick) : [];
    return [own, ...mine];
  };
  for (const g of [...new Set(globals)]) out.push({ file: g, pick: pickGlobal });
  const md = deps.managedDir !== undefined ? deps.managedDir : managedDir(platform);
  if (md) {
    out.push({ file: path.join(md, 'managed-settings.json'), pick: whole, settings: true }, { file: path.join(md, 'managed-mcp.json'), pick: whole });
    const dropIns = path.join(md, 'managed-settings.d');
    try { for (const f of fs.readdirSync(dropIns).filter((x) => x.endsWith('.json')).sort()) out.push({ file: path.join(dropIns, f), pick: whole, settings: true }); } catch (e) {
      // Review 9: none there is fine; one that cannot be listed is named, as an unreadable file is.
      if (!(e && (e.code === 'ENOENT' || e.code === 'ENOTDIR'))) out.push({ file: dropIns, pick: whole, settings: true, failed: (e && e.code) || String(e) });
    }
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
  // Review 14: and its monitors (background scripts, unsandboxed like hooks): monitors/monitors.json by default.
  const files = [path.join(dir, '.claude-plugin', 'plugin.json'), path.join(dir, 'hooks', 'hooks.json'), path.join(dir, '.mcp.json'), path.join(dir, '.lsp.json'), path.join(dir, 'monitors', 'monitors.json')];
  const manifest = readJsonFile(files[0]).json;
  if (manifest && typeof manifest === 'object') {
    const experimental = manifest.experimental && typeof manifest.experimental === 'object' ? manifest.experimental : {};
    for (const k of ['hooks', 'mcpServers', 'lspServers', 'monitors']) {
      for (const p of [].concat(manifest[k] || [], k === 'monitors' ? experimental.monitors || [] : [])) {
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
function startCommandScripts(dir, { homes = [], home, ownHome = null, platform, managedDir: md, managedPrefsDir, covered = [] } = {}) {
  const runnerSeen = [];   // folder runners, decided once the plugin folders are known
  const agentDir = path.resolve(dir);
  const raw = [];
  const runRaw = new Set();
  const codeRaw = new Set();
  const unsafe = [];
  const sources = [];
  for (const s of configSources(agentDir, homes, home, { platform, managedDir: md, managedPrefsDir })) {
    const r = s.failed ? { error: s.failed } : s.plist ? readPlistFile(s.file) : readJsonFile(s.file);
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
  // Review 11: no PWD: a hook runs in the session's current folder, which the agent moves.
  // Review 9: the login's own name and temp folder, which hooks see unchanged.
  let login = {};
  try { const u = require('os').userInfo().username; login = { USER: u, LOGNAME: u }; } catch { login = {}; }
  const tmp = process.env.TMPDIR || require('os').tmpdir();
  const baseVars = { ...settingsEnv, ...login, TMPDIR: tmp, PATH: PATH_MARK, ...(home ? { HOME: home } : {}), CLAUDE_PROJECT_DIR: agentDir, ...(ownHome ? { CLAUDE_CONFIG_DIR: ownHome } : {}) };
  const take = (cmds, vars, where) => {
    for (const c of cmds) {
      if (c.tooDeep) { unsafe.push(`a config nested too deep for Kosmos to read (in ${where})`); continue; }
      // A server (program and args) starts in the project folder; a shell line in the session's current one.
      const r = pathsOfWords(wordsOf(c, vars), agentDir, vars, 0, null, !!c.server, true);
      raw.push(...r.paths);
      for (const p of r.runPaths) runRaw.add(p);
      for (const p of r.codePaths) codeRaw.add(p);
      for (const u of r.unsafe) unsafe.push(`${u} (in ${where}: a command whose script Kosmos cannot read)`);
      for (const x of r.runners) runnerSeen.push({ ...x, from: where });
    }
  };
  for (const s of sources) {
    const part = s.pick(s.json);
    if (part) take(commandsIn(part), baseVars, s.file);
  }
  /* Review 11: CLAUDE_CODE_SHELL_PREFIX in a settings env is a command Claude Code puts in front of every hook. */
  if (settingsEnv.CLAUDE_CODE_SHELL_PREFIX !== undefined) take([{ line: settingsEnv.CLAUDE_CODE_SHELL_PREFIX }], baseVars, 'the settings env (CLAUDE_CODE_SHELL_PREFIX)');
  else if (envValues.has('CLAUDE_CODE_SHELL_PREFIX')) unsafe.push('CLAUDE_CODE_SHELL_PREFIX (set two ways in the settings env, so the program every hook runs through is unknown)');
  /* A plugin folder is denied whole, so one that is the agent folder, a folder above it, the home or a config home would
     take the agent's own work away: named instead. */
  const never = new Set([...foldersFrom(agentDir), ...(home ? [path.resolve(home)] : []), ...homes.map((h) => path.resolve(h))]);
  const realOf = (d) => { try { return fs.realpathSync.native(d); } catch { return d; } };
  for (const d of [...never]) never.add(realOf(d));
  const plugins = installedPlugins(homes, unsafe).filter((p) => {
    const inside = [agentDir, realOf(agentDir)].some((d) => [p.dir, realOf(p.dir)].some((x) => x.startsWith(d + path.sep)));   // review 4: inside the agent folder
    if (!inside && !never.has(p.dir) && !never.has(realOf(p.dir))) return true;   // review 3: by its resolved path too, and never a config home
    unsafe.push(`the plugin ${p.id} (its folder ${p.dir} holds the agent's own work or a config home, so Kosmos does not deny it whole)`);
    return false;
  });
  for (const p of plugins) {
    const vars = { ...baseVars, CLAUDE_PLUGIN_ROOT: p.dir, CLAUDE_PLUGIN_DATA: path.join(p.home, 'plugins', 'data', p.id.replace(/[^a-zA-Z0-9\-_]/g, '-')) };
    for (const f of pluginConfigFiles(p.dir)) {
      const r = readJsonFile(f);
      if (r.error) unsafe.push(`${f} (could not be read: ${r.error}), so the commands in it are unknown`);
      // Review 15: a plugin's .mcp.json and .lsp.json hold servers (started in the project folder), with or without an
      // mcpServers key.
      else if (!r.missing) take(commandsIn(r.json, [], 0, /\.(?:mcp|lsp)\.json$/.test(f)), vars, f);
    }
  }
  /* Never a folder: `cd "$CLAUDE_PROJECT_DIR"` or `rg x ~/work` names one, and denying it would take the agent's own
     work away. A script is a file, or a path with nothing there yet (which the agent could create). */
  const files = [];
  for (const p of new Set(raw)) {
    let st = null;
    try { st = fs.statSync(p); } catch { st = null; }
    // Review 7: a folder an interpreter runs (node /srv, python3 ~/app, java -cp ~/lib) IS code; Kosmos does not deny a
    // folder whole, so it is named.
    if (st && st.isDirectory()) { if (codeRaw.has(p)) unsafe.push(`${p} (a folder a start-time command runs as code, which Kosmos does not deny whole)`); continue; }
    files.push(p);
  }
  /* Review 15: a folder runner is named wherever it runs, unless that folder is one the guard denies whole anyway (a
     plugin's own folder, a config home's code folders): then the code it reads there is covered. */
  const coveredDirs = [...covered, ...plugins.map((p) => p.dir)].map((d) => path.resolve(d));
  const isCovered = (w) => w !== UNKNOWN_RUN_CWD && coveredDirs.some((d) => w === d || w.startsWith(d + path.sep));
  for (const x of runnerSeen) {
    if (isCovered(x.where)) continue;
    unsafe.push(`${runnerSay(x.name, x.place)} (in ${x.from})`);
  }
  return { files, runFiles: files.filter((f) => runRaw.has(f)), pluginDirs: [...new Set(plugins.map((p) => p.dir))], unsafe: [...new Set(unsafe)] };
}

module.exports = { startCommandScripts, shellWords, pathsOfWords, commandsIn, managedDir, HELPER_KEYS, CLAUDE_GLOBAL_CONFIG_SUFFIXES };
