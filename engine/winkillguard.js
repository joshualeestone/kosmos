'use strict';

/**
 * kosmos#8406: the Windows twin of #4671's kill guard (install/kosmos-report-hook.sh, Mac and Linux only).
 *
 * On a Kosmos Windows computer every agent, the board and the Kosmos app are node.exe or claude.exe processes of
 * the person's own login. One command that stops every process of those names ends all of them at once; one that
 * stops every process of the user, or ends the login session, ends their open apps too. The Mac guard came from a
 * real incident (2026-09-29, a signal to process id -1). No Windows incident is known; this refuses the Windows
 * forms of the same act before it runs.
 *
 * It reads the text a tool call would run or write, splits it into commands (newlines, ; & && || and pipes, outside
 * quotes), and looks only at a command in command position: the first word of a command (after call, start with its
 * title and switches, then, do, else, nohup, time, xargs, exec, command, sudo); a ( ) or { } block that starts a
 * command (a subshell, & { ... }) or follows a control keyword (if, else, foreach, function, try ...); and the
 * command inside cmd /c, bash/sh/zsh -c (also -lc), powershell -Command or powershell's bare words, and iex. A word
 * inside an argument (a commit message, a grep pattern, a path), a block that is code or data (an object literal,
 * a call's arguments), and name( ... ) (a function call in code) are not commands. An unclosed quote is an ordinary
 * character, so an apostrophe does not hide what follows. Switches may be written /X, //X (Git Bash, which Claude Code's Bash tool uses on Windows) or -X,
 * in any case. Refused:
 *   - taskkill /IM of a name a Kosmos process has (node, claude, kosmos*, .exe or not, or a wildcard that matches
 *     one), even beside a /PID (each /PID and /IM adds processes), unless a "PID eq <n>" filter narrows the call;
 *   - taskkill /FI with no /PID, no "PID eq <n>" filter and no other /IM: a filter alone ends every process it matches.
 *     A filter that names another program narrows it and passes: IMAGENAME eq <other>, WINDOWTITLE eq <a title>
 *     (not N/A or *), SERVICES eq <a service>. MODULES, USERNAME, STATUS, SESSION, MEMUSAGE, CPUTIME, and any ne,
 *     gt or lt are broad;
 *   - Stop-Process (spps, kill) by -Name / -ProcessName (or a prefix, -Name:x, or an @( ) list), any of the names a
 *     Kosmos name, unless -WhatIf;
 *   - Get-Process (gps, ps) piped into Stop-Process, through Sort-Object, unless Get-Process names only other
 *     processes or takes -Id, or a Where-Object or Select-Object in between filters it; a Where-Object that selects
 *     a Kosmos process by name (-eq, -like, -match), or that only excludes (-ne, -notlike, -notmatch), is refused;
 *   - wmic ... process ... delete / call terminate with no ProcessId;
 *   - logoff (alone, or with a session id or switch: not logoff = x), shutdown with an end verb (s r l p h g, not a
 *     for abort, not /m to another computer), Restart-Computer, Stop-Computer.
 * Allowed: taskkill /PID <n> (with /T and /F), Stop-Process -Id <n>, any other process name, a Get-Process filtered
 * before Stop-Process (Where-Object, -Id), shutdown /a.
 *
 * 🛑 A SEATBELT, NOT A SANDBOX, as the Mac guard says of itself: it reads literal text. A name computed at run time,
 * a script that builds the command, Start-Process taskkill with -ArgumentList, an encoded command, a command inside
 * a quoted argument of another program (os.system("..."), node -e "..."), an argument-array spawn (subprocess.run(
 * ["taskkill", ...]), spawn("taskkill", [...])), backtick command substitution, WMI and CIM
 * (Get-WmiObject ... | Remove-WmiObject, Invoke-CimMethod -MethodName Terminate), the blocks of Invoke-Command,
 * Start-Job and . { }, a bash \' outside quotes, a Where-Object whose test is not a name (CPU -gt 0 selects nearly
 * everything and passes; a name with -and $_.Id is still refused), or any shape not listed above passes. Also read: $( ... ), batch for ... do, tskill, Stop-Process (Get-Process ...), and | % { $_.Kill() }. A guard error fails open: the hook exits 0 and the call runs, as on the Mac.
 */

const KOSMOS_IMAGES = ['node.exe', 'claude.exe', 'kosmos.exe'];

/* Does a cmd image-name pattern (* and ? wildcards) match this name? An iterative two-pointer match: linear, so a
   run of stars cannot backtrack (a regex built from the pattern did, review round 2: 30 stars took 18.7 s). */
function globMatch(pat, str) {
  let p = 0; let s = 0; let star = -1; let mark = 0;
  while (s < str.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === str[s])) { p++; s++; }
    else if (p < pat.length && pat[p] === '*') { star = p++; mark = s; }
    else if (star >= 0) { p = star + 1; s = ++mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

/* Does this image name or pattern name a Kosmos process? node, claude and kosmos-anything, with or without .exe;
   a wildcard counts when it can match one of them. */
function kosmosName(raw) {
  // A redirect glued to the name (node.exe>nul, node.exe 2>&1 written without a space) is not part of it.
  const n = String(raw || '').trim().toLowerCase().replace(/\d?[<>].*$/, '');
  if (!n) return false;
  if (/[*?]/.test(n)) return KOSMOS_IMAGES.some((x) => globMatch(n, x) || globMatch(n, x.replace(/\.exe$/, '')));
  return /^(node|claude)(\.exe)?$/.test(n) || /^kosmos/.test(n);
}

/* Where each ( and { closes, and whether a quote is left open, in one pass with the tokenizer's own quote rules: a
   quote runs to the next same quote, \" and \\ are literal inside double quotes, $( inside double quotes starts a
   fresh context (bash command substitution) until its ), and <# ... #> and a word-start # (to the end of the line)
   are comments. A bracket that never closes, or a close of the wrong kind, matches nothing and stays an ordinary
   character, so a smiley :( or a regex literal cannot hide the rest of the text. Linear. */
function scan(text, lit) {
  const match = new Map();
  const comments = new Map();   // start index -> index after the comment
  const stack = [];             // { at, kind, q } : kind '(' '{' or '$(' (inside a quote, q is restored at its close)
  let q = ''; let qAt = -1;
  for (let i = 0; i < text.length; i++) {
    if (comments.has(i)) { i = comments.get(i) - 1; continue; }   // a heredoc body recorded ahead of its newline
    const c = text[i];
    if (q) {
      if (c === q) { q = ''; continue; }
      if (q === '"' && c === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) { i++; continue; }
      if (q === '"' && c === '$' && text[i + 1] === '(') { stack.push({ at: i + 1, kind: '$(', q }); q = ''; i++; continue; }
      continue;
    }
    if ((c === '"' || c === "'") && !lit.has(i)) { q = c; qAt = i; continue; }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      // A heredoc: its body is data for the command (cat, git's -m via $(cat <<'EOF' ...)), not commands, unless
      // the command is a shell that runs it. The body runs from the next newline to a line holding only the word.
      // The word is quoted or in capitals (EOF, 'EOF', KOSMOS_END): `x << 2` in code being written is a shift.
      const m = /^<<(-?)\s*(?:(["'])([A-Za-z0-9_.-]+)\2|()([A-Z_][A-Z0-9_]*)(?![a-z0-9]))/.exec(text.slice(i, i + 64));
      const nl = m ? text.indexOf('\n', i) : -1;
      if (m && nl >= 0) {
        const back = text.slice(Math.max(0, i - 256), i);   // bounded look back, so many << on one line stay linear
        const lineStart = Math.max(0, i - 256) + Math.max(back.lastIndexOf('\n'), back.lastIndexOf(';'), back.lastIndexOf('|'), back.lastIndexOf('(')) + 1;
        const head = text.slice(lineStart, i).trim().split(/\s+/)[0] || '';
        const shell = /^(bash|sh|zsh|cmd|cmd\.exe|powershell|pwsh|powershell\.exe|pwsh\.exe|iex)$/i.test(head.replace(/^.*[\\/]/, ''));
        if (!shell) {
          const delim = m[3] || m[5];
          let k = nl + 1; let to = text.length;
          while (k <= text.length) {
            const e = text.indexOf('\n', k); const line = text.slice(k, e < 0 ? text.length : e);
            if ((m[1] ? line.replace(/^\t+/, '') : line) === delim) { to = e < 0 ? text.length : e; break; }
            if (e < 0) break;
            k = e + 1;
          }
          comments.set(nl, to);
          i += m[0].length - 1;
          continue;
        }
      }
    }
    if (c === '<' && text[i + 1] === '#') { const e = text.indexOf('#>', i + 2); const to = e < 0 ? text.length : e + 2; comments.set(i, to); i = to - 1; continue; }
    // A # at a word start begins a comment to the end of the line; ${#a} (bash's length of a) does not.
    if (c === '#' && (i === 0 || /[\s;&|({]/.test(text[i - 1])) && !(text[i - 1] === '{' && text[i - 2] === '$')) { const e = text.indexOf('\n', i); const to = e < 0 ? text.length : e; comments.set(i, to); i = to - 1; continue; }
    if (c === '(' || c === '{') { stack.push({ at: i, kind: c, q: '' }); continue; }
    if (c === ')' || c === '}') {
      const top = stack[stack.length - 1];
      if (top && ((c === ')' && (top.kind === '(' || top.kind === '$(')) || (c === '}' && top.kind === '{'))) {
        stack.pop();
        match.set(top.at, i);
        if (top.kind === '$(') q = top.q;   // back inside the double quote it started in
      }
    }
  }
  return { match, comments, openQuote: q ? qAt : -1 };
}

/* Words, operators and blocks, quotes removed (adjacent quoted and bare parts join into one word, as a shell does).
   - A word that held whitespace inside quotes is marked, so a wrapper's quoted command can be read again.
   - A matched ( ... ) or { ... } becomes one block token. reasonIn reads a block again as commands only where a
     shell or PowerShell would run it: at the start of a command (a subshell, & { ... }), after a control keyword
     (if, else, foreach, function, try ...), or as $( ... ) / <( ... ) anywhere, also inside double quotes. A block
     anywhere else is code or data (an object literal, a call's arguments), and is not read: so `(taskkill ...)` and
     `powershell -Command "& { Stop-Process -Name node }"` are seen, and `onClick={logoff}` or `import { logoff }
     from` are not.
   - \" and \\ inside double quotes are literal, as bash reads them.
   - A quote that never closes is an ordinary character (an apostrophe in prose must not hide the rest), found by
     reading again with that position literal.
   - PowerShell's backtick at the end of a line joins the next line. Comments (# to the end of the line at a word
     start, <# ... #>) are skipped.
   Linear in the text per read; at most a few rereads for unclosed quotes. */
function tokens(text, literalAt) {
  const lit = literalAt || new Set();
  const sc = scan(text, lit);
  // Past 32 rereads a quote still open hides the rest of the text: the cap fails toward passing, as every limit here
  // does. No natural input has needed more than two.
  if (sc.openQuote >= 0 && lit.size < 32) { const next = new Set(lit); next.add(sc.openQuote); return tokens(text, next); }
  const out = [];
  let cur = ''; let has = false; let quotedSpace = false; let q = ''; let wasQuoted = false;
  const subs = [];   // $( ... ) found inside the word being built, pushed as blocks after it
  const push = () => {
    if (has) out.push({ w: cur, quoted: quotedSpace, wasQuoted });
    for (const b of subs) out.push({ block: b, paren: true, glued: false, subst: true });
    subs.length = 0;
    cur = ''; has = false; quotedSpace = false; wasQuoted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) { q = ''; continue; }
      if (q === '"' && c === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) { cur += text[++i]; continue; }
      if (q === '"' && c === '$' && text[i + 1] === '(' && sc.match.has(i + 1)) {
        const close = sc.match.get(i + 1);
        subs.push(text.slice(i + 2, close));
        cur += text.slice(i, close + 1);
        i = close;
        continue;
      }
      if (/\s/.test(c)) quotedSpace = true;
      cur += c;
      continue;
    }
    if (sc.comments.has(i)) { push(); i = sc.comments.get(i) - 1; continue; }
    if ((c === '"' || c === "'") && !lit.has(i)) { q = c; has = true; wasQuoted = true; continue; }
    if (c === '`' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) { i += text[i + 1] === '\r' ? 2 : 1; push(); continue; }
    if ((c === '(' || c === '{') && sc.match.has(i)) {
      const close = sc.match.get(i);
      // name( ... ): a function call in code, not a shell block. $( ... ) and <( ... ) are bash substitutions: they run.
      const glued = i > 0 && !/[\s;&|({$<]/.test(text[i - 1]);
      const subst = c === '(' && (text[i - 1] === '$' || text[i - 1] === '<');
      push();
      out.push({ block: text.slice(i + 1, close), paren: c === '(', glued, subst });
      i = close;
      continue;
    }
    if (c === ')' || c === '}') { push(); out.push({ op: ';' }); continue; }
    if (c === '\n' || c === '\r' || c === ';') { push(); out.push({ op: ';' }); continue; }
    if (c === '&' || c === '|') {
      push();
      const two = text[i + 1] === c;
      out.push({ op: c === '|' && !two ? '|' : ';' });   // && & || all end a command; a single | joins a pipeline
      if (two) i++;
      continue;
    }
    if (/\s/.test(c)) { push(); continue; }
    cur += c;
    has = true;
  }
  push();
  return out;
}

/* Pipelines (lists of commands, each a list of words) from a token list. */
function pipelines(toks) {
  const lines = [];
  let pipe = [];
  let cmd = [];
  const endCmd = () => { if (cmd.length) pipe.push(cmd); cmd = []; };
  for (const t of toks) {
    if (t.op === '|') { endCmd(); continue; }
    if (t.op) { endCmd(); if (pipe.length) lines.push(pipe); pipe = []; continue; }
    cmd.push(t);   // a block stays in its command (Where-Object { ... } reads it), and is also read as commands below
  }
  endCmd();
  if (pipe.length) lines.push(pipe);
  return lines;
}

const base = (w) => (/^\/\//.test(String(w)) ? '' : String(w).replace(/^@/, '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, ''));   // //x: a code comment; @cmd: batch echo-off
const words = (list) => list.filter((t) => t.w !== undefined);
const sw = (w) => { const m = /^(?:\/{1,2}|-)([a-z?]+)(?::(.*))?$/i.exec(w); return m ? { name: m[1].toLowerCase(), value: m[2] } : null; };
const isPrefixOf = (p, full) => p.length >= 1 && full.startsWith(p);

const R = {
  kosmos: (what) => what + ': every agent and the Kosmos board stop at once, and Kosmos has to be started again',
  filter: 'a taskkill with a filter and no process id: it ends every process the filter matches, Kosmos and your open apps with them',
  session: (what) => what + ': it ends your whole login session',
  computer: (what) => what + ': it restarts, stops or suspends the computer',
  allps: 'a Stop-Process of the whole process list, with nothing that narrows it: it stops every process you own',
  allbut: 'a Stop-Process of every process but the one named: it stops nearly every process you own',
};

function taskkill(args) {
  let pid = false; let pidFilter = false; const ims = []; let fi = false; let narrowFilter = false;
  for (let i = 0; i < args.length; i++) {
    const s = sw(args[i].w);
    if (!s) continue;
    if (s.name === 'pid') pid = true;
    else if (s.name === 'im') { const v = s.value !== undefined ? s.value : (args[i + 1] && args[i + 1].w); if (v !== undefined) ims.push(v); if (s.value === undefined) i++; }
    else if (s.name === 'fi') {
      const v = String((s.value !== undefined ? s.value : (args[i + 1] && args[i + 1].w)) || '');
      if (s.value === undefined) i++;
      const vt = v.trim();
      const f = /^(\w+)\s+(eq|ne|gt|lt|ge|le)\s+/i.exec(vt);   // no lazy group over the value: that was quadratic on spaces
      const field = f ? f[1].toLowerCase() : ''; const op = f ? f[2].toLowerCase() : ''; const val = f ? vt.slice(f[0].length).trim() : '';
      if (field === 'pid' && op === 'eq' && /^\d+$/.test(val)) pidFilter = true;   // narrows the call to one process
      else if (field === 'imagename' && op === 'eq') { if (kosmosName(val)) ims.push(val); else narrowFilter = true; }
      // A window title or a service names a program; MODULES does not (every process loads ntdll), and a title of N/A
      // or * is every windowless process, the board and agents among them.
      else if ((field === 'windowtitle' || field === 'services') && op === 'eq' && val && !/^(\*|n\/a)$/i.test(val)) narrowFilter = true;
      else fi = true;   // USERNAME, STATUS, SESSION, MEMUSAGE, CPUTIME, IMAGENAME ne, a * value: ends what matches, broadly
    }
  }
  // Each /PID and /IM names more processes; only a /FI filter narrows. So a Kosmos /IM is refused even beside a
  // /PID, unless a "PID eq n" filter narrows the whole call to one process.
  const k = ims.find(kosmosName);
  if (k && !pidFilter) return R.kosmos('a taskkill of every ' + k + ' process');
  if (fi && !ims.length && !pid && !pidFilter && !narrowFilter) return R.filter;
  return '';
}

const namesIn = (v) => String(v || '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
function stopProcess(all) {
  const args = all;
  if (args.some((t) => t.w !== undefined && /^-whatif$/i.test(t.w))) return '';   // a dry run
  for (let i = 0; i < args.length; i++) {
    const w = args[i].w;
    if (w === undefined || !/^-/.test(w)) continue;
    const m = /^-([a-z]+)(?::(.*))?$/i.exec(w);
    if (!m) continue;
    const p = m[1].toLowerCase();
    if (!(isPrefixOf(p, 'name') || isPrefixOf(p, 'processname'))) continue;
    let v = m[2] !== undefined ? m[2] : (args[i + 1] && args[i + 1].w);
    // -Name @("node","claude") or -Name ("node","claude"): the names are in the block that follows
    const nb = args[i + 1] && args[i + 1].w === '@' ? args[i + 2] : args[i + 1];
    if (m[2] === undefined && nb && nb.block !== undefined) v = nb.block;
    const k = namesIn(v).find(kosmosName);
    if (k) return R.kosmos('a Stop-Process of every ' + k + ' process');
  }
  return '';
}

const GP_VALUE_FLAGS = ['computername', 'cn', 'erroraction', 'ea', 'warningaction', 'wa', 'informationaction', 'infa',
  'errorvariable', 'ev', 'warningvariable', 'wv', 'informationvariable', 'iv', 'outvariable', 'ov', 'outbuffer', 'ob', 'pipelinevariable', 'pv'];
function getProcessThenStop(args) {
  const names = []; let filtered = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i].w;
    const m = /^-([a-z]+)(?::(.*))?$/i.exec(w);
    if (!m) { names.push(...w.split(',').map((x) => x.trim()).filter(Boolean)); continue; }
    const p = m[1].toLowerCase();
    const take = () => (m[2] !== undefined ? m[2] : (args[++i] && args[i].w));
    if (isPrefixOf(p, 'name') || isPrefixOf(p, 'processname')) { const v = take(); if (v) names.push(...String(v).split(',').map((x) => x.trim()).filter(Boolean)); }
    else if (isPrefixOf(p, 'id') || isPrefixOf(p, 'inputobject')) { filtered = true; take(); }
    else if (GP_VALUE_FLAGS.includes(p)) take();
  }
  if (filtered) return '';
  if (!names.length) return R.allps;
  const k = names.find(kosmosName);
  return k ? R.kosmos('a Stop-Process of every ' + k + ' process') : '';
}

// A Map, not an object literal: a command word of constructor or __proto__ must not find Object.prototype (review 3).
const WRAP_C = new Map([['cmd', /^\/{1,2}(c|k)$/i], ['bash', /^-[a-z]*c[a-z]*$/], ['sh', /^-[a-z]*c[a-z]*$/], ['zsh', /^-[a-z]*c[a-z]*$/]]);
const PREFIX = /^(call|start|@|then|do|else|!|nohup|time|xargs|exec|command|sudo|if|elif|while|until)$/i;   // words before the command
const CONTROL = /^(if|elseif|else|foreach|for|while|do|until|try|catch|finally|switch|function|filter|trap|then)$/i;   // their blocks run
const EVAL = new Set(['iex', 'invoke-expression']);
const PS = new Set(['powershell', 'pwsh']);

/* The reason one command (a list of words) would stop everything, reading through a wrapper; '' otherwise. The next
   stage of its pipeline is given for Get-Process | Stop-Process. */
function commandReason(cmd, pipe, at, depth) {
  if (!cmd.length) return '';
  let i = 0;
  for (;;) {
    while (i < cmd.length && cmd[i].w !== undefined && PREFIX.test(cmd[i].w)) {
      const was = cmd[i].w.toLowerCase(); i++;
      // start's own switches (/b /min ...) and an empty title, xargs's flags, come before the command
      if (was === 'start') {
        if (i < cmd.length && cmd[i].w !== undefined && cmd[i].wasQuoted) i++;   // start "title" command
        while (i < cmd.length && cmd[i].w !== undefined && /^\/{1,2}[a-z]/i.test(cmd[i].w)) i++;
      }
      if (was === 'xargs') while (i < cmd.length && cmd[i].w !== undefined && /^-/.test(cmd[i].w)) i++;
      if (was === 'if') {   // cmd's if [/i] [not] exist X | defined X | errorlevel N | a==b | a == b, then the command
        const w = (k) => (cmd[k] && cmd[k].w !== undefined ? cmd[k].w : '');
        if (/^\/i$/i.test(w(i))) i++;
        if (/^not$/i.test(w(i))) i++;
        if (/^(exist|defined|errorlevel|cmdextversion)$/i.test(w(i))) i += 2;
        else if (/==/.test(w(i))) i += 1;
        else if (w(i + 1) === '==' || /^(equ|neq|lss|leq|gtr|geq)$/i.test(w(i + 1))) i += 3;
      }
    }
    break;
  }
  if (i >= cmd.length || cmd[i].w === undefined) return '';
  // name( ... ) in code is a function call or a definition, not a command: logoff(), shutdown(x)
  if (cmd[i + 1] && cmd[i + 1].block !== undefined && cmd[i + 1].paren && cmd[i + 1].glued) return '';
  const name = base(cmd[i].w);
  const raw = cmd.slice(i + 1);
  const args = words(raw);
  // A wrapper: read the command it runs (quoted: as text again; bare: the rest of the words).
  const wrapRest = (j) => {
    if (j >= args.length || depth > 3) return '';
    const rest = args.slice(j);
    if (rest.length === 1 && rest[0].quoted) return reasonIn(rest[0].w, depth + 1);
    return reasonIn(rest.map((t) => (/\s/.test(t.w) ? '"' + t.w + '"' : t.w)).join(' '), depth + 1);
  };
  if (WRAP_C.has(name)) {
    const re = WRAP_C.get(name);
    const j = args.findIndex((t) => re.test(t.w));
    if (j >= 0) return wrapRest(j + 1);
    // cmd /c"taskkill ..." with no space: the command is glued to the switch
    const g = name === 'cmd' ? args.find((t) => /^\/{1,2}[ck]\S/i.test(t.w)) : null;
    return g ? reasonIn(g.w.replace(/^\/{1,2}[ck]/i, ''), depth + 1) : '';
  }
  if (EVAL.has(name)) return wrapRest(0);   // iex "Stop-Process -Name node"
  if (PS.has(name)) {
    const j = args.findIndex((t) => { const m = /^-([a-z]+)$/i.exec(t.w); return m && isPrefixOf(m[1].toLowerCase(), 'command'); });
    if (j >= 0) return wrapRest(j + 1);
    // powershell <command> with no -Command: the first word that is not a switch starts it. A switch that takes a
    // value (-ExecutionPolicy Bypass, -File x) has its value skipped; -File runs a script, which is not read.
    const VALUED = /^-(executionpolicy|ex|ep|windowstyle|w|version|v|configurationname|inputformat|outputformat|of|if|psconsolefile|settingsfile|workingdirectory|wd)$/i;
    for (let k = 0; k < args.length; k++) {
      if (/^-(file|f|encodedcommand|e|ec)$/i.test(args[k].w)) return '';
      if (VALUED.test(args[k].w)) { k++; continue; }
      if (/^-/.test(args[k].w)) continue;
      return wrapRest(k);
    }
    return '';
  }
  if (name === 'for') {   // cmd's for %i in (...) do <command>: the command after do runs
    const d = args.findIndex((t) => /^do$/i.test(t.w));
    if (d >= 0) return wrapRest(d + 1);
  }
  if (name === 'tskill') {   // tskill <name>: every process of that name in this session
    const n0 = args.find((t) => !/^\/{1,2}/.test(t.w));
    if (n0 && kosmosName(n0.w)) return R.kosmos('a tskill of every ' + n0.w + ' process');
  }
  if (name === 'taskkill') return taskkill(args);
  if (name === 'stop-process' || name === 'spps' || name === 'kill') {
    const own = stopProcess(raw);
    if (own) return own;
    // Stop-Process (Get-Process node), or -InputObject (Get-Process ...): the processes come from that block.
    if (!raw.some((t) => t.w !== undefined && /^-whatif$/i.test(t.w))) {
      for (const t of raw) {
        if (t.block === undefined) continue;
        const inner = pipelines(tokens(t.block));
        const c0 = inner[0] && inner[0][0];
        if (inner.length === 1 && inner[0].length === 1 && c0 && c0[0] && c0[0].w !== undefined && /^(get-process|gps|ps)$/i.test(base(c0[0].w))) {
          const r = getProcessThenStop(words(c0.slice(1)));
          if (r) return r;
        }
      }
    }
    return '';
  }
  if ((name === 'get-process' || name === 'gps' || name === 'ps') && pipe && at + 1 < pipe.length) {
    // Through any Where-Object / Sort-Object / Select-Object stages to a Stop-Process. A Where-Object whose script
    // block names a Kosmos process selects it (the idiomatic `| Where-Object { $_.Name -eq 'node' } | Stop-Process`);
    // one that names none, a Select-Object, or -Id, filters.
    let filteredBy = ''; let picks = '';
    for (let si = at + 1; si < pipe.length; si++) {
      const stage = pipe[si];
      const sn = stage[0] && stage[0].w !== undefined ? base(stage[0].w) : '';
      if (sn === 'stop-process' || sn === 'spps' || sn === 'kill') {
        const own = stopProcess(stage.slice(1));   // Stop-Process -Name x reads its own names
        if (own) return own;
        if (stage.slice(1).some((t) => t.w !== undefined && /^-(whatif|name|processname|n|na|nam|id)(:.*)?$/i.test(t.w))) return '';
        if (picks) return picks === '*' ? R.allbut : R.kosmos('a Stop-Process of every ' + picks + ' process');
        if (filteredBy) return '';
        return getProcessThenStop(args);
      }
      if (sn === 'where-object' || sn === 'where' || sn === '?') {
        const body = stage.slice(1).map((t) => (t.block !== undefined ? t.block : t.w)).join(' ');
        // Only "not" comparisons: it keeps nearly everything (-ne "notepad"). A Kosmos name compared with -eq,
        // -like or -match selects that process.
        const positive = /-(eq|ieq|ceq|like|ilike|clike|match|imatch|cmatch|in|contains)\b/i.test(body);
        const negative = /-(ne|ine|cne|notlike|notmatch|notin|notcontains)\b/i.test(body);
        const m = /(?:^|[^\w.-])(node|claude|kosmos[\w.-]*)(?:\.exe)?(?![\w-])/i.exec(body);
        if (negative && !positive) picks = '*';
        else if (m && positive) picks = m[0].replace(/^[^\w]/, '');
        else filteredBy = 'where';
        continue;
      }
      if (sn === 'foreach-object' || sn === 'foreach' || sn === '%') {
        const body = stage.slice(1).map((t) => (t.block !== undefined ? t.block : t.w)).join(' ');
        // | % { $_.Kill() }, | % { Stop-Process $_ }, | % Kill: each stops every process it is given
        const member = stage[1] && stage[1].w !== undefined && /^kill$/i.test(stage[1].w);
        if (member || /\.kill\s*\(/i.test(body) || /(^|[\s;{(])(stop-process|spps)(\s|$|;)/i.test(body)) {
          if (picks) return picks === '*' ? R.allbut : R.kosmos('a Kill() of every ' + picks + ' process');
          if (filteredBy) return '';
          return getProcessThenStop(args);
        }
        break;
      }
      if (sn === 'select-object' || sn === 'select') { filteredBy = 'select'; continue; }
      if (sn === 'sort-object' || sn === 'sort') continue;
      break;
    }
  }
  if (name === 'wmic') {
    const wl = args.map((t) => t.w.toLowerCase());
    const joined = wl.join(' ');
    if ((wl.includes('process') || /(^|[^a-z_])win32_process([^a-z_]|$)/.test(joined)) && (wl.includes('delete') || wl.includes('terminate'))
        && !(/(^|[^a-z])processid\s*=/.test(joined) && !/(^|\s)or(\s|$)/.test(joined))) {
      const nm = /(^|[^a-z])name\s*(=|like)\s*["']?([^"'\s)]+)/.exec(joined);
      if (nm && !kosmosName(nm[3].replace(/%/g, '*')) && !/(^|\s)or(\s|$)/.test(joined)) return '';   // another program, by name
      return nm ? R.kosmos('a wmic command that ends every ' + nm[3] + ' process') : R.filter.replace('a taskkill with a filter and no process id', 'a wmic command with no process id');
    }
  }
  if (name === 'logoff' && !raw.some((t) => t.block !== undefined) && !args.some((t) => /^\/\?$/.test(t.w)) && args.every((t) => /^(\d+|\/{1,2}\S+|-\S+|console|rdp-\S+)$/i.test(t.w))) return R.session('logoff');
  if (name === 'shutdown') {
    const flags = args.map((t) => sw(t.w)).filter(Boolean).map((s) => s.name);
    const mi = args.findIndex((t) => { const x = sw(t.w); return x && x.name === 'm'; });
    const target = mi >= 0 && args[mi + 1] ? args[mi + 1].w.replace(/^\\+/, '').toLowerCase() : '';
    const remote = mi >= 0 && target && !/^(localhost|127\.0\.0\.1|\.|::1)$/.test(target);
    if (flags.includes('a') || remote) return '';   // abort, or another computer (/m \\host)
    if (flags.some((f) => /^(s|r|l|p|h|g|sg)$/.test(f))) return flags.includes('l') ? R.session('a shutdown /l') : R.computer('a shutdown command');
    return '';
  }
  if (name === 'restart-computer' || name === 'stop-computer') {
    if (args.some((t) => /^-whatif$/i.test(t.w))) return '';   // a dry run
    const ci = args.findIndex((t) => /^-(computername|cn)$/i.test(t.w));
    const target = ci >= 0 && args[ci + 1] ? args[ci + 1].w.toLowerCase() : '';
    if (target && !/^(localhost|\.|127\.0\.0\.1|::1)$/.test(target)) return '';   // another computer
    return R.computer(name === 'restart-computer' ? 'Restart-Computer' : 'Stop-Computer');
  }
  return '';
}

function reasonIn(text, depth) {
  if (depth > 6) return '';
  for (const pipe of pipelines(tokens(text))) {
    for (let i = 0; i < pipe.length; i++) {
      const cmd = pipe[i];
      const head = cmd[0] && cmd[0].w !== undefined ? base(cmd[0].w) : '';
      // The pipeline and this stage's index, not a copy of the rest: copying was quadratic (reviews 3 and 4).
      // (Get-Process node).Kill(), or (Get-Process node) | Stop-Process: a block that lists processes, then a kill
      const nextStop = pipe[i + 1] && pipe[i + 1][0] && pipe[i + 1][0].w !== undefined && /^(stop-process|spps|kill)$/i.test(base(pipe[i + 1][0].w));
      if (cmd[0] && cmd[0].block !== undefined && ((cmd[1] && cmd[1].w !== undefined && /^\.kill$/i.test(cmd[1].w)) || (cmd.length === 1 && nextStop))) {
        const inner = pipelines(tokens(cmd[0].block));
        const c0 = inner.length === 1 && inner[0].length === 1 ? inner[0][0] : null;
        if (c0 && c0[0] && c0[0].w !== undefined && /^(get-process|gps|ps)$/i.test(base(c0[0].w))) {
          const k = getProcessThenStop(words(c0.slice(1)));
          if (k) return k;
        }
      }
      const r = commandReason(cmd, pipe, i, depth);
      if (r) return r;
      // A block runs as commands at the start of a command, or after a control keyword; elsewhere it is code or data.
      const control = cmd[0] && cmd[0].w !== undefined && CONTROL.test(cmd[0].w);
      for (let k = 0; k < cmd.length; k++) {
        const t = cmd[k];
        if (t.block === undefined || !(k === 0 || control || t.subst)) continue;   // $( ... ) runs wherever it is
        if (t.paren && t.glued) continue;   // name(...): a call's arguments are values, not commands
        const b = reasonIn(t.block, depth + 1);
        if (b) return b;
      }
    }
  }
  return '';
}

/* The reason a text would stop every Kosmos process, the session or the computer, or '' when it would not. */
function reason(text) { return text ? reasonIn(String(text), 0) : ''; }

/* What the guard reads: the fields of tool_input that run or are written, as the Mac guard's jq branch reads them.
   A .md or .markdown file's written content is a document, not a command, and is not read. */
function textOf(evt) {
  const t = evt && typeof evt.tool_input === 'object' && evt.tool_input ? evt.tool_input : null;
  if (!t) return '';
  const file = typeof t.file_path === 'string' ? t.file_path : (typeof t.notebook_path === 'string' ? t.notebook_path : '');
  const doc = /\.(md|markdown)$/i.test(file);
  const parts = [t.command, t.cmd, t.script, t.code, Array.isArray(t.args) ? t.args.filter((a) => typeof a === 'string').join(' ') : t.args];
  if (!doc) {
    parts.push(t.content, t.new_string, t.new_source);
    if (Array.isArray(t.edits)) for (const e of t.edits) if (e && typeof e === 'object') parts.push(e.new_string);
  }
  return parts.filter((p) => typeof p === 'string').join('\n');
}

/* The guard for one hook event: { block: true, message } for a PreToolUse whose text is refused, else { block: false }.
   KOSMOS_KILL_GUARD=off turns it off, as on the Mac; an agent cannot change its own hook's environment. */
function check(evt, env) {
  if (!evt || evt.hook_event_name !== 'PreToolUse') return { block: false };
  if (env && env.KOSMOS_KILL_GUARD === 'off') return { block: false };
  const why = reason(textOf(evt));
  if (!why) return { block: false };
  const tool = typeof evt.tool_name === 'string' && evt.tool_name ? evt.tool_name : 'tool';
  return {
    block: true,
    message: 'Kosmos blocked this ' + tool + ' call: it contains ' + why + ' (kosmos#8406). Stop only exact process ids '
      + 'you started yourself and checked (taskkill /PID <n>, Stop-Process -Id <n>). If you are only writing ABOUT such '
      + 'a command, reword it.\n',
  };
}

module.exports = { check, reason, textOf, kosmosName, tokens };
