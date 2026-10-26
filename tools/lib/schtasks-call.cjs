'use strict';
/**
 * #7247: whether a child_process call RUNS schtasks.exe, read from the call alone (pure; no process is started).
 * tools/no-schtasks-preload.cjs refuses exactly these calls in a Windows test run.
 *
 * A call runs schtasks when schtasks is the program (by any path or case, with or without .exe), or when a shell or a
 * launcher in front of it does: cmd (/c, /k, /r), powershell or pwsh (-Command, a bare command, -EncodedCommand, which
 * is decoded), call and start, nested or quoted (cmd /c "schtasks /End"). A call through a shell (exec, execSync,
 * shell: true) is read as a command line, every command in it. A word "schtasks" anywhere else (a git grep pattern, a
 * commit message, a script's source, echo schtasks) is not a call: refusing those would change results the guard has
 * no business changing (review 1 of #7247).
 *
 * It reads command lines with a small tokenizer, not a full shell parser. What it does not see: a command built at run
 * time inside the shell (a variable, a script file run by powershell -File or cmd /c script.cmd), a PowerShell script
 * block or Start-Process (powershell -Command "& {schtasks}"), cmd /c with no space before the command, a
 * launcher it does not know (wsl, npx), and a lone apostrophe in a cmd line (cmd has no single quotes, but this
 * reads one as a quote, so "echo don't & schtasks" stays one command). It errs the other way on a parenthesis outside
 * quotes: "echo (schtasks)" is read as running it, which only turns that echo into ENOENT. test-support/tool-guard.js
 * reads command position for its own CLIs with its own rules (a real install, judged by PATH); one shared reader for
 * both is #7262. PowerShell accepts any unique prefix of a parameter (-Com, -enco); only the spellings PS_VALUE and
 * the -Command and -EncodedCommand checks list are read, so "powershell -enco <base64>" is not decoded.
 */

const PROGRAM = /^schtasks(\.exe)?$/i;
const CMD = /^cmd(\.exe)?$/i;
/* The POSIX shells, which tests start with -c (Git Bash's are MSYS programs, which NODE_OPTIONS never reaches); the
   same set test-support/tool-guard.js reads. */
const POSIX_SHELL = /^(sh|bash|zsh|dash|ksh|fish)(\.exe)?$/i;
const POWERSHELL = /^(powershell|pwsh)(\.exe)?$/i;
/* PowerShell switches whose value is the next word, so the value is not taken for the command. */
const PS_VALUE = /^-(executionpolicy|ep|ex|windowstyle|w|version|v|inputformat|if|outputformat|of|configurationname|workingdirectory|wd|settingsfile|custompipename|psconsolefile)$/i;
const DEPTH = 6;   // shells inside shells, as far as anyone writes them

/* The last part of a program path, without quotes. */
function baseName(p) {
  return String(p == null ? '' : p).trim().replace(/^["']+|["']+$/g, '').split(/[\\/]/).pop();
}

/* A command line cut into its commands at &, |, ;, parentheses and line ends outside quotes, so a quoted argument
   (node -e "require('x')") stays whole. */
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

/* One command cut into words at spaces outside quotes. Each word keeps its raw spelling, its text without quotes, and
   whether it was one quoted string. */
function words(command) {
  const out = [];
  let raw = '';
  let quote = null;
  const push = () => {
    if (!raw) return;
    const q = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
    out.push({ raw, text: raw.replace(/["']/g, ''), quoted: !!q, inner: q ? q[1] : null });
    raw = '';
  };
  for (const ch of String(command)) {
    if (quote) { if (ch === quote) quote = null; raw += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; raw += ch; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    raw += ch;
  }
  push();
  return out;
}

/* PowerShell's -EncodedCommand: base64 of UTF-16LE. */
function decodePs(value) {
  try { return Buffer.from(String(value), 'base64').toString('utf16le'); } catch { return ''; }
}

/* Whether the words, from index i, start schtasks: walking past any shell or launcher in front of it. */
function wordsRun(ws, i, depth) {
  if (depth > DEPTH) return false;
  const rest = (k) => ws.slice(k).map((w) => w.raw).join(' ');
  while (i < ws.length) {
    const w = ws[i];
    /* A quoted command as one word (cmd /c "schtasks /End"): read what is inside. A quoted path is a program. */
    if (w.quoted && /\s/.test(w.inner) && !PROGRAM.test(baseName(w.inner))) return lineRuns(w.inner, depth + 1);
    const b = baseName(w.text);
    if (PROGRAM.test(b)) return true;
    if (CMD.test(b)) {
      for (i += 1; i < ws.length && /^\//.test(ws[i].text); i += 1) {
        if (/^\/[ckr]$/i.test(ws[i].text)) return lineRuns(rest(i + 1), depth + 1);
      }
      continue;   // cmd with no /c: what follows is read as the command
    }
    if (POWERSHELL.test(b)) {
      for (i += 1; i < ws.length && /^-/.test(ws[i].text); i += 1) {
        const s = ws[i].text;
        if (/^-(command|c)$/i.test(s)) return lineRuns(rest(i + 1), depth + 1);
        if (/^-(encodedcommand|enc|e|ec)$/i.test(s)) return i + 1 < ws.length && lineRuns(decodePs(ws[i + 1].text), depth + 1);
        if (/^-(file|f)$/i.test(s)) return false;   // a script file: what it runs cannot be read here
        if (PS_VALUE.test(s)) i += 1;
      }
      continue;   // powershell with a bare command: the next word starts it
    }
    if (POSIX_SHELL.test(b)) {
      for (i += 1; i < ws.length && /^[-+]/.test(ws[i].text); i += 1) {
        if (/^-[a-z]*c[a-z]*$/i.test(ws[i].text)) return lineRuns(rest(i + 1), depth + 1);   // -c, -lc, -ec
        if (/^[-+]o$/.test(ws[i].text)) i += 1;   // -o pipefail, +o errexit: the option's name is its value
      }
      return false;   // a script file: what it runs cannot be read here
    }
    /* env NAME=value ... program: the program after the assignments is what runs. */
    if (/^env(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i].text) || /^-/.test(ws[i].text)); i += 1) {
        if (/^-[uCS]$/.test(ws[i].text)) i += 1;   // -u NAME, -C DIR, -S STRING: the option's value is the next word
      }
      continue;
    }
    if (/^call$/i.test(b)) { i += 1; continue; }
    if (/^start$/i.test(b)) {
      i += 1;
      if (i < ws.length && ws[i].quoted) i += 1;   // the window title
      for (; i < ws.length && /^\//.test(ws[i].text); i += 1) if (/^\/d$/i.test(ws[i].text)) i += 1;
      continue;
    }
    return false;
  }
  return false;
}

/* Whether a shell command line starts schtasks in any of its commands. */
function lineRuns(text, depth) {
  return commands(text).some((part) => wordsRun(words(part.trim()), 0, depth));
}
function commandRuns(text) {
  return lineRuns(text, 0);
}

/* Whether spawn/execFile(file, args, options) runs schtasks. A shell or a launcher as the program is read with its
   arguments as one command line. */
function callRuns(file, args, options) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (options && options.shell) return commandRuns([String(file)].concat(list).join(' '));
  const base = baseName(file);
  if (PROGRAM.test(base)) return true;
  if (CMD.test(base) || POWERSHELL.test(base) || POSIX_SHELL.test(base) || /^env(\.exe)?$/i.test(base)) return commandRuns([base].concat(list).join(' '));
  return false;
}

module.exports = { callRuns, commandRuns };
