'use strict';

/**
 * kosmos#8406: the Windows twin of #4671's kill guard (install/kosmos-report-hook.sh, Mac and Linux only).
 *
 * On a Kosmos Windows computer every agent, the board and the Kosmos app are node.exe or claude.exe processes of
 * the person's own login. One command that stops every process of those names, every process of the user, or the
 * login session itself ends all of them at once, and nothing brings them back until the person signs in again.
 * The Mac guard came from a real incident (2026-09-29, a signal to process id -1). No Windows incident is known;
 * this refuses the Windows forms of the same act before it runs.
 *
 * Refused (any case, as Windows reads them), in the text a tool call would run or write:
 *   - taskkill by image name (/IM) of node, claude or kosmos (with or without .exe), or any image name with a *;
 *   - taskkill with a /FI filter on USERNAME (every process of a user), or on IMAGENAME naming one of the above;
 *   - PowerShell Stop-Process (or its aliases spps and kill) by -Name / -ProcessName of one of the above;
 *   - Get-Process (gps, ps) piped straight into Stop-Process with no name, or with one of the above;
 *   - wmic process delete / call terminate, unless it names a ProcessId;
 *   - logoff, shutdown with an end verb (/s /r /l /p /h /g, also as -s ...), Restart-Computer, Stop-Computer.
 * Allowed: taskkill /PID <n> (with /T and /F too), Stop-Process -Id <n>, taskkill or Stop-Process of any other image
 * name, a Get-Process filtered through Where-Object before Stop-Process, shutdown /a (it cancels one).
 *
 * 🛑 A SEATBELT, NOT A SANDBOX, as the Mac guard says of itself: it reads the literal text. A name computed at run
 * time, a script that builds the command, or a shape not listed above passes. A mention of one of these commands
 * inside another command (a commit message, a grep) is refused, and the message says to reword it.
 */

const NAMES = /^(node|claude|kosmos)/i;   // Kosmos's own processes: agents, board and app

/* What the guard reads: the fields of tool_input that run or are written, as the Mac guard's jq branch reads them.
   A .md or .markdown file's written content is a document, not a command, and is not read. */
function textOf(evt) {
  const t = evt && typeof evt.tool_input === 'object' && evt.tool_input ? evt.tool_input : null;
  if (!t) return '';
  const file = typeof t.file_path === 'string' ? t.file_path : (typeof t.notebook_path === 'string' ? t.notebook_path : '');
  const doc = /\.(md|markdown)$/i.test(file);
  const parts = [t.command, t.cmd, t.script, t.code, Array.isArray(t.args) ? t.args.filter((a) => typeof a === 'string').join(' ') : t.args];
  if (!doc) {
    parts.push(t.content, t.new_string, t.new_source);
    if (Array.isArray(t.edits)) for (const e of t.edits) if (e && typeof e === 'object') parts.push(e.new_string);
  }
  return parts.filter((p) => typeof p === 'string').join('\n');
}

const unquote = (s) => String(s || '').replace(/^["']+|["']+$/g, '');
const kosmosName = (s) => { const n = unquote(s); return n.includes('*') || NAMES.test(n); };

/* The reason a text would stop every Kosmos process or the session, or '' when it would not. */
function reason(text) {
  if (!text) return '';
  // One command at a time: a newline, ; & or | ends a taskkill/wmic/shutdown command (a pipe is read whole below).
  for (const cmd of text.split(/\r?\n|;|&&?|\|\|/)) {
    if (/(^|[^\w.-])taskkill(\.exe)?(?![\w.-])/i.test(cmd)) {
      for (const m of cmd.matchAll(/(?:^|\s)[/-]im\s+("[^"]*"|'[^']*'|\S+)/gi)) {
        if (kosmosName(m[1])) return 'a taskkill of every ' + unquote(m[1]) + ' process (every agent and the Kosmos board)';
      }
      for (const m of cmd.matchAll(/(?:^|\s)[/-]fi\s+("[^"]*"|'[^']*'|\S+)/gi)) {
        const f = unquote(m[1]).trim();
        if (/^username\b/i.test(f)) return 'a taskkill of every process of a user (it ends your whole login session)';
        const im = f.match(/^imagename\s+(eq|ne)\s+(\S+)/i);
        if (im && (im[1].toLowerCase() === 'ne' || kosmosName(im[2]))) return 'a taskkill of every ' + im[2] + ' process (every agent and the Kosmos board)';
      }
    }
    if (/(^|[^\w.-])wmic(\.exe)?(?![\w.-])/i.test(cmd) && /(^|\s)process(\s|$)/i.test(cmd)
        && /(^|\s)(delete|terminate)(\s|$)/i.test(cmd) && !/processid\s*=/i.test(cmd)) {
      return 'a wmic command that ends processes by name or all of them';
    }
    if (/(^|[^\w.-])logoff(\.exe)?(?![\w.-])/i.test(cmd)) return 'logoff (it ends your whole login session)';
    if (/(^|[^\w.-])shutdown(\.exe)?(?![\w.-])/i.test(cmd) && /(^|\s)[/-][srlphg](\s|$)/i.test(cmd) && !/(^|\s)[/-]a(\s|$)/i.test(cmd)) {
      return 'a shutdown command (it ends your whole login session or the computer)';
    }
    if (/(^|[^\w.-])(restart-computer|stop-computer)(?![\w.-])/i.test(cmd)) return 'a PowerShell command that restarts or stops the computer';
  }
  // PowerShell: by name, or a whole Get-Process piped into Stop-Process. Read per line, pipes kept.
  for (const line of text.split(/\r?\n|;/)) {
    for (const m of line.matchAll(/(?:^|[^\w-])(?:stop-process|spps|kill)(?![\w-])[^|]*?(?:^|\s)-(?:name|processname|n)\s+("[^"]*"|'[^']*'|[^\s,]+)/gi)) {
      if (kosmosName(m[1])) return 'a Stop-Process of every ' + unquote(m[1]) + ' process (every agent and the Kosmos board)';
    }
    for (const m of line.matchAll(/(?:^|[^\w-])(?:get-process|gps|ps)(?![\w-])((?:\s+[^|\s]+)*)\s*\|\s*(?:stop-process|spps|kill)(?![\w-])/gi)) {
      const args = m[1].trim().split(/\s+/).filter(Boolean).filter((a) => !/^-(name|processname|n)$/i.test(a));
      if (!args.length) return 'a Get-Process piped into Stop-Process with no name (every process you own)';
      if (args.some(kosmosName)) return 'a Stop-Process of every ' + unquote(args.find(kosmosName)) + ' process (every agent and the Kosmos board)';
    }
  }
  return '';
}

/* The guard for one hook event: { block: true, message } for a PreToolUse whose text is refused, else { block: false }.
   KOSMOS_KILL_GUARD=off turns it off, as on the Mac; an agent cannot change its own hook's environment. */
function check(evt, env) {
  if (!evt || evt.hook_event_name !== 'PreToolUse') return { block: false };
  if (env && env.KOSMOS_KILL_GUARD === 'off') return { block: false };
  const why = reason(textOf(evt));
  if (!why) return { block: false };
  const tool = typeof evt.tool_name === 'string' && evt.tool_name ? evt.tool_name : 'tool';
  return {
    block: true,
    message: 'Kosmos blocked this ' + tool + ' call: it contains ' + why + '. On this computer that ends every agent and the '
      + 'Kosmos board at once, and nothing brings them back until the person signs in again (kosmos#8406). Stop only '
      + 'exact process ids you started yourself and checked (taskkill /PID <n>, Stop-Process -Id <n>). If you are only '
      + 'writing ABOUT such a command, reword it.\n',
  };
}

module.exports = { check, reason, textOf };
