#!/usr/bin/env node
'use strict';
/*
 * #5406: the PermissionRequest hook Kosmos gives its own Claude agents (engine/agentpermission.js). Claude Code runs it
 * when a permission prompt would appear. Kosmos launches agents with --dangerously-skip-permissions, so what prompts is
 * an ask rule (the person's, or a managed one), or one of Claude Code's own safety checks, such as "Dangerous rm
 * operation on possibly-empty variable path" (#3417). It answers allow, so the agent goes ahead instead of stopping on
 * a question the person cannot answer from the board (Josh's rulings, 2026-10-07, and 2026-10-22 for the safety
 * checks; engine/permission-rmguard-3417.test.js pins the allow for those).
 *
 * Silent (no answer, so the prompt shows as before) for:
 *   - AskUserQuestion: the agent asking the person something; "allow" would answer it with nothing;
 *   - anything naming a protected place (.claude, a Kosmos account folder .claude-<label>, .claude.json, .git). Not
 *     live today: measured, Claude Code 2.1.292 in bypass mode does not prompt there. It is future-proofing, so the hook
 *     never answers for that guard if Claude adds it (#5406's rule; #3417 left it as it was); judged by the file
 *     path or, for a shell command, its text;
 *   - input it cannot read: a hook that guesses is worse than one that steps aside.
 * ExitPlanMode is allowed: Kosmos runs agents unattended with no plan screen, so a plan waiting on approval only stalls.
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

/* kosmos#9001 part 1b: a shell command that only MENTIONS a protected place is answered; one that would delete, move or
   write one is not. Josh ruled on 10-22 that Claude Code's own safety prompts are approved, and asked again on 11-24
   21:30 ("These should automatically be approved and if not I need an approve button"). But 8 of the 9 real ones on
   the fleet's Mac (11-09 to 11-24) were left unanswered because the command's TEXT named .claude or .git: mostly a plan
   file under .claude/plans, read or edited by a heredoc. Each then reached his phone and declined itself. Splinter
   narrowed it (21:34): mentioning, reading or grepping is approved; deleting or moving such a place still waits for a
   person. Writing into one with the shell (a redirect, tee, cp...) waits too (the #5406 rows below), except into a plan
   file under .claude/plans, which is a document. Edit, Write and the other file tools keep #5406's rule unchanged.
   A TEXT HEURISTIC, as touchesProtected is: a variable or a script that builds the path is not seen (a command that
   names no protected place at all was answered before this change too). It over-catches on purpose: a delete
   ANYWHERE in a command that names a protected place anywhere waits, so the person sees the prompt as before. */
const DELETES_OR_MOVES = new RegExp([
  /(?:^|[\s;&|()`'"\\/])(?:rm|rmdir|unlink|shred|trash|mv|del|erase|rd|ren|ri|mi)(?=\s|$)/.source,   // and PowerShell's aliases
  /(?:Remove-Item|Move-Item|Rename-Item|Clear-Content)\b/.source,
  /\bfind\b[^\n;&|]*\s-(?:delete|exec(?:dir)?\s+\S*?(?:rm|mv|rmdir|unlink)\b)/.source,
  /\bgit\b[^\n;&|]*\s(?:clean|rm|mv)\b/.source,
].join('|'), 'i');
const PLAN_FILE = /(?<![A-Za-z0-9_.-])\.claude[\\/]plans[\\/]/i;
// A shell write whose target names a protected place: a redirect or tee into it, or a copying, linking or in-place
// editing command on the same line as it. A plan file (.claude/plans/...) is not counted.
function shellWritesProtected(command) {
  for (const line of command.split(/[\n;&|]+/)) {
    const targets = [...line.matchAll(/(?:>{1,2}|\btee(?:\s+-a)?)\s*['"]?([^\s;&|'"]+)/gi)].map((m) => m[1]);
    if (targets.some((t) => PROTECTED.test(t) && !PLAN_FILE.test(t))) return true;
    if (/\b(?:cp|ln|install|rsync|ditto|truncate|chmod|chown)\b|\b(?:sed|perl)\s+(?:-\w*\s+)*-i/i.test(line)) {
      const named = line.replace(new RegExp(PLAN_FILE.source + '\\S*', 'gi'), ' ');
      if (PROTECTED.test(named)) return true;
    }
  }
  return false;
}
function bashLeftToPerson(command) {
  if (!PROTECTED.test(command)) return false;
  return DELETES_OR_MOVES.test(command) || shellWritesProtected(command);
}

function decide(input) {
  let req;
  try { req = JSON.parse(String(input || '')); } catch { return null; }
  if (!req || req.hook_event_name !== 'PermissionRequest' || typeof req.tool_name !== 'string') return null;
  if (SILENT_FOR.has(req.tool_name)) return null;
  const t = req.tool_input;
  if (req.tool_name === 'Bash' || req.tool_name === 'PowerShell') {
    // kosmos#9001 part 1b: only the command decides; a description is words about the call. A command that is not text
    // is read the old way (any string anywhere).
    if (t && typeof t === 'object' && typeof t.command === 'string') {
      if (bashLeftToPerson(t.command)) return null;
    } else if (touchesProtected(t)) return null;
  } else if (touchesProtected(t)) return null;
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

module.exports = { decide, SILENT_FOR, touchesProtected, bashLeftToPerson };
