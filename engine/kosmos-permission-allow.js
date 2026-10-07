#!/usr/bin/env node
'use strict';
/*
 * #5406: the PermissionRequest hook Kosmos gives its own Claude agents (engine/agentpermission.js). Claude Code runs it
 * when a permission prompt would appear (in practice, an ask rule in the person's settings: Kosmos launches agents with
 * --dangerously-skip-permissions, so nothing else prompts). It answers allow, so the agent goes ahead instead of
 * stopping on a question the person cannot answer from the board.
 *
 * Silent (no answer, so the prompt shows as before) for:
 *   - AskUserQuestion: the agent asking the person something; "allow" would answer it with nothing;
 *   - input it cannot read: a hook that guesses is worse than one that steps aside.
 * Always exits 0: a failed hook must never block the agent harder than no hook.
 */
const SILENT_FOR = new Set(['AskUserQuestion']);

function decide(input) {
  let req;
  try { req = JSON.parse(String(input || '')); } catch { return null; }
  if (!req || req.hook_event_name !== 'PermissionRequest' || typeof req.tool_name !== 'string') return null;
  if (SILENT_FOR.has(req.tool_name)) return null;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } };
}

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; if (buf.length > 1e6) buf = ''; });
  process.stdin.on('end', () => {
    try { const out = decide(buf); if (out) process.stdout.write(JSON.stringify(out)); } catch { /* step aside */ }
    process.exitCode = 0;
  });
  process.stdin.on('error', () => { process.exitCode = 0; });
}

module.exports = { decide, SILENT_FOR };
