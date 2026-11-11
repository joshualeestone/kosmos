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
 * quotes), and looks only at a command in command position: the first word of a command, or the command inside
 * cmd /c, bash -c or powershell -Command. A word inside an argument (a commit message, a grep pattern, a path) is
 * not a command. Switches may be written /X, //X (Git Bash, which Claude Code's Bash tool uses on Windows) or -X,
 * in any case. Refused:
 *   - taskkill /IM of a name a Kosmos process has (node, claude, kosmos*, .exe or not, or a wildcard that matches
 *     one), unless /PID narrows it to exact processes;
 *   - taskkill /FI with no /PID (or "PID eq <n>" filter) and no other /IM: a filter alone ends every process it matches;
 *   - Stop-Process (spps, kill) by -Name / -ProcessName (or a prefix, or -Name:x), any of the names a Kosmos name;
 *   - Get-Process (gps, ps) piped straight into Stop-Process, unless Get-Process names only other processes or
 *     takes -Id;
 *   - wmic ... process ... delete / call terminate with no ProcessId;
 *   - logoff, shutdown with an end verb (s r l p h g, not a for abort), Restart-Computer, Stop-Computer.
 * Allowed: taskkill /PID <n> (with /T and /F), Stop-Process -Id <n>, any other process name, a Get-Process filtered
 * before Stop-Process (Where-Object, -Id), shutdown /a.
 *
 * 🛑 A SEATBELT, NOT A SANDBOX, as the Mac guard says of itself: it reads literal text. A name computed at run time,
 * a script that builds the command, Start-Process taskkill with -ArgumentList, an encoded command, or any shape not
 * listed above passes.
 */

const KOSMOS_IMAGES = ['node.exe', 'claude.exe', 'kosmos.exe'];

/* Does this image-name pattern (cmd's * and ? wildcards) match a Kosmos process? Plain names match by prefix, as
   kosmos-anything does; node and node.exe both count. */
function kosmosName(raw) {
  const n = String(raw || '').trim().toLowerCase();
  if (!n) return false;
  if (/[*?]/.test(n)) {
    const re = new RegExp('^' + n.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return KOSMOS_IMAGES.some((x) => re.test(x) || re.test(x.replace(/\.exe$/, '')));
  }
  return /^(node|claude|kosmos)(\.exe)?$/.test(n) || /^kosmos/.test(n);
}

/* Words and operators, quotes removed (adjacent quoted and bare parts join into one word, as a shell does). A word
   that held whitespace inside quotes is marked, so a wrapper's quoted command can be read again. Linear time. */
function tokens(text) {
  const out = [];
  let cur = '';
  let has = false;
  let quotedSpace = false;
  let q = '';
  const push = () => { if (has) out.push({ w: cur, quoted: quotedSpace }); cur = ''; has = false; quotedSpace = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) { q = ''; continue; }
      if (/\s/.test(c)) quotedSpace = true;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
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
    cmd.push(t);
  }
  endCmd();
  if (pipe.length) lines.push(pipe);
  return lines;
}

const base = (w) => String(w).split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
const sw = (w) => { const m = /^(?:\/{1,2}|-)([a-z?]+)(?::(.*))?$/i.exec(w); return m ? { name: m[1].toLowerCase(), value: m[2] } : null; };
const isPrefixOf = (p, full) => p.length >= 1 && full.startsWith(p);

const R = {
  kosmos: (what) => what + ': every agent and the Kosmos board stop at once, and Kosmos has to be started again',
  filter: 'a taskkill with a filter and no process id: it ends every process the filter matches, Kosmos and your open apps with them',
  session: (what) => what + ': it ends your whole login session',
  computer: (what) => what + ': it restarts or stops the computer',
  allps: 'a Get-Process piped into Stop-Process with no name: it stops every process you own',
};

function taskkill(args) {
  let pid = false; const ims = []; let fi = false;
  for (let i = 0; i < args.length; i++) {
    const s = sw(args[i].w);
    if (!s) continue;
    if (s.name === 'pid') pid = true;
    else if (s.name === 'im') { const v = s.value !== undefined ? s.value : (args[i + 1] && args[i + 1].w); if (v !== undefined) ims.push(v); if (s.value === undefined) i++; }
    else if (s.name === 'fi') {
      const v = s.value !== undefined ? s.value : (args[i + 1] && args[i + 1].w);
      if (s.value === undefined) i++;
      if (/^\s*pid\s+eq\s+\d+\s*$/i.test(String(v || ''))) pid = true;   // narrows to one process, as /PID does
      else fi = true;
    }
  }
  if (pid) return '';
  const k = ims.find(kosmosName);
  if (k) return R.kosmos('a taskkill of every ' + k + ' process');
  if (fi && !ims.length) return R.filter;
  return '';
}

function stopProcess(args) {
  for (let i = 0; i < args.length; i++) {
    const w = args[i].w;
    if (!/^-/.test(w)) continue;
    const m = /^-([a-z]+)(?::(.*))?$/i.exec(w);
    if (!m) continue;
    const p = m[1].toLowerCase();
    if (!(isPrefixOf(p, 'name') || isPrefixOf(p, 'processname'))) continue;
    const v = m[2] !== undefined ? m[2] : (args[i + 1] && args[i + 1].w);
    const k = String(v || '').split(',').map((x) => x.trim()).find(kosmosName);
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

const WRAP_C = { cmd: /^\/(c|k)$/i, bash: /^-c$/, sh: /^-c$/ };
const PS = new Set(['powershell', 'pwsh']);

/* The reason one command (a list of words) would stop everything, reading through a wrapper; '' otherwise. The next
   stage of its pipeline is given for Get-Process | Stop-Process. */
function commandReason(cmd, next, depth) {
  if (!cmd.length) return '';
  let i = 0;
  while (i < cmd.length && /^(call|start|&|@)$/i.test(cmd[i].w)) i++;   // cmd's call/start prefix, PowerShell's & call
  if (i >= cmd.length) return '';
  const name = base(cmd[i].w);
  const args = cmd.slice(i + 1);
  // A wrapper: read the command it runs (quoted: as text again; bare: the rest of the words).
  const wrapRest = (j) => {
    if (j >= args.length || depth > 3) return '';
    const rest = args.slice(j);
    if (rest.length === 1 && rest[0].quoted) return reasonIn(rest[0].w, depth + 1);
    return reasonIn(rest.map((t) => (/\s/.test(t.w) ? '"' + t.w + '"' : t.w)).join(' '), depth + 1);
  };
  if (WRAP_C[name]) { const j = args.findIndex((t) => WRAP_C[name].test(t.w)); return j < 0 ? '' : wrapRest(j + 1); }
  if (PS.has(name)) {
    const j = args.findIndex((t) => { const m = /^-([a-z]+)$/i.exec(t.w); return m && isPrefixOf(m[1].toLowerCase(), 'command'); });
    if (j >= 0) return wrapRest(j + 1);
    const k = args.findIndex((t) => !/^-/.test(t.w));   // powershell <command> with no -Command
    return k >= 0 && args[k].quoted ? reasonIn(args[k].w, depth + 1) : '';
  }
  if (name === 'taskkill') return taskkill(args);
  if (name === 'stop-process' || name === 'spps' || name === 'kill') return stopProcess(args);
  if ((name === 'get-process' || name === 'gps' || name === 'ps') && next && next.length) {
    const nn = base(next[0].w);
    if (nn === 'stop-process' || nn === 'spps' || nn === 'kill') return getProcessThenStop(args);
  }
  if (name === 'wmic') {
    const words = args.map((t) => t.w.toLowerCase());
    const joined = words.join(' ');
    if (words.includes('process') && (words.includes('delete') || words.includes('terminate')) && !/processid\s*=/.test(joined)) {
      return R.kosmos('a wmic command that ends processes by name or all of them');
    }
  }
  if (name === 'logoff') return R.session('logoff');
  if (name === 'shutdown') {
    const flags = args.map((t) => sw(t.w)).filter(Boolean).map((s) => s.name);
    if (flags.includes('a')) return '';
    if (flags.some((f) => /^(s|r|l|p|h|g|sg)$/.test(f))) return flags.includes('l') ? R.session('a shutdown /l') : R.computer('a shutdown command');
    return '';
  }
  if (name === 'restart-computer' || name === 'stop-computer') return R.computer(name === 'restart-computer' ? 'Restart-Computer' : 'Stop-Computer');
  return '';
}

function reasonIn(text, depth) {
  for (const pipe of pipelines(tokens(text))) {
    for (let i = 0; i < pipe.length; i++) {
      const r = commandReason(pipe[i], pipe[i + 1], depth);
      if (r) return r;
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
