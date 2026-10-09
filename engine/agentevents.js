'use strict';
/**
 * kosmos#5683 slice 1 (board half, part 1a): tell the company when its own rules refused an agent's action.
 * The contract is kosmos-relay's `POST /v1/mac/org/agent-events` (plan: kosmos-relay .claude/plans/agentevents-5683.md):
 * Mac-signed, at most 50 events a send, each { world, agent, at, action, rule, targetClass, sessionRef, toolUseRef }.
 *
 * WHICH REFUSALS COUNT. Only rules the company placed (decided on the card, Pete agreed): the token-only guard's deny
 * rules and its sandbox. Only token-only agents (engine/sendertoken.js tokenOnlyList) WHOSE GUARD IS IN FORCE (their
 * settings hold the guard's token rules; review 16) run under them, so only their transcripts are read: a person's own deny rules on any OTHER agent, and the auto-mode classifier, are never reported.
 * ⚠️ On a token-only agent the guard's rules share one deny list with the person's own (setup-assistant keeps what was
 * there), and Claude Code's refusal text is the same for both, so such an agent's refusal by the PERSON's own rule is
 * reported as the guard's (review 6; a stated premise, beside the sandbox text match). A tool whose own output starts
 * with that refusal text, as an error, is also read as one (review 9): bounded by the fixed classes, never content.
 *
 * WHERE A REFUSAL IS SEEN. Claude Code writes a deny-rule refusal into the session transcript as an error tool result,
 * "Permission to use <Tool> with command <cmd> has been denied." (measured, 2.1.295). Its PermissionDenied hook fires
 * only for the auto-mode classifier (measured in the same build), so the transcript is the one place a deny-rule
 * refusal is recorded. A sandbox refusal is a Bash result carrying "Operation not permitted".
 *
 * A REFERENCE, NEVER CONTENT. An event carries the session id and the tool use id (Josh 08:41: the company may open
 * the conversation, through the content view #5686, which logs who looked). The command, the path and the text are
 * never sent: the target is one of a few fixed classes.
 *
 * Part 1a reads this Kosmos's own agents; the other Kosmoses on the same computer (Josh 08:43) are part 1b.
 *
 * scanText() reads lines and is NOT pure: it updates the call map it is given. tick() keeps a small state file, gates on
 * the enrollment, and sends.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROUTE = '/v1/mac/org/agent-events';
const SEND_MAX = 50;
const PENDING_MAX = 500;          // kept while sends fail; the oldest go first when it is full
const PAST_MS = 7 * 86400 * 1000; // the coordinator refuses an event older than 7 days
const READ_MAX = 4 * 1024 * 1024; // bytes read from one transcript in one tick; the rest next tick
const STATE_FILE = 'agent-events.json';
const LABEL_MAX = 128;
const AHEAD_S = 300;               // the coordinator refuses an event more than 5 minutes ahead
const SEND_PAST_MS = PAST_MS - 3600 * 1000;   // an hour short of 7 days, so a queued event never expires in flight
/* Tool uses seen but not yet answered, per transcript, kept in memory across ticks (a result can land a tick after its
   call). Lost on a restart: such a result is then classified without its call: the tool from the denial text, or Bash
   for an "Operation not permitted" (only a shell result carries it here; review 5), and target 'other'. Bounded per
   file. */
const CALLS = new Map();
let TURN = 0;   // which agent is read first this tick (review 5), kept in memory
const UNLISTABLE_SAID = new Set();   // said once per agent per process (review 21)
const UNGUARDED_SAID = new Set();   // said once per agent per process (review 17: never silent)
const CALLS_MAX = 2000;
const TICK_READ_MAX = 16 * 1024 * 1024;   // bytes read across ALL transcripts in one tick (review 2: the read is sync)
const RETRY_AFTER_FAIL_MS = 30 * 60 * 1000;   // a send that failed waits this long before the next (as the rollup)
/* Without a guard check for this long, a guard may have lapsed unseen (review 24). The stored confirmation is refreshed
   only once it is over GUARD_REFRESH_MS old (review 25: refreshing every tick rewrote the state every tick), so with
   five-minute ticks it can be 15 minutes old at an ordinary check; the gap is that plus two missed ticks and a margin
   (reviews 26 and 27: at 11, then 20, minutes a missed tick fired it). */
const GUARD_GAP_MS = 30 * 60 * 1000;
const GUARD_REFRESH_MS = 10 * 60 * 1000;

/* A deny-rule refusal: it starts "Permission to use <Tool>" and ends "has been denied." Tested on the head and the tail
   only (review 19: one regex over a 4 MB result could backtrack on agent-shaped text). */
const DENIED_HEAD = /^Permission to use ([A-Za-z][A-Za-z0-9_]*)\b/;
const DENIED_TAIL = / has been denied\.?\s*$/;
function denied(text) {
  const m = DENIED_HEAD.exec(text.slice(0, 200));
  return m && DENIED_TAIL.test(text.slice(-64)) ? m[1] : null;
}
const SANDBOX = /\bOperation not permitted\b/;
const ACTION = Object.freeze({
  Bash: 'run', Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write',
  Read: 'read', Glob: 'read', Grep: 'read', WebFetch: 'network', WebSearch: 'network',
});
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];

/* One label as the coordinator accepts it: 1 to 128 characters, no control or bidi character. Else null (not sent). */
function label(v) {
  if (typeof v !== 'string' || !v.trim()) return null;   // review 7: not blank, as the coordinator
  const chars = [...v];
  /* Over the limit: the first 120 characters and a short hash of the whole name (review 6: two long names sharing
     their first 128 characters would otherwise merge on the console). */
  const s = chars.length <= LABEL_MAX ? v : chars.slice(0, 120).join('') + '~' + crypto.createHash('sha256').update(v).digest('hex').slice(0, 7);
  return /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u115f\u1160\u3164\uffa0\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufe00-\ufe0f\ufeff]|\udb40[\udc00-\udc7f]/.test(s) ? null : s;
}

/* A reference (a session or tool use id) as the coordinator accepts it: 1 to 128 of [A-Za-z0-9_-] (relay review 7:
   free text there could carry content in pieces). Claude Code's session ids and tool use ids are of that form. */
function ref(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
}

/* The text of a tool result: a string, or the text blocks of a list. */
function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return '';
}

/* Which class of target a refused call aimed at: never the path itself. */
function targetClass(tool, input, ctx) {
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'network-host';
  const paths = [];
  let hidden = [];   // path words a glob, a variable or a substitution hides (review 19)
  for (const k of PATH_KEYS) if (input && typeof input[k] === 'string' && input[k]) paths.push(input[k]);
  if (tool === 'Bash' && input && typeof input.command === 'string') {
    /* Every path-like word in the command (reviews 3, 4, 6 and 9), split as a shell splits: quotes and backslash-escaped
       spaces keep a word whole (the board's own folder is under "Application Support"), $HOME and ${HOME} are the home
       folder, a leading @ (curl's @file) names the file, and a quoted argument holding a command (bash -c "...",
       python -c '...') is split once more. A network command is the PROGRAM word (review 9: `\bssh\b` matched ~/.ssh)
       with a URL among its words. Linear, on the first 4096 characters (Renet's review 8 of slice 3: no backtracking). */
    let net = false;
    let url = false;
    let rsync = false;
    const look = (words, depth) => {
      let wrapped = false;   // the word before was a wrapper (sudo, env, timeout...): this one is the program (review 11)
      let takesValue = false;
      let prog = '';   // the program of the current command (review 32)
      let prevW = '';
      for (const { w, first: f0 } of words) {
        const prev = prevW; prevW = w;
        if (f0) prog = '';
        let first = f0 || wrapped;
        if (wrapped && takesValue) { takesValue = false; continue; }   // the value of -u, -g, -n... (review 19)
        if (wrapped && /^-[ugnpUCDTrt]$/.test(w)) { takesValue = true; continue; }
        if (wrapped && (/^-/.test(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || /^\d+[smhd]?$/.test(w))) continue;   // its options, K=V, a duration
        wrapped = false;
        if (first && /^(sudo|env|timeout|nice|nohup|command|xargs|time|exec|doas)$/.test(path.basename(w))) { wrapped = true; continue; }
        if (first && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { wrapped = true; continue; }   // FOO=1 curl ... (review 14)
        if (first) {
          /* review 10: ssh, scp, sftp, nc and ncat reach another machine by what they are (they take a host, never a
             URL); curl and wget count with a URL among the words; rsync only with a remote host:path word. */
          prog = path.basename(w);
          if (/^(ssh|scp|sftp|nc|ncat)$/.test(prog)) { net = true; url = true; }
          else if (/^(curl|wget|git)$/.test(prog)) net = true;   // git with a URL (push, clone, fetch to it)
          else if (prog === 'rsync') rsync = true;
          continue;   // the program run, not what it was aimed at (review 8)
        }
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(w)) { url = true; continue; }
        if (rsync && /^([^\s/@]+@)?[A-Za-z0-9.-]+::?[^\s]*$/.test(w) && !w.startsWith('/')) { net = true; url = true; }
        if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(w)) url = true;   // git@host:repo, user@host:path (review 19)
        /* One rule for a quoted word with spaces (review 32, replacing the patches of reviews 30 and 31): it is a COMMAND
           only as the script of a shell's -c or of eval, and then it is split and never one path (its first word is a
           program, not a target). Anywhere else it is ONE argument, so one path, whatever it holds ("R & D", "Tom &
           Jerry"); it is also split, which can only find more. */
        if (depth === 0 && /\s/.test(w)) {
          look(shellWords(w), 1);
          if ((/^(sh|bash|zsh|dash|ksh|fish|su)$/.test(prog) && /^-[A-Za-z]*c$/.test(prev)) || prog === 'eval') continue;
        }
        let v = w.replace(/^--?[A-Za-z-]+=/, '').replace(/^-[A-Za-z](?=[/~.])/, '').replace(/^@/, '');   // -C/dir too
        v = v.replace(/^\$\{HOME\}|^\$HOME/, '~');
        if (/^\/dev\//.test(v)) continue;   // a redirect to /dev/null is not a target (review 8)
        if (/[*?$`[{]/.test(v)) hidden.push(v);   // [ and { are globs too (review 32: Kosm[o]s, Kosmo{s,})
        /* A path: from ~ or /, ./ or ../, a dotted name (.claude/settings.json, review 7), or a word with a slash and no
           space (a whole quoted command is split above instead); a relative one resolves against the agent's folder. */
        if (/^(~|\/|\.\.?\/|\.[A-Za-z0-9_])/.test(v) || (v.includes('/') && !/\s/.test(v))) paths.push(v);
        if (paths.length >= 64) return;
      }
    };
    look(shellWords(input.command.slice(0, 4096)), 0);
    /* A network command is network-host before any path it names (decided, review 5): sending something out is the
       telling part, whatever it sends. */
    if (net && url) return 'network-host';
  }
  let best = 'other';
  for (const p of paths) {
    const c = pathClass(p, ctx);
    if (RANK.indexOf(c) < RANK.indexOf(best)) best = c;
  }
  /* A path a glob, a variable or a substitution hides cannot be resolved (review 19): when the command names the board
     token or Kosmos's own folder, or the agent's config, that is the class. */
  /* Only the words that could not be resolved are looked at (review 20: the whole command matched a named world's own
     agent folders, which sit under Application Support/Kosmos, and relabelled an agent's own files as the board's). */
  if (hidden.length) {   // (the own-folder words are dropped first, below)
    /* Each hidden word on its own (review 21: anchored to the end of all of them joined, a later hidden word hid it). */
    /* A hidden word whose fixed start resolves inside the agent's own folder is the agent's (review 24: a globbed
       worlds.json under the agent's own maps folder read as the board's registry). */
    // $PWD, ${PWD} and $(pwd) are the agent's own folder (review 25).
    /* A word with no fixed start that does not begin with a variable (a bare glob like a star then /worlds.json) is
       relative, so it is the agent's own folder's (review 26); paths fold case on a Mac, as pathClass does. */
    const fold2 = (x) => (process.platform === 'darwin' ? x.toLowerCase() : x);
    const own = (w0) => { const w = w0.replace(/^(\$\{?PWD\}?|\$\(pwd\))(?=\/|$)/, '.'); const pre = w.split(/[*?$`[{]/)[0]; if (!ctx.agentDir) return false; if (!pre) return !/^[$`]/.test(w); const r = path.resolve(ctx.agentDir, pre.replace(/^~(?=\/|$)/, ctx.home || os.homedir())); return fold2(r) === fold2(ctx.agentDir) || fold2(r).startsWith(fold2(ctx.agentDir) + path.sep); };
    /* A word whose fixed start resolves at, under, or toward a board root inside the agent's folder (an agent connected at
       the home folder, review 30: ~/Library/Application\ Support/Kosmo?/board.token was dropped as the agent's own) is
       kept, as pathClass checks such a root before the agent's own folder (review 28). */
    const inRoots = [ctx.boardRoot, ...(ctx.boardRoots || [])].filter((r) => r && ctx.agentDir && fold2(r).startsWith(fold2(ctx.agentDir) + path.sep));
    /* Segment by segment (review 31: a string prefix kept ./star/worlds.json, which cannot reach the root's depth): the
       word's first segments, as globs, must match every segment of the root. A segment with a variable or substitution
       may expand to anything, so it keeps the word. */
    const seg = (x) => x.split(path.sep).filter(Boolean);
    /* Globs as the shell reads them (review 33, replacing review 32's): * and ? within a segment; a [...] class whose
       body is plain characters and ranges is that class, and any other bracket form ([]o], [[:lower:]], a backslash)
       is any one character, which can only match more. Braces are expanded before this (expandBraces). */
    const globRe = (g) => {
      let re = '';
      for (let i = 0; i < g.length; i++) {
        const ch = g[i];
        if (ch === '*') { re += '[^/]*'; continue; }
        if (ch === '?') { re += '[^/]'; continue; }
        if (ch === '[') {
          let j = i + 1;
          if (g[j] === '!' || g[j] === '^') j++;
          if (g[j] === ']') j++;   // a leading ] is a member
          while (j < g.length && g[j] !== ']') j = g.startsWith('[:', j) && g.indexOf(':]', j + 2) > 0 ? g.indexOf(':]', j + 2) + 2 : j + 1;
          if (j < g.length) {
            const body = g.slice(i + 1, j);
            re += /^!?[A-Za-z0-9._-]+$/.test(body) && !/^!?-|-$/.test(body) ? '[' + body.replace(/^!/, '^') + ']' : '[^/]';
            i = j;
            continue;
          }
        }
        re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      try { return new RegExp('^' + re + '$', process.platform === 'darwin' ? 'i' : ''); } catch { return /[^]/; }
    };
    const toBoard = (w0) => {
      if (!inRoots.length) return false;
      const w = w0.replace(/^(\$\{?PWD\}?|\$\(pwd\))(?=\/|$)/, '.').replace(/^~(?=\/|$)/, ctx.home || os.homedir());
      if (/^[$`]/.test(w)) return false;   // starts with another variable: not the agent's own either (own() keeps it)
      const ws = seg(path.isAbsolute(w) ? w : path.join(ctx.agentDir, w));
      return inRoots.some((b) => { const bs = seg(b); for (let i = 0; i < bs.length; i++) { if (i >= ws.length) return false; if (/[$`]/.test(ws[i])) return true; if (!globRe(ws[i]).test(bs[i])) return false; } return true; });
    };
    /* {a,b} is expanded first, as the shell does before globbing (review 33: a brace spanning a / broke the segment
       match); an unbalanced brace is literal. At most 64 words per hidden word. A word left with no glob or variable
       is an ordinary path, classed as one. */
    const expandBraces = (w) => {
      const out = [];
      const go = (x) => {
        if (out.length >= 64) return;
        let depth = 0; let open = -1; const commas = [];
        for (let i = 0; i < x.length; i++) {
          if (x[i] === '{') { if (depth === 0) open = i; depth++; }
          else if (x[i] === ',' && depth === 1) commas.push(i);
          else if (x[i] === '}' && depth > 0 && --depth === 0) {
            if (!commas.length) { open = -1; commas.length = 0; continue; }
            const parts = []; let k = open + 1;
            for (const cpos of commas) { parts.push(x.slice(k, cpos)); k = cpos + 1; }
            parts.push(x.slice(k, i));
            for (const part of parts) go(x.slice(0, open) + part + x.slice(i + 1));
            return;
          }
        }
        out.push(x);
      };
      go(w);
      return out;
    };
    hidden = hidden.flatMap(expandBraces);
    for (const w of hidden.filter((x) => !/[*?$`[]/.test(x))) {
      const c = pathClass(w, ctx);
      if (RANK.indexOf(c) < RANK.indexOf(best)) best = c;
    }
    hidden = hidden.filter((w) => toBoard(w) || !own(w));
    /* The glob analogue of pathClass's board check (review 33: board.t[o]ken, and a star in every segment, named no board file
       literally): a word whose segments, as globs, match every segment of a board root (one that does not contain the
       agent's folder) can reach the board's files. */
    const roots = [ctx.boardRoot, ...(ctx.boardRoots || [])].filter((r) => r && !(ctx.agentDir && (fold2(ctx.agentDir) + path.sep).startsWith(fold2(r) + path.sep)));
    const reaches = (w0) => {
      const w = w0.replace(/^(\$\{?PWD\}?|\$\(pwd\))(?=\/|$)/, '.').replace(/^~(?=\/|$)/, ctx.home || os.homedir());
      if (/^[$`]/.test(w) || !ctx.agentDir && !path.isAbsolute(w)) return false;
      const ws = seg(path.isAbsolute(w) ? w : path.join(ctx.agentDir, w));
      return roots.some((b) => { const bs = seg(b); if (ws.length < bs.length) return false; for (let i = 0; i < bs.length; i++) { if (/[$`]/.test(ws[i])) return false; if (!globRe(ws[i]).test(bs[i])) return false; } return true; });
    };
    const board = hidden.some((w) => reaches(w) || /board\.token|agent-token-only\.json|worlds\.json|Application Support\/Kosmos\/[^/]*$/i.test(w));
    const config = hidden.some((w) => /(^|[\s/'"])\.claude(\/|\b)|CLAUDE\.md|\.mcp\.json/.test(w));
    if (board && RANK.indexOf('board-files') < RANK.indexOf(best)) best = 'board-files';
    else if (config && RANK.indexOf('agent-config') < RANK.indexOf(best)) best = 'agent-config';
  }
  /* The first 4096 characters are classed word by word; past them, the board token's exact file name anywhere in the
     command still counts (review 25: padding a command past the limit hid a token read). One linear search. */
  if (tool === 'Bash' && input && typeof input.command === 'string' && input.command.length > 4096 &&
      RANK.indexOf('board-files') < RANK.indexOf(best) && /(^|[\/\s'"])(board\.token|agent-token-only\.json)(['"\s;|&)]|$)/.test(input.command.slice(4096 - 64, 1024 * 1024))) {
    best = 'board-files';
  }
  return best;
}

/* The words of a shell command: whitespace splits, '...' and "..." group, a backslash escapes the next character.
   One pass, no backtracking. Not a full shell (no expansion beyond $HOME, no substitution): enough to find paths. */
function shellWords(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  let any = false;
  let first = true;   // the next word starts a command (review 8: the program itself is not a target)
  const end = (sep) => { if (cur || any) { out.push({ w: cur, first }); first = false; } cur = ''; any = false; if (sep) first = true; };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      if (ch === q) q = null;
      /* Inside "..." a backslash escapes only $, a backtick, ", \ and a newline; before anything else it stays, as in
         bash (review 30: dropping it split bash -c "cat Application\ Support/..." at the space). */
      else if (ch === '\\' && q === '"' && cmd[i + 1] === '\n') i++;   // a line continuation is dropped (review 31)
      else if (ch === '\\' && q === '"' && i + 1 < cmd.length) cur += /[$`"\\]/.test(cmd[i + 1]) ? cmd[++i] : ch;
      else cur += ch;
    } else if (ch === "'" || ch === '"') { q = ch; any = true; }
    else if (ch === '\\' && cmd[i + 1] === '\n') i++;   // a line continuation joins the word (review 31: board.\<newline>token)
    else if (ch === '\\' && i + 1 < cmd.length) { cur += cmd[++i]; any = true; }
    else if (/[;|&()\n]/.test(ch)) end(true);   // a newline ends a command too (review 9)
    else if (/\s|[<>]/.test(ch)) end(false);
    else { cur += ch; any = true; }
  }
  end(false);
  return out;
}

/* The classes from most to least telling: a refusal is reported as the most telling target it named. */
const RANK = ['board-files', 'agent-config', 'other-agent', 'home', 'system', 'other'];
function pathClass(p0, ctx) {
  let p = p0;
  const home = ctx.home || os.homedir();
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(1));
  else if (p.startsWith('~')) return 'other';   // ~user: another account's home, not resolvable here
  /* Resolved (review 1): agentDir/../../<board> is the board's files, the very traversal a company wants to see. */
  p = path.resolve(ctx.agentDir || path.sep, p);   // a relative path is the agent's own folder's (review 2)
  /* Case-blind on a Mac (review 8: its volume is, so ~/library/kosmos reaches the board's files). */
  const fold = (x) => (process.platform === 'darwin' ? x.toLowerCase() : x);
  const under = (dir0) => {
    if (!dir0) return false;
    const dir = fold(dir0); const q = fold(p);
    return q === dir || q.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
  };
  /* The board's files are every root the guard denies (review 13: its token roots, other worlds' stores, the legacy
     roots) and the installed app itself, not only this store. A root that CONTAINS the agent's own folder is a base
     (review 14: a named world's workers sit under the default world's base), not the board's files, so it is ignored,
     and the agent's own folder and the other agents' are classed first. */
  const agentIn = (root) => !!root && !!ctx.agentDir && (() => { const a = fold(ctx.agentDir); const r = fold(root); return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep); })();
  const board = [ctx.boardRoot, ...(ctx.boardRoots || [])].filter((r) => r && !agentIn(r));
  /* A board root INSIDE the agent's folder (an agent connected at the home folder or ~/Library, review 28) is the board's
     files, checked before the agent's own folder. */
  const inAgent = board.filter((r) => !!ctx.agentDir && (() => { const a = fold(ctx.agentDir); const q = fold(r); return q.startsWith(a.endsWith(path.sep) ? a : a + path.sep); })());
  if (inAgent.some(under)) return 'board-files';
  if (under(ctx.agentDir)) {
    const rest = path.relative(fold(ctx.agentDir), fold(p)).split(path.sep);   // folded too (review 9)
    /* The agent's own config: its .claude folder and the instruction and tool files Claude Code reads from its folder
       (review 13). */
    return [fold('.claude'), fold('CLAUDE.md'), fold('.mcp.json'), fold('AGENTS.md')].includes(rest[0]) ? 'agent-config' : 'other';
  }
  if (board.some(under)) return 'board-files';
  /* A base dropped above still holds the default world's own board files directly (board.token, undo.json, the worlds
     registry: review 15); only its worlds/ folder holds the named worlds, whose stores are listed on their own. */
  for (const r of [ctx.boardRoot, ...(ctx.boardRoots || [])]) {
    if (!r || !agentIn(r) || !under(r)) continue;
    if (path.relative(fold(r), fold(p)).split(path.sep)[0] !== 'worlds') return 'board-files';
  }
  if ((ctx.otherAgentDirs || []).some(under)) return 'other-agent';
  if ((ctx.configRoots || []).some(under)) return 'agent-config';   // the account's Claude config folders (review 13)
  if (under(home)) return 'home';
  return 'system';   // resolved, so always absolute
}

/* A refused call's rule, or null when it is not one the company placed. */
function classify(text, tool, platform) {
  if (denied(text)) return 'token-only-guard';
  if (tool === 'Bash' && SANDBOX.test(text) && (platform || process.platform) === 'darwin') return 'sandbox';   // the sandbox is macOS's (review 16)
  return null;
}

/**
 * Read the complete lines of `text` (a transcript's new bytes) and return the company-rule refusals in it. `calls`
 * carries tool uses across reads (a result can arrive in a later tick than its call). ctx: { agent, session, boardRoot,
 * boardRoots, configRoots, agentDir, otherAgentDirs, home, now }.
 */
function scanText(text, calls, ctx) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || (!line.includes('"tool_use"') && !line.includes('"tool_result"'))) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const blocks = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      /* Only the tool's name and its target CLASS are kept (review 2): never the input, which can hold a whole file. */
      if (b.type === 'tool_use' && typeof b.id === 'string') { calls.set(b.id, { name: b.name, target: targetClass(b.name, b.input || {}, ctx) }); continue; }
      if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
      const call = calls.get(b.tool_use_id) || {};
      calls.delete(b.tool_use_id);   // any result answers its call (review 2: a successful one too)
      if (b.is_error !== true) continue;
      const text0 = resultText(b.content);
      const tool = call.name || denied(text0) || (SANDBOX.test(text0) ? 'Bash' : null);
      const rule = classify(text0, tool, ctx.platform);
      if (!rule) continue;
      const at = Date.parse(row.timestamp);
      if (!Number.isFinite(at) || at < ctx.now - PAST_MS) continue;
      const agent = label(ctx.agent);
      const sessionRef = ref(ctx.session);
      const toolUseRef = ref(b.tool_use_id);
      if (!agent || !sessionRef || !toolUseRef) continue;
      out.push({ agent, ms: at, at: Math.floor(at / 1000), action: (tool && Object.prototype.hasOwnProperty.call(ACTION, tool) ? ACTION[tool] : 'run'), rule,
        targetClass: call.target || targetClass(tool, {}, ctx), sessionRef, toolUseRef });
    }
  }
  return out;
}

/* New complete lines of one transcript since `offset`: { text, next } (next is the offset after the last newline). */
function readFrom(file, offset, max) {
  const cap = Number.isFinite(max) && max > 0 ? Math.min(max, READ_MAX) : READ_MAX;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const from = offset > size ? 0 : offset;   // a rewritten file starts again
    const len = Math.min(size - from, cap);
    if (len <= 0) return { text: '', next: from, read: 0 };
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    const nl = buf.lastIndexOf(0x0a);
    /* A window with no newline: wait for the line to finish, unless the window is full (a line over READ_MAX, such as
       a large tool result). Then skip past it (review 1): its tail is read next as an unparseable line and ignored,
       and the file never wedges on it. */
    if (nl < 0) return { text: '', next: len === READ_MAX ? from + len : from, read: len };   // a short budget waits
    return { text: buf.subarray(0, nl).toString('utf8'), next: from + nl + 1, read: len };
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

/* The session a transcript belongs to: its own name, or, for a subagent's (<session>/subagents/.../agent-x.jsonl), the
   session folder's (review 1: the reference must open a conversation). */
function sessionOf(file) {
  const parts = file.split(path.sep);
  const i = parts.lastIndexOf('subagents');
  return i > 0 ? parts[i - 1] : path.basename(file, '.jsonl');
}

function readState(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
    const obj = (v) => (v && typeof v === 'object' ? v : {});
    const nums = (v) => Object.fromEntries(Object.entries(obj(v)).filter(([, x]) => Number.isFinite(x) && x >= 0));   // review 24
    return { offsets: nums(j && j.offsets), pending: Array.isArray(j && j.pending) ? j.pending : [], listed: obj(j && j.listed),
      confirmed: obj(j && j.confirmed), withdrawn: !!(j && j.withdrawn), collided: Array.isArray(j && j.collided) ? j.collided : [], sendMax: j && Number.isFinite(j.sendMax) ? j.sendMax : null,
      enrolledAs: j && j.enrolledAs, since: j && Number.isFinite(j.since) ? j.since : null, failAt: j && Number.isFinite(j.failAt) ? j.failAt : null };
  } catch { return { offsets: {}, pending: [], listed: {}, confirmed: {}, withdrawn: false, collided: [], sendMax: null, enrolledAs: null, since: null, failAt: null }; }
}

function writeState(root, st) {   // whole or not at all; owner-only
  const file = path.join(root, STATE_FILE);
  const tmp = file + '.' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(st), { mode: 0o600 }); fs.renameSync(tmp, file); return true; } catch {
    try { fs.unlinkSync(tmp); } catch { /* none */ }
    return false;
  }
}

function defaultSources() {
  const sendertoken = require('./sendertoken');
  const create = require('./create');
  const receipt = require('./receipt');
  return {
    /* null when the list file exists but cannot be read (review 3): an empty list there would wipe every agent's
       first sighting, and a torn read is not the person taking agents off the list. */
    agents: () => {
      let raw;
      try { raw = fs.readFileSync(sendertoken.tokenOnlyFile(), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
      /* The one read's own parse (review 4: a second read could catch a later write half-done), filtered as
         sendertoken.tokenOnlyList filters. */
      let j;
      try { j = JSON.parse(raw); } catch { return null; }
      if (!j || !Array.isArray(j.agents)) return null;
      return j.agents.filter((a) => typeof a === 'string' && a);
    },
    dirOf: (name) => { try { return create.workerDir(name); } catch { return null; } },
    /* Every agent this Kosmos knows (token-only or not), or null when that cannot be read (review 10). */
    everyAgent: () => { try { const r = require('./register').survey(); return r && r.ok ? r.agents.map((a) => a.name) : null; } catch { return null; } },
    transcriptDirsOf: (dir) => receipt._transcriptDirs(dir),
    /* Review 13: what the guard denies beyond this store, and the account's Claude config folders. Best effort: a
       lookup that throws only narrows the classes (never the reading). */
    boardRoots: () => {
      const out = [path.resolve(__dirname, '..')];   // the installed app
      try { const sa = require('./setup-assistant'); out.push(...sa.tokenOnlyTokenRoots(require('./store').ROOT, sa.kosmosHome())); } catch { /* narrower classes */ }
      return out;
    },
    configRoots: () => { try { return require('./status').configRoots(); } catch { return []; } },
    /* Review 16: on the list is not under the company's rules. The guard is in force only when the agent's own settings
       hold every rule the guard writes for that folder, and the guard could write them all (no root missed, no rule
       dropped; setup-assistant refuses to guard otherwise, and on Windows at all). Anything else: not read. */
    guarded: (dir, cache) => {
      try {
        if (process.platform === 'win32') return false;
        const rules = require('./setup-assistant').tokenOnlySettingsRules(dir, { launchCache: cache });
        if (!rules || (rules.rootsMissed && rules.rootsMissed.length) || rules.tokenRuleDropped || !Array.isArray(rules.deny)) return false;
        /* Review 17: the rules that keep the board token out (they follow from the token roots, not from the board's PATH,
           so a guard written at an agent's launch from another pane's PATH still matches). All of them must be there. */
        const tokenFile = require('./boardauth').TOKEN_FILE;
        /* This board's own store's token rules only (review 22: requiring every world's concrete rule made a newly
           created world turn every agent unguarded until each relaunched, though the guard's worlds glob covers it). */
        const own = require('./store').ROOT;
        const needed = rules.deny.filter((r) => typeof r === 'string' && r.includes(tokenFile) && r.includes(own));
        if (needed.length === 0) return false;
        const j = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
        const deny = j && j.permissions && Array.isArray(j.permissions.deny) ? new Set(j.permissions.deny) : new Set();
        return needed.every((r) => deny.has(r));
      } catch { return false; }
    },
    transcripts: async (dir) => {
      const files = [];
      for (const d of receipt._transcriptDirs(dir)) files.push(...await receipt._transcriptsIn(d));
      return [...new Set(files)];
    },
  };
}

/**
 * One tick: read new transcript lines of every token-only agent, queue the company-rule refusals, and send up to
 * SEND_MAX when this is the enrolled Kosmos with the consent recorded here. Never throws.
 * opts: { root, remote, sources, now, home } (tests); the board passes nothing.
 */
async function tick(opts) {
  const o = opts || {};
  try {
    const oe = require('./orgenroll');
    const eo = { root: o.root, remote: o.remote };
    /* THE gate, the rollup's (#5531): the work Kosmos with the consent recorded on this computer, never merely
       enrolled. Not enrolled reads nothing: no transcript is opened for a company that does not exist. */
    if (!oe.mayReport(eo)) {
      /* Review 17: words can be lost without a 409 here (the rollup's own 409, a refresh). While enrolled with no words
         accepted, the state is marked withdrawn, so words accepted again (even the same) start clean and nothing from
         the gap is sent. */
      try {
        if (oe.readEnrollment(eo)) {
          const r0 = o.root || require('./store').ROOT;
          const w = readState(r0);
          if (w.enrolledAs && !w.withdrawn) { w.withdrawn = true; w.pending = []; writeState(r0, w); }   // review 19: no queue kept
        }
      } catch { /* the next tick tries again */ }
      return { sent: 0, because: 'not the enrolled Kosmos, or no accepted words recorded here' };
    }
    const rec = oe.readEnrollment(eo);
    if (!rec || typeof rec.world !== 'string') return { sent: 0, because: 'not the enrolled Kosmos' };
    const root = o.root || require('./store').ROOT;
    const now = o.now || Date.now();
    const src = o.sources || defaultSources();
    const joinedAt = Date.parse(rec.enrolledAt);
    /* Fail closed (review 1): with no readable enrollment time, nothing can be shown to be from after it. */
    if (!Number.isFinite(joinedAt)) return { sent: 0, because: 'this enrollment records no time it began' };
    /* The state belongs to one enrollment AND one set of accepted words (review 1): a new enrollment, or words accepted
       again after the company changed them, starts clean, and nothing from before that moment is sent (not the last
       company's queue, not what happened while no words were accepted). */
    const enrolledAs = rec.world + '|' + ((rec.org && rec.org.id) || '') + '|' + (rec.enrolledAt || '') + '|' + (rec.consentHash || '');
    let st = readState(root);
    const stRaw = JSON.stringify(st);
    /* Words withdrawn and then accepted again under the SAME hash (review 3): the key alone would not change, so the
       withdrawal itself is recorded and a resumed tick starts clean as for new words. */
    if (st.withdrawn) st.enrolledAs = null;
    if (st.enrolledAs !== enrolledAs) {
      const sameEnrollment = typeof st.enrolledAs === 'string' && st.enrolledAs.split('|').slice(0, 3).join('|') === enrolledAs.split('|').slice(0, 3).join('|');
      st = { offsets: {}, pending: [], listed: {}, confirmed: {}, withdrawn: false, collided: [], sendMax: null, enrolledAs, since: sameEnrollment || st.withdrawn ? now : joinedAt, failAt: null };
    }
    const sinceMs = Math.max(joinedAt, st.since || joinedAt);
    const sinceS = Math.floor(sinceMs / 1000);   // whole seconds, for the file-skipping rules
    const names = src.agents();
    if (!Array.isArray(names)) return { sent: 0, because: 'the token-only list could not be read; nothing changed' };
    const dirs = new Map(names.map((n) => [n, src.dirOf(n)]));
    /* Claude Code names a project folder by flattening the agent's folder (every non-alphanumeric character becomes -),
       so orch.main and orch-main share one transcript folder (review 10). A token-only agent whose folder collides with
       an agent that is NOT token-only would carry that agent's refusals, by the PERSON's own rules, to the company: it
       is not read at all (fail closed), and neither is anything when the agent list cannot be read. */
    const collidedNow = new Set();
    const gapNow = new Set();   // review 24: guarded now, but unconfirmed for longer than GUARD_GAP_MS
    const clashNow = new Set();   // review 28: agents that collide THIS tick (a gap must not erase that mark)
    const launchCache = new Map();   // review 17: one launch-path scan per tick, shared by every agent's guard check
    /* Required (review 12: an absent check read as "no clash"). */
    if (typeof src.everyAgent !== 'function' || typeof src.transcriptDirsOf !== 'function' || typeof src.guarded !== 'function') return { sent: 0, because: 'the agent list cannot be checked; nothing changed' };
    {
      const every = src.everyAgent();
      if (!Array.isArray(every)) return { sent: 0, because: 'the agent list could not be read; nothing changed' };
      /* A folder whose transcript location cannot be worked out cannot be compared (review 21): nothing is read. */
      /* Case-blind on a Mac (review 28: Orch.Main and orch_main flatten to project folders that differ only in case,
         which are one folder on a case-blind volume). */
      const foldP = (x) => (process.platform === 'darwin' ? String(x).toLowerCase() : String(x));
      const flat = (d) => new Set(src.transcriptDirsOf(d).map(foldP));
      try { [...dirs.values()].filter(Boolean).forEach(flat); } catch (e) {
        console.error('agentevents: a transcript folder could not be worked out; nothing read (' + String((e && e.message) || e) + ')');
        return { sent: 0, because: 'a transcript folder could not be worked out; nothing changed' };
      }
      /* The guard pass FIRST (review 18): a listed agent whose guard is not in force runs under the person's own rules, so
         it is not read, and it counts among the "others" a read agent must not share a folder with. */
      const unguarded = [];
      for (const [n, d] of [...dirs]) {
        if (!d) continue;
        if (src.guarded(d, launchCache)) {
          UNGUARDED_SAID.delete(n);   // guarded again: a later lapse is said again (review 22)
          /* Review 24: a guard confirmed long ago (the board was down) may have lapsed and been rewritten unseen; the gap's
             refusals could be the person's own, so the agent counts from now, as if newly listed. */
          if (Number.isFinite(st.confirmed[n]) && now - st.confirmed[n] > GUARD_GAP_MS) collidedNow.add(n), gapNow.add(n);
          /* Refreshed once it is over half the gap old (review 25: refreshing every tick rewrote the state every tick). */
          if (!Number.isFinite(st.confirmed[n]) || now - st.confirmed[n] > GUARD_REFRESH_MS) st.confirmed[n] = now;
          continue;
        }
        dirs.delete(n); collidedNow.add(n); unguarded.push(d);
        if (!UNGUARDED_SAID.has(n)) { UNGUARDED_SAID.add(n); console.error('agentevents: ' + n + ' is token-only but its guard is not in force; its refusals are not read'); }
      }
      /* An agent whose folder cannot be resolved cannot be compared (review 11): that is unreadable too, not "no clash". */
      const otherDirs = every.filter((n) => !names.includes(n)).map((n) => src.dirOf(n));
      if (otherDirs.some((d) => !d)) return { sent: 0, because: 'an agent\'s folder could not be resolved; nothing changed' };
      let others;
      try { others = [...otherDirs, ...unguarded].map(flat); } catch (e) {
        console.error('agentevents: an agent\'s transcript folder could not be worked out; nothing read (' + String((e && e.message) || e) + ')');
        return { sent: 0, because: 'a transcript folder could not be worked out; nothing changed' };
      }
      /* Two READ agents sharing a folder clash too (review 29): one file's events would be labelled with whichever
         agent the rotation read first, so the console would name the wrong agent. Neither is read. */
      let readFlats;
      try { readFlats = [...dirs].filter(([, d]) => d).map(([m, d]) => [m, flat(d)]); } catch (e) {
        console.error('agentevents: an agent\'s transcript folder could not be worked out; nothing read (' + String((e && e.message) || e) + ')');
        return { sent: 0, because: 'a transcript folder could not be worked out; nothing changed' };
      }
      for (const [n, mine] of readFlats) {
        const peers = readFlats.filter(([m]) => m !== n).map(([, f]) => f);
        if ([...others, ...peers].some((o) => [...o].some((x) => mine.has(x)))) {
          dirs.delete(n);
          collidedNow.add(n); clashNow.add(n);
          console.error('agentevents: ' + n + ' shares its transcript folder with another agent; not read');
        }
      }
    }
    const allDirs = [...dirs.values()].filter(Boolean);
    const seen = new Set();
    /* When each agent was first seen on the token-only list (review 2): before that, a refusal was the PERSON's own
       rule, never the company's, so nothing of it is sent. An agent already listed when this state began counts from
       the first tick that saw it (the list keeps no history), the private side of the doubt. */
    /* An agent whose collision just cleared counts from NOW (review 12): its shared folder's older lines were another
       agent's, so its files start at their end, as an agent first listed this tick. Recorded while it collides. */
    const before = new Set(Array.isArray(st.collided) ? st.collided : []);
    for (const n of names) if (before.has(n) && !collidedNow.has(n)) st.listed[n] = now;
    for (const n of gapNow) { st.listed[n] = now; if (!clashNow.has(n)) collidedNow.delete(n); }   // read again from now on
    st.collided = [...collidedNow];
    for (const n of names) if (!Number.isFinite(st.listed[n])) st.listed[n] = now;
    for (const n of Object.keys(st.listed)) if (!names.includes(n)) delete st.listed[n];   // off the list: starts again
    for (const n of Object.keys(st.confirmed || {})) if (!names.includes(n)) delete st.confirmed[n];
    let budget = TICK_READ_MAX;
    const nextCalls = new Map();   // file -> its call map after this tick's lines (review 23)
    const boardRoots = typeof src.boardRoots === 'function' ? src.boardRoots() : [];
    const configRoots = typeof src.configRoots === 'function' ? src.configRoots() : [];
    /* The agent read first rotates each tick (review 5): a large backlog cannot starve the others' files of the
       budget tick after tick (it delays a refusal, never loses one). */
    const order = [...dirs];
    const turn = TURN;   // in memory (review 9: in the state file it made every tick a write)
    if (order.length) order.push(...order.splice(0, turn % order.length));
    TURN = turn + 1;
    for (const [agent, dir] of order) {
      if (!dir) continue;
      const fromMs = Math.max(sinceMs, st.listed[agent]);
      const fromS = Math.max(sinceS, Math.floor(st.listed[agent] / 1000));
      if (!Number.isFinite(fromS)) continue;   // fail closed (review 3)
      /* One agent whose transcripts cannot be listed is skipped, never every agent (review 21). */
      let files;
      try { files = await src.transcripts(dir); } catch (e) {
        if (!UNLISTABLE_SAID.has(agent)) { UNLISTABLE_SAID.add(agent); console.error('agentevents: ' + agent + '\'s transcripts could not be listed; skipped (' + String((e && e.message) || e) + ')'); }
        continue;
      }
      for (const file of files) {
        seen.add(file);
        let off = Object.prototype.hasOwnProperty.call(st.offsets, file) ? st.offsets[file] : null;
        if (off === null) {
          /* First sight: read from the start only if the file was written after the time that counts (review 2: an old
             session is skipped to its end without reading it). */
          let m;
          try { m = fs.statSync(file); } catch { continue; }
          /* Older than the time that counts, or that time is THIS tick (an agent first listed now, words accepted now):
             nothing in it can count, so it starts at its end (review 6: a busy session was read from byte 0 only to be
             filtered away, delaying its new refusals). */
          if (m.mtimeMs < fromS * 1000 || fromS >= Math.floor(now / 1000) - 1) { st.offsets[file] = m.size; continue; }
          off = 0;
        }
        else {
          /* A file that has not grown is not opened (review 5: every session ever seen was opened every tick). */
          let m;
          try { m = fs.statSync(file); } catch { continue; }
          if (m.size === off) continue;
        }
        if (budget <= 0) continue;   // this tick has read enough (the read is synchronous); the rest next tick
        const r = readFrom(file, off, budget);
        if (!r) continue;
        budget -= r.read;   // the bytes actually read (review 5: a rewritten file's reset offset made this negative)
        st.offsets[file] = r.next;
        if (!r.text) continue;
        const calls = new Map(CALLS.get(file) || []);   // a copy, kept only once the state is written (review 23)
        const ctx = { agent, session: sessionOf(file), platform: o.platform, boardRoot: root, boardRoots, configRoots, agentDir: dir,
          otherAgentDirs: allDirs.filter((d) => d !== dir), home: o.home, now };
        for (const e of scanText(r.text, calls, ctx)) {
          /* Compared in milliseconds (review 18: a refusal a fraction of a second before a boundary passed a whole-second
             test), then the time kept only in seconds. */
          const ms = e.ms; delete e.ms;
          if (!(ms >= fromMs) || e.at > Math.floor(now / 1000) + AHEAD_S) continue;
          st.pending.push(Object.assign({ world: rec.world }, e));
        }
        while (calls.size > CALLS_MAX) calls.delete(calls.keys().next().value);
        nextCalls.set(file, calls);
        await new Promise((r) => setImmediate(r));   // review 15: the read and parse are synchronous; let the board breathe
      }
    }
    /* A transcript that is gone keeps no offset (review 1: the state file would grow, and each tick opens every one). */
    /* Dropped only when the file is really gone (review 4: a listing that failed for a moment returned none, and the
       next tick re-read every active session from its start). */
    for (const f of Object.keys(st.offsets)) if (!seen.has(f) && !fs.existsSync(f)) { delete st.offsets[f]; CALLS.delete(f); }
    if (st.pending.length > PENDING_MAX) st.pending = st.pending.slice(-PENDING_MAX);
    st.pending = st.pending.filter((e) => e.at * 1000 >= now - SEND_PAST_MS);
    /* Written only when it changed (review 9: thousands of offsets rewritten every five minutes for nothing). */
    if (JSON.stringify(st) !== stRaw && !writeState(root, st)) return { sent: 0, because: 'this Kosmos cannot record what it has read' };
    /* The calls are kept only now: had the write failed, the next tick re-reads those lines WITH their calls (review 23:
       a consumed call left the re-read classed without its target). */
    for (const [f, m] of nextCalls) CALLS.set(f, m);
    if (st.pending.length === 0) return { sent: 0, because: null };
    if (st.failAt && now - st.failAt < RETRY_AFTER_FAIL_MS) return { sent: 0, because: 'waiting after a failed send' };
    /* Re-checked after the scan (review 2, the rollup's review 3): a Leave pressed, or words withdrawn, while the
       transcripts were read stops the send. */
    const rec2 = oe.mayReport(eo) ? oe.readEnrollment(eo) : null;
    if (!rec2 || rec2.world + '|' + ((rec2.org && rec2.org.id) || '') + '|' + (rec2.enrolledAt || '') + '|' + (rec2.consentHash || '') !== enrolledAs) {
      return { sent: 0, because: 'the enrollment changed while reading' };
    }
    /* The computer print, as the rollup sends it (review 1): the company refuses a copy of this Mac's key elsewhere. */
    const pf = oe.reportPrint(eo);
    if (pf.send === 'later' || pf.send === 'error') return { sent: 0, because: 'this computer could not be read yet' };
    const batch = st.pending.slice(0, st.sendMax || SEND_MAX);
    const remote = o.remote || require('./remote');
    let r;
    try { r = await remote.macRequest('POST', ROUTE, Object.assign({ events: batch }, pf.fields)); } catch (e) { r = { ok: false, because: String((e && e.message) || e) }; }
    if (!r || !r.ok) {
      /* A batch the coordinator REFUSES as malformed or too big (org_agent_events_bad / _too_big, public codes) would be
         refused on every retry and hold back every later event. Drop exactly that batch; anything else (offline, busy,
         consent changed, not enrolled) keeps it for the next tick. */
      /* Too big with more than one event (review 3: 50 events of long multibyte labels can pass 60 KB): send half as
         many next time instead of dropping good events. */
      if (/\borg_agent_events_too_big\b/.test(String((r && r.because) || '')) && batch.length > 1) {
        const h = readState(root);
        h.sendMax = Math.ceil(batch.length / 2);
        writeState(root, h);
        return { sent: 0, because: 'the company took fewer at a time; sending half as many' };
      }
      if (/\borg_agent_events_(bad|too_big)\b/.test(String((r && r.because) || ''))) {
        /* Slicing the front by the batch's length is safe because one tick runs at a time (server.js
           AGENT_EVENTS_RUNNING): nothing else adds to the queue between this send and this write. */
        const left = readState(root);
        left.pending = left.pending.slice(batch.length);
        writeState(root, left);
        return { sent: 0, dropped: batch.length, because: 'the company refused these events as unreadable' };
      }
      /* The company's words changed (409 org_consent_changed): stop, as the rollup does, until they are accepted here. */
      const why = String((r && r.because) || '');
      if (/\borg_consent_changed\b/.test(why)) {
        let changed = false;
        try { changed = await oe.consentWithdrawn(eo, rec.consentHash); } catch { changed = false; }
        const w = readState(root);
        /* Only a withdrawal that was recorded starts the next acceptance clean (review 4: a failed write would otherwise
           reset the state, and its wait, on the very next tick). */
        if (changed) { w.withdrawn = true; w.pending = []; }   // review 19: nothing queued is kept once words are withdrawn
        w.failAt = now;   // review 3: no signed request every five minutes if the record could not be changed
        writeState(root, w);
        return { sent: 0, because: 'the company\'s words changed; nothing more is sent until they are accepted here' };
      }
      if (/\borg_not_enrolled\b|\borg_not_member\b/.test(why)) {
        try { await oe.refresh(eo); } catch { /* the daily refresh tries again */ }
      }
      const failed = readState(root);
      failed.failAt = now;   // review 2: no signed request and refresh every five minutes while it keeps failing
      writeState(root, failed);
      return { sent: 0, because: why || 'the send failed' };
    }
    /* Sent: drop exactly what went. A repeat would be ignored by the coordinator (one row per session and tool use). */
    const after = readState(root);
    after.pending = after.pending.slice(batch.length);
    after.failAt = null;
    if (after.pending.length === 0) after.sendMax = null;   // review 6: kept until the backlog drains (no too-big every other tick)
    writeState(root, after);
    const d = r.data || {};
    if (d.capped || d.skipped) console.error('agentevents: the company ' + (d.capped ? 'capped today\'s events' : 'skipped ' + d.skipped + ' it does not accept'));
    return { sent: batch.length, because: null };
  } catch (e) {
    return { sent: 0, because: String((e && e.message) || e) };
  }
}

module.exports = { ROUTE, SEND_MAX, scanText, classify, targetClass, label, ref, readFrom, sessionOf, tick,
  _defaultSources: defaultSources };   // the guard check's round-trip test (review 17)
