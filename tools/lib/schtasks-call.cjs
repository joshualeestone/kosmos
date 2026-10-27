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
 * command, and a here-document's body is not read as commands. A call through a shell (exec, execSync,
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

/* A here-document's body is text the shell feeds to a command, not commands (bash -c "cat <<'END' ... END"; #7270).
   Its lines are dropped, up to the line that ends it. Only a POSIX shell has them. A here-string (<<<) is not one, and
   neither is a shift inside arithmetic ($((1<<X)), review 1). */
function dropHeredocs(text) {
  const out = [];
  const ends = [];
  for (const line of String(text == null ? '' : text).split(/\r?\n/)) {
    if (ends.length) {
      const end = ends[0];
      if ((end.tabs ? line.replace(/^\t+/, '') : line) === end.word) ends.shift();
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g)) {
      const before = line.slice(0, m.index);
      if ((before.match(/\(\(/g) || []).length > (before.match(/\)\)/g) || []).length) continue;   // inside (( ))
      ends.push({ word: m[3], tabs: !!m[1] });
    }
  }
  return out.join('\n');
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
  for (const ch of shell === 'posix' ? dropHeredocs(text) : String(text == null ? '' : text)) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (cuts.includes(ch)) { parts.push(cur); cur = ''; continue; }
    cur += ch;
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

/* Whether quoted text with a space is one program path ("C:\Program Files\Git\bin\bash.exe"), not a command line
   that ends in one (schtasks /Query; exec /bin/bash): no separator, and no word after a space that starts a switch. */
function isPath(text) {
  return !/[&|;<>()`\r\n]/.test(text) && !/\s[/-]/.test(text);
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
    /* A quoted command as one word (cmd /c "schtasks /End"): read what is inside. A quoted path is a program, schtasks
       or a launcher read below ("C:\Program Files\Git\bin\bash.exe" -c ..., review 7). */
    if (w.quoted && /\s/.test(w.inner) && !(isPath(w.inner) && (PROGRAM.test(baseName(w.inner)) || isLauncher(baseName(w.inner))))) {
      return lineRuns(w.inner, depth + 1, shell);
    }
    /* NAME=value before the command sets its environment (X=1 schtasks): the command follows (#7270). */
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { i += 1; continue; }
    const b = baseName(w.text.replace(/^@/, ''));   // @schtasks: cmd's no-echo prefix
    if (PROGRAM.test(b)) return true;
    if (CMD.test(b)) {
      for (i += 1; i < ws.length && /^\//.test(ws[i].text); i += 1) {
        if (/^\/[ckr]$/i.test(ws[i].text)) {
          const line = rest(i + 1);
          /* cmd /c ""C:\Program Files\x\schtasks.exe" /End": cmd drops the first and last quote (#7270). */
          return lineRuns(line, depth + 1, 'other') || (/^""/.test(line) && /"$/.test(line) && lineRuns(line.slice(1, -1), depth + 1, 'other'));
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
          /* The script as one quoted word is read from its inside, once: reading the quoted form and then its inside
             would take a here-document twice and drop the commands after it (review 1). */
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
        if (/^-[uC]$/.test(ws[i].text)) i += 1;   // -u NAME, -C DIR: the option's value is the next word
      }
      continue;
    }
    /* Words that start the command after them: nohup, exec, command, time, nice, and the shell keywords a command
       follows (then, else, do, !) (#7270). */
    if (/^(command|builtin)$/.test(b) && i + 1 < ws.length && /^-[a-zA-Z]*[vV]/.test(ws[i + 1].text)) return false;   // command -v: a lookup
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
   arguments: through a shell as one command line, and without one as the words node hands the launcher. */
function callRuns(file, args, options) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (options && options.shell) return commandRuns([String(file)].concat(list).join(' '));
  const base = baseName(file);
  if (PROGRAM.test(base)) return true;
  if (isLauncher(base)) return wordsRun([base].concat(list).map(argWord), 0, 0);
  return false;
}

/* Without a shell each argument is one word: it is never cut at a newline, &, ; or a backtick on the way in (review 1).
   node quotes one that holds a space or a tab, and only then, so the launcher reads it as one word (cmd /c echo
   "a & schtasks" echoes, #7270), while one with no space reaches it bare (ver&schtasks runs schtasks). An argument
   already holding a double quote is left as written, so cmd's own ""path" args" form still reads as cmd reads it. */
function argWord(arg) {
  const text = arg.replace(/["']/g, '');
  if (/[ \t]/.test(arg) && !arg.includes('"')) return { raw: '"' + arg + '"', text, quoted: true, inner: arg };
  return { raw: arg, text, quoted: false, inner: null };
}

module.exports = { callRuns, commandRuns };
