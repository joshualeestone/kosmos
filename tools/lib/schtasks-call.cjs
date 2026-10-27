'use strict';
/**
 * #7247: whether a child_process call RUNS schtasks.exe, read from the call alone (pure; no process is started).
 * tools/no-schtasks-preload.cjs refuses exactly these calls in a Windows test run.
 *
 * A call runs schtasks when schtasks is the program (by any path or case, with or without .exe), or when a shell or a
 * launcher in front of it does: cmd (/c, /k, /r), powershell or pwsh (-Command, a bare command, -EncodedCommand, which
 * is decoded), call and start, nested or quoted (cmd /c "schtasks /End"). The prefixes a command can carry are read
 * past too (#7270): NAME=value, cmd's @, cmd's if (exist, errorlevel, defined, a==b), nohup, exec, command, time,
 * nice, timeout with its duration, and a redirect with or without a space (schtasks>out.txt, 2>&1 schtasks). A call
 * through a shell (exec, execSync, shell: true) is read as a command line, every command in it. A word "schtasks"
 * anywhere else (a git grep pattern, a commit message, echo schtasks, command -v schtasks) is not a call: refusing
 * those would change results the guard has no business changing (review 1 of #7247).
 *
 * Without a shell, each launcher is read as it reads its arguments (callRuns): cmd the line node builds, PowerShell
 * the arguments joined, a POSIX shell or env one word per argument.
 *
 * Where a call can be read two ways it is read both ways, and either one running schtasks is enough, because refusing
 * is the side that cannot reach the real scheduler: a quoted word with a space (a command line, or one program path),
 * a cmd /c line that starts with a quote (as written, and with the first and last quote dropped, as cmd does), an
 * argument holding a double quote passed to cmd, and an exec line whose shell is not known (with backtick cuts, and
 * without). So these are refused though they run nothing: a here-document line that starts with schtasks (telling a
 * body from commands needs a real shell parser, and a reader that tried leaked, review 2 of #7270), echo `schtasks`
 * under cmd, "echo (schtasks)", and a redirect an outer shell already took (cmd /c "echo a b" > "x & schtasks"; it is
 * kept in the cmd line because node passes it through when cmd is the program).
 *
 * It reads command lines with a small tokenizer, not a full shell parser. What it does not see: a command built at run
 * time inside the shell (a variable, a script file run by powershell -File or cmd /c script.cmd), a PowerShell script
 * block or Start-Process (powershell -Command "& {schtasks}"), cmd /c with no space before the command, a launcher it
 * does not know (wsl, npx, xargs, sudo), a quoted path to a prefix word ("C:\tools x\nohup.exe" schtasks), a backtick
 * inside double quotes in a POSIX line (echo "`schtasks`"), and a lone apostrophe in a cmd line (cmd has no single
 * quotes, but this reads one as a quote, so "echo don't & schtasks" stays one command). test-support/tool-guard.js
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
   and the redirect with its file is one word marked redirect: it names a file, not the command (#7270), and it keeps
   its raw spelling so a line rebuilt from the words is the line cmd reads (review 5: cmd /c "echo a b" > "x & y"). */
function words(command) {
  const out = [];
  let raw = '';
  let quote = null;
  let op = '';   // a redirect read so far (>, >>, 2>, <), waiting for its file
  const push = () => {
    if (!raw) return;
    const q = raw.match(/^"([\s\S]*)"$/) || raw.match(/^'([\s\S]*)'$/);
    if (op) out.push({ raw: op + raw, text: raw.replace(/["']/g, ''), quoted: false, inner: null, redirect: true });
    else out.push({ raw, text: raw.replace(/["']/g, ''), quoted: !!q, inner: q ? q[1] : null });
    op = '';
    raw = '';
  };
  for (const ch of String(command)) {
    if (quote) { if (ch === quote) quote = null; raw += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; raw += ch; continue; }
    if (ch === '<' || ch === '>') {
      if (op && !raw) { op += ch; continue; }   // >>
      if (/^\d$/.test(raw) && !op) { op = raw + ch; raw = ''; continue; }   // the 2 of 2> names a stream
      push();
      op = ch;
      continue;
    }
    if (/\s/.test(ch)) { if (!(op && !raw)) push(); continue; }   // > out.txt: the file follows the space
    raw += ch;
  }
  push();
  return out;
}

/* PowerShell's -EncodedCommand: base64 of UTF-16LE. */
function decodePs(value) {
  try { return Buffer.from(String(value), 'base64').toString('utf16le'); } catch { return ''; }
}

/* The index of the value a switch takes, from k: a redirect in its slot is the outer shell's, not the value
   (powershell -ExecutionPolicy >nul Bypass -Command ..., review 7 of #7270). It skips a ">x" argv word the same
   way when no shell takes it (spawn('powershell', ['-ep', '>x', ...])); PowerShell rejects that value, so nothing
   leaks (#7299, left as is). */
function valueAt(ws, k) {
  while (k < ws.length && ws[k].redirect) k += 1;
  return k;
}

/* Whether the words, from index i, start schtasks: walking past any shell or launcher in front of it. */
function wordsRun(ws, i, depth, shell) {
  if (depth > DEPTH) return false;
  const rest = (k) => ws.slice(k).map((w) => w.raw).join(' ');
  while (i < ws.length) {
    const w = ws[i];
    if (w.redirect) { i += 1; continue; }   // >out.txt before the command
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
      for (i += 1; i < ws.length && (ws[i].redirect || /^\//.test(ws[i].text)); i += 1) {
        if (!ws[i].redirect && /^\/[ckr]$/i.test(ws[i].text)) {
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
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;
        const s = ws[i].text;
        if (/^-(command|c)$/i.test(s)) return lineRuns(rest(i + 1), depth + 1, 'other');
        if (/^-(encodedcommand|enc|e|ec)$/i.test(s)) {
          const v = valueAt(ws, i + 1);
          return v < ws.length && lineRuns(decodePs(ws[v].text), depth + 1, 'other');
        }
        if (/^-(file|f)$/i.test(s)) return false;   // a script file: what it runs cannot be read here
        if (PS_VALUE.test(s)) i = valueAt(ws, i + 1);
      }
      continue;   // powershell with a bare command: the next word starts it
    }
    if (POSIX_SHELL.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^[-+]/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(ws[i].text)) {   // -c, -lc, -ec (not -C)
          /* The script as one quoted word is read from its inside. */
          const script = ws[i + 1] && ws[i + 1].quoted ? ws[i + 1].inner : rest(i + 1);
          return lineRuns(script, depth + 1, 'posix');
        }
        if (/^[-+][oO]$/.test(ws[i].text)) i = valueAt(ws, i + 1);   // -o pipefail, +o errexit, -O extglob: the option's name is its value
        else if (/^--(rcfile|init-file)$/.test(ws[i].text)) i = valueAt(ws, i + 1);
      }
      return false;   // a script file: what it runs cannot be read here
    }
    /* env NAME=value ... program: the program after the assignments is what runs. */
    if (/^env(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i].text) || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;
        if (ws[i].text === '--') { i += 1; break; }   // #7299: -- ends env's options; the program follows
        if (/^(-S|--split-string)$/.test(ws[i].text)) return lineRuns(rest(i + 1), depth + 1, 'posix');   // -S STRING is the command line
        const joined = ws[i].text.match(/^(?:-S|--split-string=)(.+)$/);   // -S"..." and --split-string=... (review 3)
        if (joined) return lineRuns([joined[1], rest(i + 1)].join(' '), depth + 1, 'posix');
        if (/^(-[uC]|--unset|--chdir)$/.test(ws[i].text)) i = valueAt(ws, i + 1);   // -u NAME, -C DIR: the option's value is the next word
      }
      continue;
    }
    /* Words that start the command after them: nohup, exec, command, time, nice, and the shell keywords a command
       follows (then, else, do, while, until, {, !) (#7270). */
    if (/^(command|builtin)$/i.test(b)) {   // command -v, command -p -v: a lookup, which runs nothing
      let k = i + 1;
      // #7299: a redirect among its switches (command >nul -v schtasks) is skipped, as the prefix loop below does.
      for (; k < ws.length && (ws[k].redirect || /^-/.test(ws[k].text)); k += 1) if (!ws[k].redirect && /^-[a-zA-Z]*[vV]/.test(ws[k].text)) return false;
    }
    if (/^(nohup|exec|command|builtin|time|nice|then|else|do|while|until|\{|!)(\.exe)?$/i.test(b)) {
      // nice -n N / --adjustment N, exec -a NAME, time -f FMT / -o FILE / --format / --output: each keyword's own (#7299)
      const takes = /^nice/i.test(b) ? /^(-n|--adjustment)$/ : /^exec/i.test(b) ? /^-a$/ : /^time/i.test(b) ? /^(-[fo]|--format|--output)$/ : null;
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;   // #7299: a redirect's file is not a switch (nice >-n 5 x)
        if (takes && takes.test(ws[i].text)) i = valueAt(ws, i + 1);
      }
      continue;
    }
    /* timeout DURATION command. Windows' timeout /t 5 runs nothing, and reads so: /t is taken for the duration. */
    if (/^timeout(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;   // #7299: a redirect's file is not a switch
        if (/^(-[sk]|--signal|--kill-after)$/.test(ws[i].text)) i = valueAt(ws, i + 1);
      }
      i = valueAt(ws, i);
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
    if (/^start$/i.test(b)) {   // start [switches] ["title"] [switches] program: the first quoted word is the title
      let title = false;
      for (i += 1; i < ws.length && (/^\//.test(ws[i].text) || (!title && ws[i].quoted)); i += 1) {
        if (ws[i].quoted) title = true;
        else if (/^\/d$/i.test(ws[i].text)) i = valueAt(ws, i + 1);
      }
      continue;
    }
    return false;
  }
  return false;
}

/* Whether a shell command line starts schtasks in any of its commands. */
function lineRuns(text, depth, shell) {
  /* An exec line's shell is not known (cmd on Windows): read it with backtick cuts and without, and either one running
     schtasks is enough (review 5: a lone backtick, env A=`x schtasks, must not cut the command in two). */
  if (shell === undefined) return lineRuns(text, depth, 'posix') || lineRuns(text, depth, 'other');
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
  /* A line known to be PowerShell's or cmd's: a backtick in it is an escape or text, not a command (review 1). */
  const asLine = (parts) => lineRuns([base].concat(parts).join(' '), 0, 'other');
  if (options && options.windowsVerbatimArguments) {
    return CMD.test(base) || POWERSHELL.test(base) ? asLine(list) : commandRuns([base].concat(list).join(' '));
  }
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
