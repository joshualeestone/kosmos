#!/usr/bin/env node
'use strict';
/*
 * #5406: the PermissionRequest hook Kosmos gives its own Claude agents (engine/agentpermission.js). Claude Code runs it
 * when a permission prompt would appear. Kosmos launches agents with --dangerously-skip-permissions, so what prompts is
 * an ask rule (the person's, or a managed one). It answers allow, so the agent goes ahead instead of stopping on a
 * question the person cannot answer from the board (Josh's ruling, 2026-10-07).
 *
 * Silent (no answer, so the prompt shows as before) for:
 *   - AskUserQuestion: the agent asking the person something; "allow" would answer it with nothing;
 *   - anything naming a protected place (.claude, a Kosmos account folder .claude-<label>, .claude.json, .git). Not
 *     live today: measured, Claude Code 2.1.292 in bypass mode does not prompt there. It is future-proofing, so the hook
 *     never answers for that guard (the ruling is about the person's ask rules) if Claude adds it; judged by the file
 *     path or, for a shell command, its text;
 *   - input it cannot read: a hook that guesses is worse than one that steps aside.
 * ExitPlanMode is allowed: Kosmos runs agents unattended with no plan screen, so a plan waiting on approval only stalls.
 *
 * #3417: DENIED, with the rewrite in the message, for an rm whose path starts with a variable that may be empty
 * (rm -f "$S"/*.png). Claude Code's own check prompts for it even in bypass mode, and allowing it would run
 * rm -f /*.png when S is empty. Measured with 2.1.308: the agent reads the message, retries with "${S:?}"/*.png, and that
 * runs with no prompt, so the person still sees nothing. The hook input does not say which check prompted, so this
 * judges the command text. To accept these instead (Josh's literal words), remove the rmDanger branch in decide().
 * Always exits 0: a failed hook must never block the agent harder than no hook.
 */
const SILENT_FOR = new Set(['AskUserQuestion']);
// A path or command that names a protected place: .claude (folder or file), .claude.json, or .git. Bounded by any
// non-name character on both sides, so Windows backslashes and shell spellings (>.git/, .claude;) count, and
// case-insensitive (macOS and Windows disks are) (review 2); a name that only contains it (.github, x.git) does not.
// It over-catches on purpose (.git.bak, --git-dir=.git): a wrong "protected" only shows the prompt as before.
const PROTECTED = /(?<![A-Za-z0-9_.-])\.(claude(-[A-Za-z0-9_-]+)?(\.json)?|git)(?![A-Za-z0-9_-])/i;

/* Every string in the request, at any depth (review 4: a key list missed nested edits and other tools). A TEXT
   HEURISTIC, not a boundary: a name built at run time ($X/.claude, .cl*) is not seen. */
function touchesProtected(input, depth = 0) {
  if (typeof input === 'string') return PROTECTED.test(input);
  if (!input || typeof input !== 'object' || depth > 8) return false;
  for (const v of Object.values(input)) if (touchesProtected(v, depth + 1)) return true;
  return false;
}

/* #3417: a path argument that starts with $NAME or ${NAME}, quoted or not, followed by a slash. ${NAME:?} and any other
   ${NAME<op>...} form do not match, so the rewrite the message asks for is allowed. */
const UNGUARDED_VAR_PATH = /(?:^|[\s"'=])"?\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))"?\//;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;
const PREFIX_WORDS = new Set(['sudo', 'command', 'exec', 'env', 'nice', 'time']);

/** The variable name when a Bash command holds an rm whose path starts with a possibly-empty variable, else null.
 *  Splits on ; & | newline, backticks and $( ), skips leading NAME=value and wrapper words, and needs the first real
 *  word to be rm (or a path ending /rm). A text heuristic, like touchesProtected. */
function rmDanger(command) {
  if (typeof command !== 'string') return null;
  for (const seg of command.split(/[;&|\n`()]|\$\(/)) {
    const words = seg.trim().split(/\s+/);
    let i = 0;
    while (i < words.length && (ASSIGNMENT.test(words[i]) || PREFIX_WORDS.has(words[i]))) i++;
    if (i >= words.length || !/(^|\/)rm$/.test(words[i])) continue;
    const m = UNGUARDED_VAR_PATH.exec(' ' + words.slice(i + 1).join(' '));
    if (m) return m[1] || m[2];
  }
  return null;
}

function rmMessage(name) {
  return 'Kosmos did not run this rm: its path starts with $' + name + ', which may be empty, and then rm would delete'
    + ' from the wrong folder. Rewrite the path as "${' + name + ':?}"/... (it stops if ' + name + ' is empty) or use a'
    + ' literal path, then run it again.';
}

function decide(input) {
  let req;
  try { req = JSON.parse(String(input || '')); } catch { return null; }
  if (!req || req.hook_event_name !== 'PermissionRequest' || typeof req.tool_name !== 'string') return null;
  if (SILENT_FOR.has(req.tool_name)) return null;
  if (touchesProtected(req.tool_input)) return null;
  const danger = req.tool_name === 'Bash' && req.tool_input ? rmDanger(req.tool_input.command) : null;
  if (danger) return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: rmMessage(danger) } } };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
}

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  // No size cap: a large Write is still one JSON object to judge (review 1: a reset turned it into junk, so it prompted).
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', () => {
    try { const out = decide(buf); if (out) process.stdout.write(JSON.stringify(out)); } catch { /* step aside */ }
    process.exitCode = 0;
  });
  process.stdin.on('error', () => { process.exitCode = 0; });
}

module.exports = { decide, SILENT_FOR, touchesProtected, rmDanger };
