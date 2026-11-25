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
 *     path or, for a shell command, its text. Except (kosmos#9001 part 1b, bashLeftToPerson below): a shell command
 *     whose only protected names are plan files under .claude/plans is answered, unless it deletes or moves something;
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

/* kosmos#9001 part 1b: a shell command whose only protected names are PLAN FILES (.claude/plans/...) is answered, unless
   it deletes or moves something. Josh ruled on 10-22 that Claude Code's own safety prompts are approved, and asked again
   on 11-24 21:30 ("These should automatically be approved and if not I need an approve button"). But the rule above left
   any command naming a protected place to the person, and 8 of the 9 real safety prompts on the fleet's Mac (11-09 to
   11-24) did, so each reached his phone and declined itself. Six of those named only plan files (a heredoc or a
   redirect editing .claude/plans/<branch>.md, the agents' own planning documents); this answers those six shapes.
   Splinter narrowed it at 21:34: deleting or moving still waits for a person.
   Narrower than "anything that only mentions .claude or .git" on purpose: review round 1 found a list of dangerous
   commands is leaky, so any OTHER protected name keeps #5406's rule. And when a plan is named, it waits for a person if
   the command has any .. segment, deletes, moves or links anything, extracts or copies a tree, uses a git verb that is
   not a read or a record, or points git at other config or another repository (bashLeftToPerson, below; four review
   rounds). A TEXT HEURISTIC, as touchesProtected is: a script file, or a command spelled so no protected name or delete
   word appears, is not seen (and such a command was answered before this change too). */
// What it guards against, said plainly (review round 4): an honest agent's command that VISIBLY reaches .claude or
// .git, as #5406's rule always did; not a hostile one. A command that hides the name entirely (a variable, r''m, a
// script file) was answered before this change and still is. Four review rounds showed a list of dangerous spellings
// cannot be complete against obfuscation, so the rules below stay simple and judge the FULL text (an earlier version
// took strings out first, to spare plan prose; it hid real commands twice and is gone).
//
// A plan path, strictly (review rounds 2 to 4): the plan folder itself, or paths under it made of plain filename
// characters and globs. Nothing the shell expands or splits ($, braces, commas, quotes, backslash escapes) can sit inside
// it, and it must end cleanly (PLAN_END). A segment that is itself a protected name (.claude/plans/x/.git) is not a plan.
const PLAN_MENTION = /(?<![A-Za-z0-9_.-])\.claude[\\/]plans(?:[\\/](?:[A-Za-z0-9_.@+~*?-]+(?:[\\/][A-Za-z0-9_.@+~*?-]+)*)?)?/gi;
const PLAN_END = /^(?:$|[\s;&|)<>,\]}]|['"](?:$|[\s;&|)<>,\]}]))/;
function withoutPlanPaths(command) {
  return command.replace(PLAN_MENTION, (m, at) => {
    const after = command.slice(at + m.length, at + m.length + 2);
    const inner = m.slice('.claude/plans'.length);
    // a segment that is itself a protected name, or only dots and glob characters (.? can expand to .. in bash 3.2)
    const bad = inner.split(/[\\/]/).some((seg) => PROTECTED.test(seg) || (seg !== '' && /^[.?*]+$/.test(seg) && seg.includes('.')));
    return PLAN_END.test(after) && !bad ? ' ' : m;
  });
}
// The text as the shell joins it (review round 3: .g'i't and .cl\aude hid a name): quotes out, a shell's backslash
// escapes undone; for PowerShell, its backtick escapes (its backslashes are path separators).
function joined(command, powershell) {
  return powershell ? command.replace(/['"]/g, '').replace(/`(.)/g, '$1')
    : command.replace(/['"]/g, '').replace(/\\\n/g, '').replace(/\\([\s\S])/g, '$1');
}
// Any .. path segment in a command that names a plan: a walk out of it, by the plan path or after a cd into it (round 4).
const DOTDOT_ANYWHERE = /(?:^|[\\/\s'"=:(,])\.\.(?=[\\/\s'"),;&|]|$)/;
const DELETES_MOVES_OR_LINKS = [
  // plain delete and move words, quoted or not (a shell, ssh, sed's e flag or a script string runs them too)
  /(?:^|[\s;&|()`'"\\/!\[,=])(?:rm|rmdir|unlink|shred|trash|mv)(?=[\s'",\]);]|$)/i,
  /\b(?:Remove-Item|Move-Item|Rename-Item|Clear-Content)\b/i,
  /\bfind\b[^;&|\n]*?\s-(?:delete|exec)/i,
  // links, any spelling a script or tool makes one with
  /(?:^|[\s;&|()`'"\\/])(?:ln|mklink)(?=\s|$)|^\s*(?:sudo\s+)?(?:\/bin\/)?link\s+\S|\b(?:SymbolicLink|Junction|HardLink|symlink|symlink_to|hardlink_to|symlinkSync|linkSync)\b|\bfs\.(?:promises\.)?(?:symlink|link)\b|\bcp\s+(?:-\w*[sl]\w*\s)|--link-dest\b/i,
  // deletes and moves in code: any call named like one, and the platform APIs
  /\b(?:unlink|unlinkSync|remove|removedirs|rmtree|rm|rmSync|rmdir|rmdirSync|rename|renameSync|move)\s*\(|\bos\.replace\b|\.(?:Delete|MoveTo)\s*\(|\bSystem\.IO\.|\[IO\.(?:File|Directory)\]|\bFile\.(?:delete|unlink)\b|\bFileUtils\.\w+/i,
  // tools that remove or replace the original, or put a tree (and its links) into a folder
  /--delete\b|--remove-files\b|--remove-source-files\b|\btruncate\b|\b(?:gzip|bzip2|xz)\b(?![^\n;&|]*\s-\w*[ck])|\bzip\s+-\w*m|\bcmd(?:\.exe)?\s+\/c\b|\btar\b[^;&|\n]*\s-?\w*x|\bunzip\b|\bcp\s+-\w*[aRr]|\bditto\b|\brsync\b/i,
  // git told to run or read config, or pointed at another repository (core.hooksPath runs code)
  /\bGIT_(?:CONFIG|DIR|WORK_TREE|EXEC_PATH)\w*=|--config-env\b|--exec-path\b|--git-dir\b|--work-tree\b|\balias\./,
];
// git, when a plan is named: only verbs that read or record (the real commands used add, commit, diff, show, grep,
// ls-files, rev-parse and push); any other verb (checkout, reset, stash, branch, worktree, submodule, remote, config...)
// or git -c is a person's call.
const GIT_READ_OR_RECORD = new Set(['add', 'commit', 'diff', 'show', 'log', 'status', 'grep', 'ls-files', 'rev-parse', 'blame', 'push', 'fetch']);
function gitLeftToPerson(piece) {
  // The verb is the first word after git's own options, whatever they are (review round 5: -C/p, -p, --bare and the like
  // are real spellings, and a list of known options let an unknown one hide the verb). -C and -c take the next word;
  // -c in any spelling runs config, so it is a person's call.
  for (const m of piece.matchAll(/(?:^|[\s;&|()`'"\/])git(?=\s)/g)) {
    const words = piece.slice(m.index + m[0].length).trim().split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      if (w === '-C') { i += 1; continue; }
      if (w === '-c' || /^-c./.test(w) || /^--config/.test(w)) return true;
      if (w.startsWith('-')) continue;
      if (!GIT_READ_OR_RECORD.has(w)) return true;
      // review round 6: a push that rewrites or deletes on the remote (--force, -f, +ref, :ref) is a person's call
      if (w === 'push' && words.slice(i + 1).some((x) => /^(?:--force(?:-with-lease)?(?:=\S*)?|-f|--mirror|--delete|-d|\+\S+|:\S+)$/.test(x))) return true;
      break;
    }
  }
  return false;
}
// PowerShell's own aliases for a delete or move, only for a PowerShell call (in a shell or Python they are other words)
const POWERSHELL_DELETES_OR_MOVES = /(?:^|[\s;&|()])(?:del|erase|rd|ri|mi|ren|rni|move|copy)(?=\s|$)/i;
const COMMAND_MAX = 100000;   // a longer command that names a protected place is a person's to read
const SEGMENT_MAX = 8000;     // so is a longer piece; the patterns stay linear on what they read
function bashLeftToPerson(command, powershell = false) {
  const flat = joined(command, powershell);
  if (!PROTECTED.test(command) && !PROTECTED.test(flat)) return false;   // names no protected place: answered, as before
  if (command.length > COMMAND_MAX) return true;
  if (PROTECTED.test(withoutPlanPaths(command)) || PROTECTED.test(withoutPlanPaths(flat))) return true;   // another name
  if (DOTDOT_ANYWHERE.test(command) || DOTDOT_ANYWHERE.test(flat)) return true;
  for (const text of [command, flat]) {
    for (const piece of text.split(/[\n;&|]+/)) {
      if (piece.length > SEGMENT_MAX) return true;
      if (DELETES_MOVES_OR_LINKS.some((r) => r.test(piece))) return true;
      if (gitLeftToPerson(piece)) return true;
      if (powershell && POWERSHELL_DELETES_OR_MOVES.test(piece)) return true;
    }
  }
  return false;
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
      if (bashLeftToPerson(t.command, req.tool_name === 'PowerShell')) return null;
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
