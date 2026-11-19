'use strict';
/* kosmos#8603 item 1: install/kosmos never starts a tmux server, or an agent, from its own shell.

   Why it matters (kosmos#8599): the wrapper exports NODE_OPTIONS (the `--require engine/clipipe.js` preload) and
   KOSMOS_CLIPIPE_SET=1, and its non-node children inherit both until a node restores them. Its tmux calls today read
   (list, display-message, capture-pane; the bundled tmux 3.5a asked to list with no server starts one that exits at
   once, status.js notes), and the board restores the environment before it starts agents. A
   `tmux new-session` (or `start-server`, or an `exec claude`) added to the wrapper would carry the preload into every
   pane started from it. This reads the script and refuses any line, outside a whole-line comment, that starts a tmux
   server (a server verb, or a bare tmux at command position, which runs new-session) or execs claude or codex.

   It is a tripwire for what someone writes by mistake, not a parser. Not seen: a verb built at run time; tmux's short
   command prefixes (`st` for start-server); the binary through another variable (`"$_cand" new -d`; a literal
   new-session is still caught); a line continuation splitting the binary from its verb; a bare binary behind `command`
   or `env`; an agent started without exec, through a wrapper (`exec env X=1 claude`, `exec nohup claude`), by a
   quoted name (`exec "claude"`) or through a variable (`exec "$CLAUDE_BIN"`). Trailing comments, heredocs and
   embedded node programs ARE scanned, on purpose: a false alarm is loud, a miss is silent.

     node --test cli.no-tmux-server-8603.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLI = path.join(__dirname, 'install', 'kosmos');

/* What can start a tmux server or an agent: the verbs, through any spelling of the binary the script uses (a bare
   tmux, "$AGENT_WORKFORCE_TMUX_BIN", ${...}), and an exec of claude. */
const BIN = String.raw`(?:\btmux|"?\$\{?AGENT_WORKFORCE_TMUX_BIN(?::-[^}]*)?\}?)"?`;   // tmux, "$AGENT_WORKFORCE_TMUX_BIN", "${AGENT_WORKFORCE_TMUX_BIN:-}"
const FLAGS = String.raw`(?:\s+-\S+(?:\s+[^-\s;&|)]\S*)?)*`;    // flags, each with or without an argument
const STARTS = [
  /\b(?:new-session|start-server)\b/,
  new RegExp(BIN + FLAGS + String.raw`\s+(?:new|start)\b`),
  /* A bare tmux (flags only, then any redirects) at command position runs new-session. Command position: a line start,
     ; & | { !, $(, a ( that starts the line (a "(tmux)" inside a message is prose), or exec, if, then, do, else.
     -V and -h only read. */
  new RegExp(String.raw`(?:^|[;&|{!]|\$\(|^\s*\(|\b(?:exec|if|then|do|else)\b)\s*` + BIN
    + String.raw`(?:\s+-(?![Vh]\b)\S+(?:\s+[^-\s;&|)<>]\S*)?)*(?:\s+\d*[<>]&?\S*)*\s*(?:$|[;&|)])`),
  /\bexec\s+(?:\S*\/)?(?:claude|codex)\b/,
];
const offends = (line) => STARTS.some((re) => re.test(line));
const isComment = (line) => /^\s*#/.test(line);

test('#8603 install/kosmos has no line outside a comment that could start a tmux server or an agent', () => {
  const lines = fs.readFileSync(CLI, 'utf8').split('\n');
  assert.ok(lines.length > 1000, 'install/kosmos was not read: ' + lines.length + ' lines');
  /* Presence before absence: the script does call tmux (to read), so the matcher has real lines to look at. */
  assert.ok(lines.some((l) => !isComment(l) && /"\$AGENT_WORKFORCE_TMUX_BIN"\s+[a-z]/.test(l)), 'no "$AGENT_WORKFORCE_TMUX_BIN" <verb> call found');
  const found = lines.map((l, i) => [i + 1, l]).filter(([, l]) => !isComment(l) && offends(l)).map(([n, l]) => n + ': ' + l.trim());
  assert.deepEqual(found, [], 'install/kosmos could start a tmux server or an agent (kosmos#8603): the NODE_OPTIONS preload would ride into the pane');
});

test('#8603 CONTROL: the matcher fires on each way of starting one, and not on the reads the script makes', () => {
  for (const bad of [
    '  tmux new-session -d -s zara claude',
    '  "$AGENT_WORKFORCE_TMUX_BIN" new -d -s x',
    '  "${AGENT_WORKFORCE_TMUX_BIN}" start-server',
    '  tmux -L sock start',
    '  exec claude --resume',
    '  exec /usr/local/bin/claude',
    '  "${AGENT_WORKFORCE_TMUX_BIN:-}" new -d -s x claude',
    '  exec tmux',
    '  tmux -L kosmos',
    '  x=1; "$AGENT_WORKFORCE_TMUX_BIN" -f conf && y',
    '  exec codex',
    '  tmux 2>/dev/null || true',
    '  "$AGENT_WORKFORCE_TMUX_BIN" >/dev/null 2>&1 &',
    '  if tmux -L k; then',
    '  { tmux; }',
    '  ( tmux -L k ) &',
  ]) assert.ok(offends(bad), 'missed: ' + bad);
  for (const fine of [
    '    _tsess=$(tmux display-message -p -t "$TMUX_PANE" \'#{session_name}\' 2>/dev/null || true)',
    '  _ls=$("$AGENT_WORKFORCE_TMUX_BIN" ls 2>&1)',
    '  say "Sessions on this computer, as Kosmos\'s own tmux sees them ($AGENT_WORKFORCE_TMUX_BIN):"',
    '  _sys="$(PATH="${_KOSMOS_PATH_SYS:-$PATH}" command -v tmux 2>/dev/null || true)"',
    '  "$KOSMOS_HOME/tmux/bin/tmux") ;;',
    '  export PATH="$KOSMOS_HOME/tmux/bin:$PATH"',
    '  v=$(tmux -V)',
    '  "$AGENT_WORKFORCE_TMUX_BIN" -h; true',
  ]) assert.ok(!offends(fine), 'flagged a read: ' + fine);
  assert.ok(isComment('  # tmux new-session is never run here'), 'a comment is not code');
});
