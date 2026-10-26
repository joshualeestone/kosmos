'use strict';
/**
 * #7247: whether a child_process call RUNS schtasks.exe, read from the call alone (pure; no process is started).
 * tools/no-schtasks-preload.cjs refuses exactly these calls in a Windows test run.
 *
 * A call runs schtasks when schtasks is the program (by any path or case, with or without .exe), or when a shell runs
 * it: the program is cmd, powershell or pwsh and its command line starts a command with schtasks, or the call goes
 * through a shell (exec, execSync, shell: true) and the command line does. A word "schtasks" anywhere else (a git grep
 * pattern, a commit message, a script's source) is not a call: refusing those would change results the guard has no
 * business changing (review 1 of #7247).
 */

const PROGRAM = /^schtasks(\.exe)?$/i;
const SHELL_PROGRAM = /^(cmd|powershell|pwsh)(\.exe)?$/i;
/* A shell, a wrapper or a launcher in front of the real command, with its switches: cmd /c, powershell -NoProfile
   -Command, call, start "title". Taken off the front of a command so the program after it is what is judged. */
const LEADER = /^(?:["']?(?:[^\s"']*[\\/])?(?:cmd|powershell|pwsh)(?:\.exe)?["']?(?:\s+[-/][^\s]*)*|&|call|start(?:\s+"[^"]*")?)\s+([\s\S]*)$/i;

/* The last part of a program path, without quotes. */
function baseName(p) {
  return String(p == null ? '' : p).trim().replace(/^["']+|["']+$/g, '').split(/[\\/]/).pop();
}

/* The program a command starts with: a quoted path is one token. */
function firstToken(s) {
  const t = String(s).trim();
  const q = t.match(/^"([^"]*)"/) || t.match(/^'([^']*)'/);
  return q ? q[1] : t.split(/\s+/)[0];
}

/* A command line cut into its commands at &, |, ;, parentheses and line ends that are outside quotes (a quoted
   argument such as node -e "require('x')" stays whole). */
function commands(text) {
  const parts = [];
  let cur = '';
  let quote = null;
  for (const ch of String(text == null ? '' : text)) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('&|;()\r\n'.includes(ch)) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/* Whether a shell command line starts schtasks in any of its commands, after taking off any shell or launcher in
   front. */
function commandRuns(text) {
  return commands(text).some((part) => {
    let s = part.trim();
    for (let i = 0; i < 4; i++) {
      const m = s.match(LEADER);
      if (!m) break;
      s = m[1].trim();
    }
    return PROGRAM.test(baseName(firstToken(s)));
  });
}

/* Whether spawn/execFile(file, args, options) runs schtasks. */
function callRuns(file, args, options) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (options && options.shell) return commandRuns([String(file)].concat(list).join(' '));
  const base = baseName(file);
  if (PROGRAM.test(base)) return true;
  if (SHELL_PROGRAM.test(base)) return commandRuns(base + ' ' + list.join(' '));
  return false;
}

module.exports = { callRuns, commandRuns };
