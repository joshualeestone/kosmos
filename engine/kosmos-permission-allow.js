#!/usr/bin/env node
'use strict';
/*
 * #5406: the PermissionRequest hook Kosmos gives its own Claude agents (engine/agentpermission.js). Claude Code runs it
 * when a permission prompt would appear. Kosmos launches agents with --dangerously-skip-permissions, so what still
 * prompts is an ask rule (the person's, or a managed one) and Claude's protected places (a .claude folder, .claude.json,
 * .git). It answers allow for the first, so the agent goes ahead instead of stopping on a question the person cannot
 * answer from the board (Josh's ruling, 2026-10-07).
 *
 * Silent (no answer, so the prompt shows as before) for:
 *   - AskUserQuestion: the agent asking the person something; "allow" would answer it with nothing;
 *   - anything touching a protected place (a .claude folder, .claude.json, .git): Claude asks there even in bypass mode
 *     so an agent cannot quietly rewrite the person's settings, hooks or permissions (review 1). The ruling is about
 *     the person's ask rules, not that guard; a request is judged by its file path or, for a shell command, its text;
 *   - input it cannot read: a hook that guesses is worse than one that steps aside.
 * ExitPlanMode is allowed: Kosmos runs agents unattended with no plan screen, so a plan waiting on approval only stalls.
 * Always exits 0: a failed hook must never block the agent harder than no hook.
 */
const SILENT_FOR = new Set(['AskUserQuestion']);
// A path or command that names a protected place: a .claude folder or file, .claude.json, or a .git folder.
const PROTECTED = /(^|[\/\s"'=:])\.claude([\/\s"'.]|\.json|$)|(^|[\/\s"'=:])\.git([\/\s"']|$)/;

function touchesProtected(input) {
  if (!input || typeof input !== 'object') return false;
  for (const k of ['file_path', 'notebook_path', 'path', 'command']) {
    if (typeof input[k] === 'string' && PROTECTED.test(input[k])) return true;
  }
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
