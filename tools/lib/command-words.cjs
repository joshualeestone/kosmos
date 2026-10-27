'use strict';
/**
 * #7262: the words a child_process call can RUN, read from the call alone (pure; no process is started). The one reader
 * both test guards use: tools/lib/schtasks-call.cjs (#7247, schtasks.exe on Windows) and test-support/tool-guard.js
 * (#4326, a real gh, vercel or cloudflared). Each guard gives its own verdict on each word; this file only says which
 * words are in command position. Moved out of schtasks-call.cjs (#7270), so the two guards cannot drift apart again.
 *
 * A word is in command position when it is the program (by any path or case, with or without .exe), or when a shell or
 * a launcher in front of it starts it: cmd (/c, /k, /r), powershell or pwsh (-Command, a bare command, -EncodedCommand,
 * which is decoded), call and start, nested or quoted (cmd /c "schtasks /End"). The prefixes a command can carry are
 * read past too (#7270): NAME=value, cmd's @, cmd's if (exist, errorlevel, defined, a==b), nohup, exec, command, time,
 * nice, sudo (#7262, the prefix tool-guard read and this did not), timeout with its duration, and a redirect with or
 * without a space (schtasks>out.txt, 2>&1 schtasks). A call through a shell (exec, execSync, shell: true) is read as a
 * command line, every command in it. A word anywhere else (a git grep pattern, a commit message, echo schtasks,
 * command -v schtasks) is not in command position: refusing those would change results the guards have no business
 * changing (review 1 of #7247). The launcher and prefix words themselves are returned too (they run as well); a guard
 * that does not know them ignores them.
 *
 * Without a shell, each launcher is read as it reads its arguments (callWords): cmd the line node builds, PowerShell
 * the arguments joined, a POSIX shell, env or sudo one word per argument.
 *
 * Where a call can be read two ways it is read both ways and the words of both are returned, so a guard that refuses
 * on any word refuses when either reading would run its program, because refusing is the side that cannot reach the
 * real thing: a quoted word with a space (a command line, or one program path), a cmd /c line that starts with a quote
 * (as written, and with the first and last quote dropped, as cmd does), an argument holding a double quote passed to
 * cmd, and an exec line whose shell is not known (with backtick cuts, and without). So these return words that run
 * nothing: a here-document line (telling a body from commands needs a real shell parser, and a reader that tried
 * leaked, review 2 of #7270), echo `x` under cmd, "echo (x)", and a redirect an outer shell already took
 * (cmd /c "echo a b" > "x & y"; it is kept in the cmd line because node passes it through when cmd is the program).
 *
 * It reads command lines with a small tokenizer, not a full shell parser. What it does not see: a command built at run
 * time inside the shell (a variable, a script file run by powershell -File or cmd /c script.cmd), a PowerShell script
 * block or Start-Process (powershell -Command "& {schtasks}"), cmd /c with no space before the command, a launcher it
 * does not know (wsl, npx, xargs, doas), and a lone apostrophe in a cmd line (cmd has no single quotes, but this reads
 * one as a quote, so "echo don't & schtasks" stays one command). In a POSIX line (or an exec line, whose shell is not
 * known) a $( ) or a backtick inside double quotes is read as the command it is (#7262). PowerShell accepts any unique
 * prefix of a parameter (-Com, -enco); only the spellings PS_VALUE and the -Command and -EncodedCommand checks list are
 * read, so "powershell -enco <base64>" is not decoded.
 */

const CMD = /^cmd(\.exe)?$/i;
/* The POSIX shells, which tests start with -c (Git Bash's are MSYS programs, which NODE_OPTIONS never reaches). */
const POSIX_SHELL = /^(sh|bash|zsh|dash|ksh|fish)(\.exe)?$/i;
const POWERSHELL = /^(powershell|pwsh)(\.exe)?$/i;
const ENV = /^env(\.exe)?$/i;
const SUDO = /^sudo$/i;
/* The prefix words that are programs too, so a call can name one as its file: spawn('nohup', ['x']) runs x (#7262). */
const PREFIX_PROGRAM = /^(nohup|time|nice|timeout)(\.exe)?$/i;
/* A program this reads past to the command it starts, when it is the program of a call with no shell. */
function isLauncher(base) {
  return CMD.test(base) || POWERSHELL.test(base) || POSIX_SHELL.test(base) || ENV.test(base) || SUDO.test(base)
    || PREFIX_PROGRAM.test(base);
}
/* PowerShell switches whose value is the next word, so the value is not taken for the command. */
const PS_VALUE = /^-(executionpolicy|ep|ex|windowstyle|w|version|v|inputformat|if|outputformat|of|configurationname|workingdirectory|wd|settingsfile|custompipename|psconsolefile)$/i;
/* sudo options that take a value (-u USER, -g GROUP, -C FD, -D DIR, -p PROMPT, -h HOST, -r ROLE, -t TYPE, -U USER,
   -T TIMEOUT), and the long forms that take one. */
const SUDO_VALUE_LETTERS = 'ugCDphrtUT';
const SUDO_VALUE_LONG = /^--(user|group|close-from|chdir|prompt|host|role|type|other-user|command-timeout)$/;
/* Whether a sudo option takes the NEXT word as its value. In a cluster the first value-taking letter takes the rest of
   the cluster when there is any (-uroot), and the next word only when it is the last letter (-iu root) (#7262
   review 5: reading the cluster's last letter alone took the t of -uroot for -t). */
function sudoTakesNext(opt) {
  if (SUDO_VALUE_LONG.test(opt)) return true;
  if (!/^-[^-]/.test(opt)) return false;
  for (let k = 1; k < opt.length; k += 1) if (SUDO_VALUE_LETTERS.includes(opt[k])) return k === opt.length - 1;
  return false;
}
/* Prefix words with options that take a value: nice -n N, exec -a NAME, time -f FMT and -o FILE (review 5: one shared
   set read time -a, which takes none, as taking the next word). */
const PREFIX_VALUE = { nice: /^(-n|--adjustment)$/, exec: /^-a$/, time: /^(-f|-o|--format|--output)$/ };
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
  const chars = Array.from(String(text == null ? '' : text));
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    /* A POSIX backslash takes the next character as text, inside double quotes and out (echo "a \" b"; gh, #7262
       review 4). Both characters are kept, so a path reads the same. Not inside single quotes, and not in a cmd or
       PowerShell line, where a backslash is a path separator (an exec line is read both ways, so C:\x is still seen). */
    if (ch === '\\' && shell !== 'other' && quote !== "'" && i + 1 < chars.length) {
      cur += ch + chars[i + 1];
      prev = chars[i + 1];
      i += 1;
      continue;
    }
    /* Inside double quotes a POSIX shell still runs $( ) and backticks (TOKEN="$(gh auth token)", #7262 review 1):
       their commands are read as well, and the quoted word itself stays whole. */
    if (quote === '"' && shell !== 'other' && ((ch === '$' && chars[i + 1] === '(') || ch === '`')) {
      const end = ch === '`' ? chars.indexOf('`', i + 1) : closeParen(chars, i + 2);
      const stop = end < 0 ? chars.length : end;
      parts.push(...commands(chars.slice(ch === '`' ? i + 1 : i + 2, stop).join(''), shell));
      cur += chars.slice(i, stop + 1).join('');
      prev = chars[Math.min(stop, chars.length - 1)];
      i = stop;
      continue;
    }
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

/* The index of the ) that closes a $( whose inside starts at from, counting nested parentheses; -1 if none. */
function closeParen(chars, from) {
  let depth = 1;
  let q = null;
  for (let k = from; k < chars.length; k += 1) {
    const c = chars[k];
    // A ) inside quotes, or escaped, does not close it (echo "$(echo ')' ; gh)", review 5).
    if (q) { if (c === '\\' && q === '"') k += 1; else if (c === q) q = null; continue; }
    if (c === '\\') { k += 1; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return k;
  }
  return -1;
}

/* One command cut into words at spaces outside quotes. Each word keeps its raw spelling, its text without quotes, and
   whether it was one quoted string. A redirect (>, >>, <, 2>) ends a word with or without a space (schtasks>out.txt),
   and the redirect with its file is one word marked redirect: it names a file, not the command (#7270), and it keeps
   its raw spelling so a line rebuilt from the words is the line cmd reads (review 5: cmd /c "echo a b" > "x & y"). */
function words(command, shell) {
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
  const chars = Array.from(String(command));
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    // A POSIX backslash takes the next character as text, as in commands().
    if (ch === '\\' && shell !== 'other' && quote !== "'" && i + 1 < chars.length) { raw += ch + chars[i + 1]; i += 1; continue; }
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
   (powershell -ExecutionPolicy >nul Bypass -Command ..., review 7 of #7270). */
function valueAt(ws, k) {
  while (k < ws.length && ws[k].redirect) k += 1;
  return k;
}

/* Collects into out every word, from index i, that runs: walking past any shell or launcher in front of the command. */
function walk(ws, i, depth, shell, out) {
  if (depth > DEPTH) return;
  const rest = (k) => ws.slice(k).map((w) => w.raw).join(' ');
  while (i < ws.length) {
    const w = ws[i];
    if (w.redirect) { i += 1; continue; }   // >out.txt before the command
    /* A quoted word with a space is either a command line (cmd /c "schtasks /End") or one program path
       ("C:\Program Files\Git\bin\bash.exe" -c ...). Both are read (review 3: "D:\wt - copy\schtasks.exe" is a path
       that also looks like switches). A launcher's path goes on to be read below as that launcher. */
    if (w.quoted && /\s/.test(w.inner)) {
      lineInto(w.inner, depth + 1, shell, out);
      out.push(w.inner);
      if (!isLauncher(baseName(w.inner))) return;
    }
    /* NAME=value before the command sets its environment (X=1 schtasks): the command follows (#7270). */
    if (!w.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w.text)) { i += 1; continue; }
    // @schtasks: cmd's no-echo prefix. \gh: a POSIX shell's way past an alias, which still runs gh (#7262 review 4).
    const word = shell === 'other' ? w.text.replace(/^@/, '') : w.text.replace(/^@/, '').replace(/^\\(?=[^\\])/, '');
    out.push(word);
    const b = baseName(word);
    if (CMD.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^\//.test(ws[i].text)); i += 1) {
        if (!ws[i].redirect && /^\/[ckr]$/i.test(ws[i].text)) {
          const line = rest(i + 1).trim();
          /* A line after /c that starts with a quote: unless it is exactly one quoted program, cmd drops that quote and
             the LAST quote on the line, which can move an & out of quotes (cmd /c "a b" "x & schtasks"; review 4, seen
             live). It is read both as written and stripped. */
          const last = line.lastIndexOf('"');
          lineInto(line, depth + 1, 'other', out);
          if (line.startsWith('"') && last > 0) lineInto(line.slice(1, last) + line.slice(last + 1), depth + 1, 'other', out);
          return;
        }
      }
      continue;   // cmd with no /c: what follows is read as the command
    }
    if (POWERSHELL.test(b)) {
      /* A switch this does not list may take a value, which the walk below then reads as the command
         (pwsh -Exec Bypass -Command gh, review 5). So -Command and -EncodedCommand are also looked for anywhere after
         the program, and read as well as the walk. */
      for (let k = i + 1; k < ws.length; k += 1) {
        if (/^-(command|c)$/i.test(ws[k].text)) { lineInto(rest(k + 1), depth + 1, 'other', out); break; }
        if (/^-(encodedcommand|enc|e|ec)$/i.test(ws[k].text)) {
          const v = valueAt(ws, k + 1);
          if (v < ws.length) lineInto(decodePs(ws[v].text), depth + 1, 'other', out);
          break;
        }
      }
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;
        const s = ws[i].text;
        if (/^-(command|c)$/i.test(s)) { lineInto(rest(i + 1), depth + 1, 'other', out); return; }
        if (/^-(encodedcommand|enc|e|ec)$/i.test(s)) {
          const v = valueAt(ws, i + 1);
          if (v < ws.length) lineInto(decodePs(ws[v].text), depth + 1, 'other', out);
          return;
        }
        if (/^-(file|f)$/i.test(s)) return;   // a script file: what it runs cannot be read here
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
          lineInto(script, depth + 1, 'posix', out);
          return;
        }
        if (/^[-+][oO]$/.test(ws[i].text)) i = valueAt(ws, i + 1);   // -o pipefail, +o errexit, -O extglob: the option's name is its value
        else if (/^--(rcfile|init-file)$/.test(ws[i].text)) i = valueAt(ws, i + 1);
        else if (/^fish(\.exe)?$/i.test(b) && /^(-C|--init-command)$/.test(ws[i].text)) {
          // fish -C CMD runs CMD before the script (review 5), so its value is read as a command line too.
          i = valueAt(ws, i + 1);
          if (i < ws.length) lineInto(ws[i].quoted ? ws[i].inner : ws[i].text, depth + 1, 'posix', out);
        }
      }
      return;   // a script file: what it runs cannot be read here
    }
    /* env NAME=value ... program: the program after the assignments is what runs. */
    if (ENV.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i].text) || /^-/.test(ws[i].text)); i += 1) {
        if (ws[i].redirect) continue;
        if (/^(-S|--split-string)$/.test(ws[i].text)) { lineInto(rest(i + 1), depth + 1, 'posix', out); return; }   // -S STRING is the command line
        const joined = ws[i].text.match(/^(?:-S|--split-string=)(.+)$/);   // -S"..." and --split-string=... (review 3)
        if (joined) { lineInto([joined[1], rest(i + 1)].join(' '), depth + 1, 'posix', out); return; }
        if (/^(-[uC]|--unset|--chdir)$/.test(ws[i].text)) i = valueAt(ws, i + 1);   // -u NAME, -C DIR: the option's value is the next word
      }
      continue;
    }
    /* sudo [options] [NAME=value ...] program (#7262). */
    if (SUDO.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (sudoTakesNext(ws[i].text)) i = valueAt(ws, i + 1);
      }
      continue;
    }
    /* Words that start the command after them: nohup, exec, command, time, nice, and the shell keywords a command
       follows (then, else, do, while, until, {, !) (#7270). */
    if (/^(command|builtin)$/i.test(b)) {   // command -v, command -p -v: a lookup, which runs nothing
      for (let k = i + 1; k < ws.length && /^-/.test(ws[k].text); k += 1) if (/^-[a-zA-Z]*[vV]/.test(ws[k].text)) return;
    }
    if (/^(nohup|exec|command|builtin|time|nice|then|else|do|while|until|\{|!)(\.exe)?$/i.test(b)) {
      const takes = PREFIX_VALUE[b.toLowerCase().replace(/\.exe$/, '')];
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) {
        if (takes && takes.test(ws[i].text)) i = valueAt(ws, i + 1);
      }
      continue;
    }
    /* timeout DURATION command. Windows' timeout /t 5 runs nothing, and reads so: /t is taken for the duration. */
    if (/^timeout(\.exe)?$/i.test(b)) {
      for (i += 1; i < ws.length && (ws[i].redirect || /^-/.test(ws[i].text)); i += 1) if (/^(-[sk]|--signal|--kill-after)$/.test(ws[i].text)) i = valueAt(ws, i + 1);
      i = valueAt(ws, i);
      if (i < ws.length && /^\//.test(ws[i].text)) return;
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
    return;
  }
}

/* Collects the words every command of a shell command line runs. */
function lineInto(text, depth, shell, out) {
  /* An exec line's shell is not known (cmd on Windows): read it with backtick cuts and without (review 5: a lone
     backtick, env A=`x schtasks, must not cut the command in two). */
  if (shell === undefined) { lineInto(text, depth, 'posix', out); lineInto(text, depth, 'other', out); return; }
  for (const part of commands(text, shell)) walk(words(part.trim(), shell), 0, depth, shell, out);
}

/* The words a shell command line (exec, execSync, shell: true) runs, in every one of its commands. */
function lineWords(text) {
  const out = [];
  lineInto(text, 0, undefined, out);
  return [...new Set(out)];   // a line read two ways names most words twice
}

/* The words spawn/execFile(file, args, options) runs: the program first. A shell or a launcher as the program is read
   with its arguments the way that program reads them (review 3):
   - through a shell, or with windowsVerbatimArguments, as one command line of the arguments as they are;
   - cmd: the command line node builds (libuv's quoting), which cmd reads with its own quote rules, so cmd /c echo
     "a & schtasks" echoes while ver&schtasks and x"&schtasks run it. An argument holding a double quote is read
     both as node quotes it and as written (cmd's own ""path" args" form);
   - PowerShell: the arguments joined with spaces, as PowerShell joins whatever follows -Command;
   - a POSIX shell, env, sudo, nohup, time, nice or timeout: each argument is one word, as they receive argv (MSYS bash
     honours node's quoting). */
function callWords(file, args, options) {
  const list = Array.isArray(args) ? args.map(String) : [];
  if (options && options.shell) return lineWords([String(file)].concat(list).join(' '));
  const out = [String(file)];
  const base = baseName(file);
  if (!isLauncher(base)) return out;
  /* A line known to be PowerShell's or cmd's: a backtick in it is an escape or text, not a command (review 1). */
  const asLine = (parts) => lineInto([base].concat(parts).join(' '), 0, 'other', out);
  if (options && options.windowsVerbatimArguments) {
    if (CMD.test(base) || POWERSHELL.test(base)) asLine(list);
    else lineInto([base].concat(list).join(' '), 0, undefined, out);
    return [...new Set(out)];
  }
  if (POWERSHELL.test(base)) asLine(list);
  else if (CMD.test(base)) {
    asLine(list.map(nodeQuote));
    if (list.some((x) => x.includes('"'))) asLine(list);
  } else walk([base].concat(list).map(argWord), 0, 0, undefined, out);
  return [...new Set(out)];
}

/* How node (libuv's quote_cmd_arg) writes one argument into a Windows command line: an empty one or one with a space,
   tab or double quote is quoted, a double quote inside becomes \", and backslashes before a quote are doubled. */
function nodeQuote(arg) {
  if (arg === '') return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return '"' + arg + '"';
  let s = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') { slashes += 1; continue; }
    if (ch === '"') { s += '\\'.repeat(slashes * 2 + 1) + '"'; slashes = 0; continue; }
    s += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  return s + '\\'.repeat(slashes * 2) + '"';
}

/* An argument handed to a POSIX shell, env or sudo is one word: never cut at a newline, &, ; or a backtick on the way
   in. One with a space, a tab or a quote is one quoted word whose inside is the argument itself. */
function argWord(arg) {
  const text = arg.replace(/["']/g, '');
  if (/[ \t"']/.test(arg)) return { raw: '"' + arg + '"', text, quoted: true, inner: arg };
  return { raw: arg, text, quoted: false, inner: null };
}

module.exports = { callWords, lineWords, baseName };
