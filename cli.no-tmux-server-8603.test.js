'use strict';
/* kosmos#8603 item 1: install/kosmos never starts a tmux server, or an agent, from its own shell.

   Why it matters (kosmos#8599): the wrapper exports NODE_OPTIONS (the `--require engine/clipipe.js` preload) and
   KOSMOS_CLIPIPE_SET=1, and its non-node children inherit both until a node restores them. Its tmux calls today only
   read (list, display-message, capture-pane), and the board restores the environment before it starts agents. A
   `tmux new-session` (or `start-server`, or an `exec claude`) added to the wrapper would carry the preload into every
   pane started from it. This reads the script and refuses any line, outside a comment, that could start one.

   It is a tripwire for what someone writes by mistake, not a parser: a verb built at run time is not seen.

     node --test cli.no-tmux-server-8603.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLI = path.join(__dirname, 'install', 'kosmos');

/* What can start a tmux server or an agent: the verbs, through any spelling of the binary the script uses (a bare
   tmux, "$AGENT_WORKFORCE_TMUX_BIN", ${...}), and an exec of claude. */
const STARTS = [
  /\b(?:new-session|start-server)\b/,
  /(?:\btmux|TMUX_BIN\}?)"?\s+(?:-\S+\s+(?:[^-\s]\S*\s+)?)*(?:new|start)\b/,   // flags, each with or without an argument
  /\bexec\s+(?:\S*\/)?claude\b/,
];
const offends = (line) => STARTS.some((re) => re.test(line));
const isComment = (line) => /^\s*#/.test(line);

test('#8603 install/kosmos has no line outside a comment that could start a tmux server or an agent', () => {
  const lines = fs.readFileSync(CLI, 'utf8').split('\n');
  assert.ok(lines.length > 1000, 'install/kosmos was not read: ' + lines.length + ' lines');
  /* Presence before absence: the script does call tmux (to read), so the matcher has real lines to look at. */
  assert.ok(lines.some((l) => !isComment(l) && /AGENT_WORKFORCE_TMUX_BIN|\btmux\s+display-message/.test(l)), 'no tmux call found at all');
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
  ]) assert.ok(offends(bad), 'missed: ' + bad);
  for (const fine of [
    '    _tsess=$(tmux display-message -p -t "$TMUX_PANE" \'#{session_name}\' 2>/dev/null || true)',
    '  _ls=$("$AGENT_WORKFORCE_TMUX_BIN" ls 2>&1)',
    '  say "Sessions on this computer, as Kosmos\'s own tmux sees them"',
  ]) assert.ok(!offends(fine), 'flagged a read: ' + fine);
  assert.ok(isComment('  # tmux new-session is never run here'), 'a comment is not code');
});
