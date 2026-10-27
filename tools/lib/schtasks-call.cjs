'use strict';
/**
 * #7247: whether a child_process call RUNS schtasks.exe, read from the call alone (pure; no process is started).
 * tools/no-schtasks-preload.cjs refuses exactly these calls in a Windows test run.
 *
 * A call runs schtasks when schtasks is the program (by any path or case, with or without .exe), or when a shell or a
 * launcher in front of it does: cmd (/c, /k, /r), powershell or pwsh (-Command, a bare command, -EncodedCommand, which
 * is decoded), call and start, nested or quoted (cmd /c "schtasks /End"). The prefixes a command can carry are read
 * past too (#7270): NAME=value, cmd's @, cmd's if (exist, errorlevel, defined, a==b), nohup, exec, command, time,
 * nice, timeout with its duration, and a redirect with or without a space (schtasks>out.txt); backticks start a
 * command (outside a line known to be cmd's or PowerShell's). A here-document's body is read as commands, as it was:
 * a line in it that starts with schtasks is refused even where only cat reads it. Telling a body apart from commands
 * needs a real shell parser, and a reader that tried leaked (review 2 of #7270: a << in a quote or a comment switched
 * the guard off for the rest of the script); refusing is the side that cannot reach the real scheduler. A backtick in
 * an exec line of unknown shell cuts it, so echo `schtasks` under cmd is refused too. A call through a shell (exec, execSync,
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
/* A program this reads past to the command it starts. */
function isLauncher(base) {
  return CMD.test(base) || POWERSHELL.test(base) || POSIX_SHELL.test(base) || /^env(\.exe)?$/i.test(base);
}
const POWERSHELL = /^(powershell|pwsh)(\.exe)?$/i;
/* PowerShell switches whose value is the next word, so the value is not taken for the command. */
const PS_VALUE = /^-(executionpolicy|ep|ex|windowstyle|w|version|v|inputformat|if|outputformat|of|configurationname|workingdirectory|wd|settingsfile|custompipename|psconsolefile)$/i;
const DEPTH = 6;   // shells inside shells, as far as anyone writes them

/* The last part of a program path, without quotes. */
function baseName(p) {
  return String(p == null ? '' : p).trim().replace(/^["']+|["']+$/g, '').split(/[\\/]/).pop();
}

/* A command line cut into its commands at &, |, ;, parentheses and line ends outside quotes, so a quoted argument
   (node -e "require('x')") stays whole. Backticks start a command too, except in a line known to be cmd's or
   PowerShell's (where a backtick is text or an escape, review 1). shell is 'posix', 'other' or undefined (not known:
   exec's own shell). */
function commands(text, shell) {
  const parts = [];
  let cur = '';
  let quote = null;
  const cuts = shell === 'other' ? '&|;()\r\n' : '&|;()`\r\n';
  let prev = '';
  for (const ch of String(text == null ? '' : text)) {
    if (quote) { if (ch === quote) quote = null; cur += ch; prev = ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; prev = ch; continue; }
    if (ch === '&' && (prev === '>' || prev === '<')) { cur += ch; prev = ch; continue; }   // 2>&1: a redirect (review 3)
    if (cuts.includes(ch)) { parts.push(cur); cur = ''; prev = ch; continue; }
    cur += ch;
    prev = ch;
  }
  parts.push(cur);
  return parts;
}

/* One command cut into words at spaces outside quotes. Each word keeps its raw spelling, its text without quotes, and
   whether it was one quoted string. A redirect (>, >>, <, 2>) ends a word with or without a space (schtasks>out.txt),
   and its target is not a word: it names a file, not the command (#7270). */
function words(command) {
  const out = [];
  let raw = '';
  let quote = null;
  let target = false;   // the next word is a redirect's file
  const push = () => {
    if (!raw) return;
    const q = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
    if (target) target = false;
    else out.push({ raw, text: raw.replace(/["']/g, ''), quoted: !!q, inner: q ? q[1] : null });
    raw = '';
  };
  for (const ch of String(command)) {
    if (quote) { if (ch === quote) quote = null; raw += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; raw += ch; continue; }
    if (ch === '<' || ch === '>') {
      if (/^\d$/.test(raw) && !target) raw = '';   // the 2 of 2> names a stream, not a word
      push();
      target = true;
      continue;
    }
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
function wordsRun(ws, i, depth, shell) {
  if (depth > DEPTH) return false;
  const rest = (k) => ws.slice(k).map((w) => w.raw).join(' ');
  while (i < ws.length) {
    const w = ws[i];
    /* A quoted word with a space is either a command line (cmd /c "schtasks /End") or one program path
       ("C:\Program Files\Git\bin\bash.exe" -c ...). Both are read, and either one running schtasks is enough
       (review 3: "D:\wt - copy\schtasks.exe" is a path that also looks like switches). A launcher's path goes on to
       be read below as that launcher. */
    if (w.quoted && /\s/.test(w.inner)) {
      if (lineRuns(w.inner, depth + 1, shell) || PROGRAM.test(baseName(w.inner))) return true;
      if (!isLauncher(baseName(w.inner))) return false;
    }
    /* NAME=value before the command sets its environment (X=1 schtasks): the command follows (#7270). */
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { i += 1; continue; }
    const b = baseName(w.text.replace(/^@/, ''));   // @schtasks: cmd's no-echo prefix
    if (PROGRAM.test(b)) return true;
    if (CMD.test(b)) {
      for (i += 1; i < ws.length && /^\//.test(ws[i].text); i += 1) {
        if (/^\/[ckr]$/i.test(ws[i].text)) {
          const line = rest(i + 1).trim();
          /* A line after /c that starts with a quote: unless it is exactly one quoted program, cmd drops that quote and
             the LAST quote on the line, which can move an & out of quotes (cmd /c "a b" "x & schtasks"; review 4, seen
             live). It is read both as written and stripped, and either one running schtasks is enough. */
          const last = line.lastIndexOf('"');
          const stripped = line.startsWith('"') && last > 0 ? line.slice(1, last) + line.slice(last + 1) : null;
          return lineRuns(line, depth + 1, 'other') || (stripped !== null && lineRuns(stripped, depth + 1, 'other'));
        }
      }
      continue;   // cmd with no /c: what follows is read as the command
    }
    if (POWERSHELL.test(b)) {
      for (i += 1; i < ws.length && /^-/.test(ws[i].text); i += 1) {
        const s = ws[i].text;
        if (/^-(command|c)$/i.test(s)) return lineRuns(rest(i + 1), depth + 1, 'other');
        if (/^-(encodedcommand|enc|e|ec)$/i.test(s)) return i + 1 < ws.length && lineRuns(decodePs(ws[i + 1].text), depth + 1, 'other');
        if (/^-(file|f)$/i.test(s)) return false;   // a script file: what it runs cannot be read here
        if (PS_VALUE.test(s)) i += 1;
      }
      continue;   // powershell with a bare command: the next word starts it
    }
    if (POSIX_SHELL.test(b)) {
      for (i += 1; i < ws.length && /^[-+]/.test(ws[i].text); i += 1) {
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(ws[i].text)) {   // -c, -lc, -ec (not -C)
          /* The script as one quoted word is read from its inside. */
          const script = ws[i + 1] && ws[i + 1].quoted ? ws[i + 1].inner : rest(i + 1);
          return lineRuns(script, depth + 1, 'posix');
        }
        if (/^[-+][oO]$/.test(ws[i].text)) i += 1;   // -o pipefail, +o errexit, -O extglob: the option's name is its value
        else if (/^--(rcfile|init-file)$/.test(ws[i].text)) i += 1;
      }
      return false;   // a script file: what it runs cannot be read here
    }
    /* env NAME=value ... program: the program after the assignments is what runs. */
    if (/^env(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i].text) || /^-/.test(ws[i].text)); i += 1) {
        if (/^(-S|--split-string)$/.test(ws[i].text)) return lineRuns(rest(i + 1), depth + 1, 'posix');   // -S STRING is the command line
        const joined = ws[i].text.match(/^(?:-S|--split-string=)(.+)$/);   // -S"..." and --split-string=... (review 3)
        if (joined) return lineRuns([joined[1], rest(i + 1)].join(' '), depth + 1, 'posix');
        if (/^-[uC]$/.test(ws[i].text)) i += 1;   // -u NAME, -C DIR: the option's value is the next word
      }
      continue;
    }
    /* Words that start the command after them: nohup, exec, command, time, nice, and the shell keywords a command
       follows (then, else, do, !) (#7270). */
    if (/^(command|builtin)$/.test(b)) {   // command -v, command -p -v: a lookup, which runs nothing
      let k = i + 1;
      for (; k < ws.length && /^-/.test(ws[k].text); k += 1) if (/^-[a-zA-Z]*[vV]/.test(ws[k].text)) return false;
    }
    if (/^(nohup|exec|command|builtin|time|nice|then|else|do|!)$/i.test(b)) {
      for (i += 1; i < ws.length && /^-/.test(ws[i].text); i += 1) if (/^-(n|a)$/.test(ws[i].text)) i += 1;
      continue;
    }
    /* timeout DURATION command. Windows' timeout /t 5 runs nothing, and reads so: /t is taken for the duration. */
    if (/^timeout(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && /^-/.test(ws[i].text); i += 1) if (/^-(s|k)$/.test(ws[i].text)) i += 1;
      if (i < ws.length && /^\//.test(ws[i].text)) return false;
      i += 1;   // the duration
      continue;
    }
    /* cmd's if: [/i] [not] exist PATH, errorlevel N, defined NAME, or a==b, then the command. bash's if and elif are
       followed by the command itself. */
    if (/^(if|elif)$/i.test(b)) {
      i += 1;
      if (i < ws.length && /^\/i$/i.test(ws[i].text)) i += 1;
      if (i < ws.length && /^not$/i.test(ws[i].text)) i += 1;
      if (i < ws.length && /^(exist|errorlevel|defined)$/i.test(ws[i].text)) i += 2;
      else if (i < ws.length && ws[i].raw.includes('==')) i += 1;
      else if (i + 2 < ws.length && /^(==|equ|neq|lss|leq|gtr|geq)$/i.test(ws[i + 1].text)) i += 3;
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
function lineRuns(text, depth, shell) {
  return commands(text, shell).some((part) => wordsRun(words(part.trim()), 0, depth, shell));
}
function commandRuns(text) {
  return lineRuns(text, 0);
}

/* Whether spawn/execFile(file, args, options) runs schtasks. A shell or a launcher as the program is read with its
   arguments the way that program reads them (review 3):
   - through a shell, or with windowsVerbatimArguments, as one command line of the arguments as they are;
   - cmd: the command line node builds (libuv's quoting), which cmd reads with its own quote rules, so cmd /c echo
     "a & schtasks" echoes while ver&schtasks and x"&schtasks run it. An argument holding a double quote is read
     both as node quotes it and as written, and either one running schtasks is enough (cmd's own ""path" args" form);
   - PowerShell: the arguments joined with spaces, as PowerShell joins whatever follows -Command;
   - a POSIX shell or env: each argument is one word, as they receive argv (MSYS bash honours node's quoting). */
function callRuns(file, args, options) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (options && options.shell) return commandRuns([String(file)].concat(list).join(' '));
  const base = baseName(file);
  if (PROGRAM.test(base)) return true;
  if (!isLauncher(base)) return false;
  const asWritten = () => commandRuns([base].concat(list).join(' '));
  if (options && options.windowsVerbatimArguments) return asWritten();
  /* A line known to be PowerShell's or cmd's: a backtick in it is an escape or text, not a command (review 1). */
  const asLine = (parts) => lineRuns([base].concat(parts).join(' '), 0, 'other');
  if (POWERSHELL.test(base)) return asLine(list);
  if (CMD.test(base)) return asLine(list.map(nodeQuote)) || (list.some((x) => x.includes('"')) && asLine(list));
  return wordsRun([base].concat(list).map(argWord), 0, 0);
}

/* How node (libuv's quote_cmd_arg) writes one argument into a Windows command line: an empty one or one with a space,
   tab or double quote is quoted, a double quote inside becomes \", and backslashes before a quote are doubled. */
function nodeQuote(arg) {
  if (arg === '') return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return '"' + arg + '"';
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') { slashes += 1; continue; }
    if (ch === '"') { out += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

/* An argument handed to a POSIX shell or env is one word: never cut at a newline, &, ; or a backtick on the way in.
   One with a space, a tab or a quote is one quoted word whose inside is the argument itself. */
function argWord(arg) {
  const text = arg.replace(/["']/g, '');
  if (/[ \t"']/.test(arg)) return { raw: '"' + arg + '"', text, quoted: true, inner: arg };
  return { raw: arg, text, quoted: false, inner: null };
}

module.exports = { callRuns, commandRuns };
