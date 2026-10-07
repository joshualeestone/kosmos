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

function decide(input) {
  let req;
  try { req = JSON.parse(String(input || '')); } catch { return null; }
  if (!req || req.hook_event_name !== 'PermissionRequest' || typeof req.tool_name !== 'string') return null;
  if (SILENT_FOR.has(req.tool_name)) return null;
  if (touchesProtected(req.tool_input)) return null;
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

module.exports = { decide, SILENT_FOR, touchesProtected };
