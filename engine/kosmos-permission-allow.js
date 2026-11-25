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
   commands is leaky (dd of=, >|, quoted paths, interpreter one-liners, git reset --hard, PowerShell cmdlets all slipped
   through it), so any OTHER protected name keeps #5406's rule. A plan path holding ".." is not a plan path.
   A TEXT HEURISTIC, as touchesProtected is: a script file, or a path built so no protected name appears, is not seen
   (and such a command was answered before this change too). */
// A plan path, strictly (review round 2): plain filename characters only, in one or more segments, so nothing the shell
// expands or splits ($, braces, commas, globs, quotes, backslash escapes) can sit inside it and turn it into another
// path. PLAN_END: what may follow it (the end, whitespace, an operator, or a closing quote then one of those); anything
// else attached to it (.claude/plans/x.md$IFS.git, a brace list, .claude/plans/.\"\"./x) means it is not a plan path.
const PLAN_MENTION = /(?<![A-Za-z0-9_.-])\.claude[\\/]plans[\\/][A-Za-z0-9_.@+~-]+(?:[\\/][A-Za-z0-9_.@+~-]+)*/gi;
// After a closing quote, a comma or a closing bracket is fine too (a path in a python call: edit('.claude/plans/x.md', ...)):
// in a shell brace list the next element is then outside the match, where PROTECTED still sees it.
const PLAN_END = /^(?:$|[\s;&|)<>,\]}]|['"](?:$|[\s;&|)<>,\]}]))/;
const DOT_SEGMENT = /(?:^|[\\/])\.+(?=[\\/]|$)/;   // a segment made only of dots: . or .. (or ...) is not a file name here
function withoutPlanPaths(command) {
  return command.replace(PLAN_MENTION, (m, at) => {
    const after = command.slice(at + m.length, at + m.length + 2);
    const inner = m.slice('.claude/plans/'.length);
    // review round 3: .claude/plans/x/.git/hooks/pre-commit is a .git path, not a plan
    const protectedInside = inner.split(/[\\/]/).some((seg) => PROTECTED.test(seg));
    return PLAN_END.test(after) && !DOT_SEGMENT.test(inner) && !protectedInside ? ' ' : m;
  });
}
// Judged on the command as the shell runs it (review round 2's over-catch: a plan's own words, "- rm the old file" in a
// heredoc or "rm old step" in a commit message, sent plan edits back to the phone): quoted strings and heredoc bodies
// are taken out first for these plain shell words. Safe because by now the only protected names left are plan files,
// so a delete hidden inside a string could only reach a plan file, which git keeps.
const SHELL_DELETES_OR_MOVES = [
  /(?:^|[\s;&|()`'"\\/!\[,])(?:rm|rmdir|unlink|shred|trash|mv)(?=[\s'",\]]|$)/i,   // quotes count once the text is a shell's
  /\b(?:Remove-Item|Move-Item|Rename-Item)\b/i,
  /\bfind\b[^;&|]*?\s-(?:delete|exec)/i,
  /\bgit\b[^;&|]*?\s(?:clean|rm|mv|config)\b/i,   // config: core.hooksPath points git at code to run (review round 3)
];
// PowerShell's own aliases for a delete or move, only for a PowerShell call (in a shell or Python they are other words)
const POWERSHELL_DELETES_OR_MOVES = /(?:^|[\s;&|()])(?:del|erase|rd|ri|mi|ren|rni|move|copy)(?=\s|$)/i;
// Judged on the full text, strings and heredocs included: code in a heredoc or a -c string really runs, and a link made
// through a plan folder lets a later write reach anywhere (review round 2).
const ANYWHERE_DELETES_MOVES_OR_LINKS = [
  // links (review rounds 2 and 3): any spelling a script or tool makes one with
  /(?:^|[\s;&|()`'"\\/])(?:ln|mklink|link)(?=\s|$)|\b(?:SymbolicLink|Junction|HardLink|symlink|symlink_to|hardlink_to|symlinkSync|linkSync)\b|\bfs\.(?:promises\.)?(?:symlink|link)\b|\bcp\s+(?:-\w*[sl]\w*\s)|--link-dest\b/i,
  // deletes and moves in code or by tools that remove the original (review rounds 1 and 3)
  /\b(?:rmtree|rmSync|unlinkSync|rmdirSync|renameSync|File\.delete|File\.unlink|FileUtils\.rm\w*)\b|\bos\.(?:remove|unlink|rmdir|rename|replace)\b|\bshutil\.move\b|\.(?:rm|unlink|rename|rmdir)\(|\bfs\.(?:promises\.)?(?:rm|unlink|rmdir|rename)\b|\[IO\.(?:File|Directory)\]::(?:Delete|Move)/i,
  /--remove-files\b|--remove-source-files\b|\btruncate\b|\b(?:gzip|bzip2|xz)\b(?![^\n;&|]*\s-\w*[ck])|\bzip\s+-\w*m|\bgit\b[^;&|]{0,400}?\sstash\b|\bcmd(?:\.exe)?\s+\/c\b/i,
];
const SEGMENT_MAX = 8000;   // a longer piece is left to the person: these patterns stay linear-ish on what they read
// The command with heredoc bodies and quoted strings taken out (a string that does not close runs to the end of its line).
const RUNS_TEXT = /(?:^|[\s;&|(\/`])(?:ba|z|k|da|c|tc|fi)?sh\b|\b(?:python\d*(?:\.\d+)?|node|nodejs|deno|bun|perl|ruby|php|awk|gawk|osascript|pwsh|powershell|cmd)\b|\b(?:system|exec\w*|spawn\w*|popen|subprocess)\b|\balias\.|\benv\s+(?:-\w+\s+)*-S\b|\$\(|`|\beval\b|\bxargs\b|\bsource\b|(?:^|[\s;&|])\.\s/i;
function canStrip(command) {
  if (RUNS_TEXT.test(command)) return false;
  if (/\bgit\b[^;&|\n]{0,400}?\s-c\s/.test(command)) return false;   // git -c (lower case: -C is a folder) runs config
  for (const line of command.split('\n')) {
    // a << the stripper would read as a heredoc but the shell does not: after a comment mark, or only inside quotes
    const unquoted = line.replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, ' ');
    if (/<</.test(line) && (!/<</.test(unquoted) || /#.*<</.test(unquoted))) return false;
  }
  if (/\\['"]|\$'|<<<|\$\(\(|\r/.test(command)) return false;
  // every heredoc tag must be a whole word the stripper can match, and every quote must close on its line
  for (const line of command.split('\n')) {
    if (/<</.test(line) && !/<<-?\s*(?:'[A-Za-z_][A-Za-z0-9_]*'|"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)(?=$|[\s;&|)<>])/.test(line)) return false;
  }
  return true;
}
function shellWords(command) {
  const lines = command.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const tag = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?(?=$|[\s;&|)<>])/.exec(lines[i]);
    if (tag) { while (i + 1 < lines.length && lines[i + 1].replace(/^\t+/, '') !== tag[1]) i += 1; }
  }
  // Only quotes that close on their line are taken out; one left open means the stripper may read it otherwise than the
  // shell does, so the full text is judged (null).
  const out = kept.join('\n').replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, ' ');
  return /['"]/.test(out) ? null : out;
}
const COMMAND_MAX = 200000;   // review round 3: a command this long that names a protected place is a person's to read
// The text as the shell joins it (review round 3: .g'i't and .cl\aude hid a name from PROTECTED): quotes taken out and
// a shell's backslash escapes undone; for PowerShell, its backtick escapes (its backslashes are path separators).
function joined(command, powershell) {
  return powershell ? command.replace(/['"]/g, '').replace(/`(.)/g, '$1')
    : command.replace(/['"]/g, '').replace(/\\(.)/g, '$1');
}
function bashLeftToPerson(command, powershell = false) {
  if (!PROTECTED.test(command) && !PROTECTED.test(joined(command, powershell))) return false;   // names none: as before
  if (command.length > COMMAND_MAX) return true;
  if (PROTECTED.test(withoutPlanPaths(joined(command, powershell)))) return true;   // a name hidden by quoting
  if (powershell && command.split(/[\n;&|]+/).some((piece) => POWERSHELL_DELETES_OR_MOVES.test(piece))) return true;
  const rest = withoutPlanPaths(command);
  if (PROTECTED.test(rest)) return true;        // another protected name than a plan file: #5406's rule, as before
  for (const piece of command.split(/[\n;&|]+/)) {
    if (piece.length > SEGMENT_MAX) return true;
    if (ANYWHERE_DELETES_MOVES_OR_LINKS.some((r) => r.test(piece))) return true;
  }
  // Strings and heredoc bodies are taken out only when nothing in the command can run them (review round 3): no
  // interpreter or shell (by name or path), no -c or -e flag, no system/exec/spawn, no git -c or alias, no env -S, no
  // command substitution, eval, xargs or source; and only when the stripper reads the text as the shell does (no
  // escaped quote, $'...', <<<, $((, carriage return, or a quote left open). Otherwise the full text is judged.
  const words = canStrip(command) ? shellWords(command) : null;
  const stripped = words === null ? command : words;
  for (const piece of stripped.split(/[\n;&|]+/)) {
    if (piece.length > SEGMENT_MAX) return true;
    if (SHELL_DELETES_OR_MOVES.some((r) => r.test(piece))) return true;
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
