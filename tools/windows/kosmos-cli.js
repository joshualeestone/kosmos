'use strict';
/**
 * `kosmos` for a Windows agent: the verbs an agent is taught, in Node.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR. Every message the board delivers ends "to
 * answer, run: kosmos reply", and every agent's instructions teach `kosmos msg`,
 * `kosmos post` and `kosmos task`. The Windows zip shipped no `kosmos` at all, so
 * a Windows agent answering its operator ran `kosmos reply "..."` and its shell
 * said "The term 'kosmos' is not recognized" (measured 2026-09-11). The person
 * messaged an agent and never saw the answer.
 *
 * 🛑 AND THEN IT SHIPPED A SUBSET (win32-cli-verbs). Every task notification says
 * "reply in the task: kosmos task message ...", the Project Manager role is taught
 * `kosmos feedback write` daily, and the post refusal names `kosmos room reopen`;
 * none of the three existed here, and `kosmos reply --help` SENT "--help". So the
 * verbs are now ONE TABLE (VERB_HANDLERS, SUBCOMMAND_HANDLERS): what is exported
 * as VERBS and SUBCOMMANDS is `Object.keys` of the dispatch itself, and
 * tools.windows-kosmos-cli-verbs-parity.test.js holds that table to install/kosmos
 * and to every `kosmos <verb>` Kosmos teaches.
 *
 * 🔑 WHY NODE AND NOT install/kosmos. The Mac CLI is bash. A Windows agent runs its
 * commands through Claude Code's PowerShell tool as often as through Git Bash
 * (the measured failure was in PowerShell), and nothing guarantees bash is there.
 * The zip already carries its own node.exe, so this runs in either shell, from
 * the `kosmos.ps1` / `kosmos` shims shipped beside it (tools/windows/).
 *
 * 🔑 THE SAME WIRE AS install/kosmos, AND THE BOARD'S OWN WORDS. Each board verb
 * sends the request body the bash CLI sends, to the same route, and prints the
 * board's `because` sentence rather than inventing one. `feedback` is the one
 * engine-direct verb, as on the Mac: the report store is local. What this adds is
 * identity: an agent here has no tmux pane, so it presents the per-run agent token
 * the supervisor put in its environment (`KOSMOS_AGENT_TOKEN`), which the board
 * resolves on /api/reply, /api/report, /api/whoami, /api/msg, /api/post,
 * /api/react and the task message route (server.js `senderFromAgentToken`).
 *
 * 🔑 NOTHING ABOUT THE BOARD IS RE-DERIVED HERE. The url, the board token and the
 * agent-token check come from engine/kosmos-report-hook.js, the Windows client
 * that already delivers every self-report, so there is one copy of each.
 *
 * 🔑 EVERY REQUEST NAMES THIS AGENT'S KOSMOS (#1704 PR2, `x-kosmos-world`). A board
 * serving ANOTHER Kosmos answers the five agent sends (report, reply, msg, post,
 * react) with 421 `{wrongWorld:true}`. Then a reply, a msg or a post is kept in
 * this agent's own Kosmos (engine/outbox.js) and the board that serves it
 * delivers it later, so the command exits 0; a report is dropped as stale (exit 0,
 * one line); a react exits 1 with a sentence. The board sends no 421 on any other
 * route, so no other verb handles one.
 *
 * Exit codes follow install/kosmos: 0 done, 1 failed or refused, 2 usage,
 * 3 "maybe" -- never 1 for a maybe, which would invite the duplicate a retry
 * sends. Deliberate differences: a TIMEOUT on msg, reply or task message is also 3
 * here (the board may already have acted), where install/kosmos says 1; and
 * `--help` exits 0 having sent nothing, for every verb including whoami.
 */

const fs = require('node:fs');
const path = require('node:path');

/* Where the engine is: `<zip>\bin\kosmos-cli.js` -> `<zip>\app\engine` in the
   bundle, `<repo>\tools\windows\kosmos-cli.js` -> `<repo>\engine` in a checkout. */
function engineDir(here) {
  const h = here || __dirname;
  const bundled = path.join(h, '..', 'app', 'engine');
  return fs.existsSync(path.join(bundled, 'kosmos-report-hook.js')) ? bundled : path.join(h, '..', '..', 'engine');
}

/* How long each verb waits. A post fans out to every member serially, so it gets
   the room-sized window install/kosmos gives it (-m 120); everything else -m 15. */
const REQUEST_TIMEOUT_MS = 15000;
const POST_TIMEOUT_MS = 120000;

/* The board's answer when it is serving another Kosmos than the one this agent
   is in (server.js, 421 Misdirected Request). Node's fetch retries a 421 once on
   a fresh connection (RFC 9110 allows it); the board's refusal has no side
   effect, so that costs one extra round trip and nothing else. */
const WRONG_WORLD_STATUS = 421;

/* install/kosmos's own usage lines, verb for verb. Each verb's text names every
   subcommand it has (the parity test pins that against SUBCOMMANDS). */
const USAGE = {
  msg: 'Usage: kosmos msg <agent> <what you want to tell them>',
  reply: 'Usage: kosmos reply <what you want to tell them>   (up to 2000 characters; longer is refused, not truncated)',
  post: 'Usage: kosmos post [--no-reply] <project-id> <what you want to tell the room>  (text only; file attachments are not supported yet, kosmos#1955)',
  react: 'Usage: kosmos react <project-id> <post-id> <emoji>   (the post id is in brackets before each post in kosmos room, e.g. [m3])',
  report: 'Usage: kosmos report <started|working|idle|needs_you|blocked|stopped> [--on <what>] [--owner <who>] [--until <when>] [--project <project-id>] [--auto] [what you want to say about it]\n  kosmos report show     (what the board has for you now; kosmos report status is the same)',
  whoami: 'Usage: kosmos whoami   (asks the board which agent you are and which account you are on)',
  room: 'Usage: kosmos room <project-id>   (read a room; or: kosmos room reopen <project-id> to clear a loop-guard hold)',
  task: [
    'Usage: kosmos task <list|add|close|message>',
    '  kosmos task list <project-id>                                 list this project\'s tasks',
    '  kosmos task add  <project-id> "<what the task is>" ["more detail"]  add one (quote each part)',
    '  kosmos task close <project-id> <task-number>                  close one (number is from list)',
    '  kosmos task message <project-id> <task-number> "<what to say>"  say something in a task\'s conversation',
    '  (project ids are in your instructions\' Your projects section.)',
  ].join('\n'),
  feedback: [
    'Usage: kosmos feedback write [text]      (or pipe the report in on stdin)',
    '       kosmos feedback show [YYYY-MM-DD]  (defaults to today)',
    '       kosmos feedback list',
    '       kosmos feedback pull [--dir PATH]  (bring collected reports down for triage)',
    '       kosmos feedback triage [--since YYYY-MM-DD] [--dir PATH] [--cards FILE|-]',
    '       (in PowerShell, pass the report as text: text piped into kosmos there does not reach it)',
  ].join('\n'),
};

/* #1674: what a person or an agent types when they do not yet know what a command
   does, which is exactly when it must not act. Matched as a WHOLE argument, as
   install/kosmos matches it, so a message that merely mentions --help still goes. */
const HELP_FLAGS = new Set(['-h', '--help']);

/* kosmos.ps1 passes the agent's arguments as JSON in a private temp file, never on
   a command line (see that file), and names it after this flag. Only then is a
   file read, so nothing stale can ever replace real arguments. */
const ARGV_FILE_FLAG = '--kosmos-argv-file';

/**
 * The command's arguments: from kosmos.ps1's file when it sent one, else argv.
 * kosmos.ps1 sends each plain value as the text the agent typed. A LIST or a
 * TABLE is refused, loudly: PowerShell turns an unquoted `a, b` or `@{...}` into
 * one, and stringifying it would change the agent's words without a sign (review
 * round 2). Throws an Error whose message is the sentence to print.
 */
function argvFrom(argv, readFile) {
  const a = Array.isArray(argv) ? argv : [];
  if (a[0] !== ARGV_FILE_FLAG) return a.map(String);
  /* Deleted as soon as it is read: a shim killed mid-call (a tool timeout) never
     runs its own cleanup, and the file holds the agent's words (review round 3). */
  const read = readFile || ((f) => { const s = fs.readFileSync(f, 'utf8'); try { fs.unlinkSync(f); } catch { /* the shim's finally is the backstop */ } return s; });
  let parsed;
  try { parsed = JSON.parse(String(read(String(a[1] || ''))).replace(BYTE_ORDER_MARK_AT_START, '')); } catch (e) {
    throw new Error('kosmos could not read the arguments PowerShell passed (' + ((e && e.message) || e) + ').');
  }
  if (!Array.isArray(parsed)) throw new Error('kosmos could not read the arguments PowerShell passed (not a list).');
  return parsed.map((x) => {
    if (x == null) return '';
    if (typeof x === 'object') throw new Error('One of the arguments reached kosmos as a PowerShell list or table, not text, so its words would change. Put that part in quotes and run it again.');
    return String(x);
  });
}
/* PowerShell 5.1 writes the argv file with a UTF-8 byte order mark, which
   JSON.parse refuses. Built from its code point, never typed as the character:
   a literal U+FEFF in this source is invisible, and an editor that strips it
   would turn the pattern into /^/ and break every Windows command (review round 1). */
const BYTE_ORDER_MARK_AT_START = new RegExp('^' + String.fromCharCode(0xFEFF));

/* cmd_room's and cmd_task's sanitizer, exactly: a project id keeps only
   [A-Za-z0-9._-], so `kosmos room <id>` and `kosmos task <id>` reach one route. */
function projectSlug(id) { return String(id || '').replace(/[^A-Za-z0-9._-]/g, ''); }

/* How long piped input may stay silent before it is taken as ended (review round 1).
   A tool runner can hand `kosmos` a stdin pipe it never writes to and never closes,
   and reading that to its end would hang the command for good. Text piped in by
   `echo ... |` or `cat file |` arrives at once and then closes; three quiet seconds
   is far past that, and short enough that a bare `kosmos feedback write` comes back
   with the sentence saying what to do. */
const STDIN_QUIET_LIMIT_MS = 3000;

/**
 * What was piped in, for `feedback write` with no text and `feedback triage
 * --cards -`: the only two readers, as on the Mac. Resolves to the text.
 * - A console is NOT read: an agent never has one, and a person at one would sit at
 *   a silent prompt; they get the "nothing to write" sentence instead.
 * - Reading stops at the end of the input or once it has been quiet for
 *   STDIN_QUIET_LIMIT_MS, whichever is first; what arrived by then is the text. A
 *   stdin that errors is the same as an empty one, and the caller's sentence says
 *   what to do.
 * `stream` and `quietMs` are seams for a test.
 */
function readStandardInput(stream, quietMs) {
  const input = stream || process.stdin;
  if (input.isTTY) return Promise.resolve('');
  const limit = quietMs || STDIN_QUIET_LIMIT_MS;
  return new Promise((resolve) => {
    const chunks = [];
    let timer = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.removeListener('data', onData);
      /* Let go of the pipe: a read still pending on it keeps this process alive. */
      input.pause();
      if (typeof input.destroy === 'function') input.destroy();
      resolve(Buffer.concat(chunks).toString('utf8').replace(BYTE_ORDER_MARK_AT_START, ''));
    };
    const restartQuietTimer = () => { clearTimeout(timer); timer = setTimeout(finish, limit); };
    function onData(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); restartQuietTimer(); }
    input.on('data', onData);
    input.once('end', finish);
    input.once('error', finish);
    restartQuietTimer();
  });
}

/* kosmos.ps1 never reads PowerShell pipeline input (see the NEVER READ $input note in
   that file), so the two stdin readers say how to hand the text over there. */
const POWERSHELL_PIPE_NOTE = '(in PowerShell, pass the text as an argument: text piped into kosmos there does not reach it)';

// ── the verbs ───────────────────────────────────────────────────────────────
// Each handler is (ctx, args) -> exit code. `ctx` is built once per run in main.

async function verbMsg(ctx, args) {
  const to = args.shift();
  const text = args.join(' ');
  if (!to || !text) { ctx.err(USAGE.msg); return 2; }
  const body = { to, text, from_pane: '' };
  const r = await ctx.call('POST', '/api/msg', body);
  if (!r.reached) return r.timedOut ? maybe(ctx.err, 'Kosmos was slow to answer and we stopped waiting. The message may have been delivered; check with them before sending it again.') : ctx.unreachable('send that');
  if (ctx.wrongWorld(r)) return ctx.keepForLater('msg', body);
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that request: ' + ctx.refusedBy(r) + '.'); return 1; }
  const d = (r.json && r.json.delivery) || {};
  if (d.state === 'placed') { ctx.out('Placed with ' + to + '.'); return 0; }
  if (d.state === 'unconfirmed') return maybe(ctx.err, 'Not confirmed: ' + (clause(d.because) || 'the text may already be in their composer') + '. Do not re-send; check with them.');
  ctx.err('Not delivered: ' + (clause(d.because) || 'we could not tell why') + '.');
  return 1;
}

async function verbReply(ctx, args) {
  const text = args.join(' ');
  if (!text) { ctx.err(USAGE.reply); return 2; }
  const body = { text, from_pane: '' };
  const r = await ctx.call('POST', '/api/reply', body);
  if (!r.reached) return r.timedOut ? maybe(ctx.err, 'Kosmos was slow to answer and we stopped waiting. Your answer may have been kept; check your conversation before sending it again.') : ctx.unreachable('keep that');
  if (ctx.wrongWorld(r)) return ctx.keepForLater('reply', body);
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that: ' + ctx.refusedBy(r) + '.'); return 1; }
  if (r.json && r.json.kept === true) { ctx.out('Answered. It is in their conversation with you.'); return 0; }
  ctx.err('That was not kept: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
  return 1;
}

async function verbPost(ctx, args) {
  if (args.some((a) => /^--(file|attach)(=|$)/.test(a))) {
    ctx.err('Attaching a file to a room post is not supported yet (kosmos#1955).');
    ctx.err('Paste the document\'s content inline as the message, or share its path with the operator.');
    ctx.err('Text only for now: kosmos post <project-id> <text>');
    return 2;
  }
  // #2908: --no-reply (leading flag) marks the post an acknowledgement (reply_expected:false),
  // so a mentioned recipient reads it in the foreground but is not told to answer -- breaking
  // the ack-of-an-ack loop. Matches install/kosmos: leading flag, sent only when present.
  let noReply = false;
  if (args[0] === '--no-reply') { noReply = true; args.shift(); }
  const project = args.shift();
  const text = args.join(' ');
  if (!project || !text) { ctx.err(USAGE.post); return 2; }
  const body = { project, text, from_pane: '' };
  if (noReply) body.reply_expected = false;
  const r = await ctx.call('POST', '/api/post', body, { timeoutMs: POST_TIMEOUT_MS });
  if (!r.reached) return r.timedOut ? maybe(ctx.err, 'Kosmos is still delivering that post and we stopped waiting. Do not re-post; the room screen shows who got it.') : ctx.unreachable('post that');
  if (ctx.wrongWorld(r)) return ctx.keepForLater('post', body);
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that request: ' + ctx.refusedBy(r) + '.'); return 1; }
  const d = (r.json && r.json.delivery) || {};
  if (d.state === 'placed') { ctx.out('Posted to ' + project + '. Everyone on it has it waiting.'); return 0; }
  if (d.state === 'unconfirmed') return maybe(ctx.err, 'Posted, but not everyone is confirmed' + (d.because ? ': ' + clause(d.because) : '') + '. Do not re-post; the room screen shows who got it.');
  ctx.err('Not posted: ' + (clause(d.because) || 'we could not tell why') + '.');
  return 1;
}

async function verbReact(ctx, args) {
  const [project, of, emoji] = args;
  if (!project || !of || !emoji) { ctx.err(USAGE.react); return 2; }
  const r = await ctx.call('POST', '/api/react', { project, of, emoji, from_pane: '' });
  if (!r.reached) return r.timedOut ? maybe(ctx.err, 'Kosmos was slow to answer and we stopped waiting. Your reaction may have landed; check the room before reacting again, because reacting again takes it back off.') : ctx.unreachable('react');
  /* Not kept: a reaction toggles room state this agent cannot see from here. */
  if (ctx.wrongWorld(r)) { ctx.err(ctx.outbox().WRONG_WORLD_SENTENCES.notOpen); return 1; }
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that: ' + ctx.refusedBy(r) + '.'); return 1; }
  /* install/kosmos's sentences: the route TOGGLES, so the agent must hear which. */
  if (r.json && r.json.ok && r.json.op === 'remove') { ctx.out('Took your ' + emoji + ' back off that post.'); return 0; }
  if (r.json && r.json.ok) { ctx.out('Reacted ' + emoji + ' to that post.'); return 0; }
  ctx.err('Not reacted: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
  return 1;
}

async function reportShow(ctx) {
  const r = await ctx.call('GET', '/api/report?as=text&from_pane=');
  if (!r.reached) return ctx.unreachable('read your report');
  ctx.out(String(r.text || '').replace(/\n$/, ''));
  return r.status >= 400 ? 1 : 0;
}

async function verbReport(ctx, args) {
  const state = args.shift();
  const f = { on: '', owner: '', until: '', project: '', auto: false };
  while (args.length) {
    const a = args[0];
    if (a === '--auto') { f.auto = true; args.shift(); continue; }
    const m = /^--(on|owner|until|project)$/.exec(a);
    if (!m) break;
    args.shift();
    f[m[1]] = args.shift() || '';
  }
  const text = args.join(' ');
  if (!state) { ctx.err(USAGE.report); return 2; }
  /* #2001, as install/kosmos: the two states that summon a person need something
     a person can act on. */
  if ((state === 'blocked' || state === 'needs_you') && !(f.on + f.owner + text).trim()) {
    ctx.err('A \'' + state + '\' report needs at least one of --on <what>, --owner <who>, or a note: that state summons a person, and an empty one names nothing to act on.');
    return 2;
  }
  const r = await ctx.call('POST', '/api/report', { state, text, on: f.on, owner: f.owner, until: f.until, project: f.project, auto: f.auto, from_pane: '' });
  if (!r.reached) return ctx.unreachable('record that');
  /* Dropped, not kept: a state this agent was in while its Kosmos was closed is
     stale by the time it opens. Exit 0, because nothing went wrong. */
  if (ctx.wrongWorld(r)) { ctx.out(ctx.outbox().WRONG_WORLD_SENTENCES.staleReport); return 0; }
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that: ' + ctx.refusedBy(r) + '.'); return 1; }
  if (r.json && r.json.recorded === true) { ctx.out('Recorded. The board reads it from here.'); return 0; }
  ctx.err('That was not recorded: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
  return 1;
}

async function verbWhoami(ctx) {
  const r = await ctx.call('POST', '/api/whoami', { from_pane: '' });
  if (!r.reached) { ctx.err('Kosmos did not answer, so we cannot tell you which account you are on.'); return 1; }
  /* The board's sentence, verbatim: a locally-invented answer is what this verb
     exists to stop (install/kosmos cmd_whoami). */
  ctx.out((r.json && typeof r.json.because === 'string') ? r.json.because : String(r.text || ''));
  return r.status >= 400 ? 1 : 0;
}

async function verbRoom(ctx, args) {
  const project = args[0];
  if (!project) { ctx.err(USAGE.room); return 2; }
  const r = await ctx.call('GET', '/api/project/' + projectSlug(project) + '/room?as=text', undefined, { agent: false });
  if (!r.reached) return ctx.unreachable('read that room');
  ctx.out(String(r.text || '').replace(/\n$/, ''));
  return r.status >= 400 ? 1 : 0;
}

/* #2710, as install/kosmos cmd_room: clears a room the loop-guard is holding, so
   the next post lands. Board-token gated, no agent token, no body. A project whose
   id is literally "reopen" cannot be READ this way; the Mac has the same edge. */
async function roomReopen(ctx, args) {
  const project = args[0];
  if (!project) { ctx.err('Usage: kosmos room reopen <project-id>   (clears a room the loop-guard is holding, so the next post lands)'); return 2; }
  const r = await ctx.call('POST', '/api/project/' + projectSlug(project) + '/room/reopen', undefined, { agent: false });
  if (!r.reached) return ctx.unreachable('reopen that room');
  if (r.status >= 200 && r.status < 300) { ctx.out('Reopened ' + project + '. The loop-guard hold is cleared; the next post to that room will land.'); return 0; }
  if (r.status === 404) { ctx.err('There is no project called "' + project + '", so there is no room to reopen.'); return 1; }
  const because = r.json && typeof r.json.because === 'string' ? r.json.because : '';
  ctx.err('We could not reopen that room' + (because ? ': ' + because : ''));
  return 1;
}

async function taskList(ctx, args) {
  const project = args[0];
  if (!project) { ctx.err('Usage: kosmos task list <project-id>'); return 2; }
  const r = await ctx.call('GET', '/api/tasks?project=' + projectSlug(project), undefined, { agent: false });
  if (!r.reached) return ctx.unreachable('list tasks');
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that: ' + ctx.refusedBy(r) + '.'); return 1; }
  const tasks = (r.json && Array.isArray(r.json.tasks)) ? r.json.tasks : null;
  if (!tasks) { ctx.out(String(r.text || '')); return 0; }
  if (!tasks.length) { ctx.out('No tasks for this project yet. Add one: kosmos task add <project-id> <what the task is>'); return 0; }
  for (const x of tasks) {
    const who = (x.whoNames && x.whoNames.length) ? ' (' + x.whoNames.join(', ') + ')' : '';
    ctx.out('[' + (x.number != null ? x.number : '?') + '] ' + (x.isClosed ? '[done] ' : '') + (x.sentence || '(no description)') + who);
  }
  return 0;
}

async function taskAdd(ctx, args) {
  const project = args[0];
  const sentence = args[1];
  if (!project || !sentence) { ctx.err('Usage: kosmos task add <project-id> "<what the task is>" ["more detail"]'); return 2; }
  const detail = args.slice(2).join(' ');
  const r = await ctx.call('POST', '/api/project/' + projectSlug(project) + '/tasks', { sentence, detail, from_pane: '' }, { agent: false });
  if (!r.reached) return ctx.unreachable('add that task');
  if (r.json && r.json.task) { ctx.out('Task added to ' + project + '. See it with: kosmos task list ' + project); return 0; }
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that task: ' + ctx.refusedBy(r) + '.'); return 1; }
  ctx.err('Kosmos gave an answer we could not read when adding that task.');
  return 1;
}

const TASK_NUMBER_NOT_A_NUMBER = 'The task number must be a number, from: kosmos task list <project-id>.';

async function taskClose(ctx, args) {
  const [project, num] = args;
  if (!project || !num) { ctx.err('Usage: kosmos task close <project-id> <task-number>   (the number is shown by kosmos task list)'); return 2; }
  if (!/^[0-9]+$/.test(num)) { ctx.err(TASK_NUMBER_NOT_A_NUMBER); return 2; }
  const r = await ctx.call('POST', '/api/project/' + projectSlug(project) + '/task/' + num + '/close', undefined, { agent: false });
  if (!r.reached) return ctx.unreachable('close that task');
  if (r.json && r.json.task) { ctx.out('Closed task ' + num + ' on ' + project + '.'); return 0; }
  if (ctx.refusedBy(r)) { ctx.err('Kosmos could not close that task: ' + ctx.refusedBy(r) + '.'); return 1; }
  ctx.err('Kosmos gave an answer we could not read when closing that task.');
  return 1;
}

/* #768, as install/kosmos cmd_task message: records the words on the task and
   notifies the agents assigned to it. Unlike list/add/close this PRESENTS the
   agent token: the route names the sender from it and leaves the sender off the
   notified list, which a Windows agent (no pane) could not otherwise get. */
async function taskMessage(ctx, args) {
  const [project, num] = args;
  const text = args.slice(2).join(' ');
  if (!project || !num || !text) { ctx.err('Usage: kosmos task message <project-id> <task-number> "<what to say>"'); return 2; }
  if (!/^[0-9]+$/.test(num)) { ctx.err(TASK_NUMBER_NOT_A_NUMBER); return 2; }
  const r = await ctx.call('POST', '/api/project/' + projectSlug(project) + '/task/' + num + '/message', { text, from_pane: '' });
  if (!r.reached) return r.timedOut ? maybe(ctx.err, 'Kosmos was slow to answer and we stopped waiting. Your message may have been recorded; check the task before sending it again.') : ctx.unreachable('send that message');
  if (r.json && r.json.ok === true) { ctx.out('Message recorded on task ' + num + ' of ' + project + '; any agents assigned to it were notified.'); return 0; }
  if (ctx.refusedBy(r)) { ctx.err('Kosmos refused that message: ' + ctx.refusedBy(r) + '.'); return 1; }
  ctx.err('Kosmos gave an answer we could not read when sending that message.');
  return 1;
}

/* The feedback verbs are engine-direct, as install/kosmos's `node -e` snippets are:
   the report store is local (engine/feedback.js), so they work with no board. */
async function feedbackWrite(ctx, args) {
  const body = args.length ? args.join(' ') : await ctx.readStdin();
  if (!String(body).trim()) {
    ctx.err('Nothing to write: a feedback report needs a body (pass it as an argument, or pipe it in on stdin).');
    ctx.err(POWERSHELL_PIPE_NOTE);
    return 2;
  }
  try { ctx.engine('feedback').write(body); } catch (e) {
    ctx.err('We could not save that report (' + String((e && e.message) || e) + ').');
    return 1;
  }
  ctx.out('Saved today\'s product-feedback report. It stays on this computer.');
  return 0;
}

async function feedbackShow(ctx, args) {
  const fb = ctx.engine('feedback');
  const date = args[0] || fb.today();
  if (!fb.isDateKey(date)) { ctx.err('that date must be YYYY-MM-DD'); return 2; }
  const body = fb.readBody(date);
  if (body == null) { ctx.err('no product-feedback report for ' + date); return 1; }
  ctx.out(String(body).replace(/\n$/, ''));
  return 0;
}

async function feedbackList(ctx) {
  for (const date of ctx.engine('feedback').list()) ctx.out(date);
  return 0;
}

/* The receive side (#2246): a ranked DRAFT digest for a person to review; it never
   opens a card. The reading and the digest are engine functions install/kosmos
   calls too (feedback.reportsForTriage, feedback-triage.digestFor), so the two
   CLIs differ only in how they parse flags. */
const TRIAGE_OPTION_NEEDS = { since: '--since needs a YYYY-MM-DD', dir: '--dir needs a path', cards: '--cards needs a file or -' };
async function feedbackTriage(ctx, args) {
  const o = { since: '', dir: '', cards: '' };
  while (args.length) {
    const a = args.shift();
    const m = /^--(since|dir|cards)$/.exec(a);
    if (!m) { ctx.err('Unknown option: kosmos feedback triage ' + a); return 2; }
    if (!args.length) { ctx.err(TRIAGE_OPTION_NEEDS[m[1]]); return 2; }
    o[m[1]] = args.shift();
  }
  let cardsText = '';
  if (o.cards === '-') cardsText = await ctx.readStdin();
  else if (o.cards) {
    try { cardsText = fs.readFileSync(o.cards, 'utf8'); } catch { ctx.err('could not read cards file: ' + o.cards); return 2; }
  }
  const got = ctx.engine('feedback').reportsForTriage({ since: o.since, dir: o.dir });
  for (const note of got.notes) ctx.err(note);
  if (!got.ok) { ctx.err(got.because); return 2; }
  ctx.out(ctx.engine('feedback-triage').digestFor(got.reports, cardsText));
  return 0;
}

async function feedbackPull(ctx, args) {
  let dir = '';
  while (args.length) {
    const a = args.shift();
    if (a !== '--dir') { ctx.err('Unknown option for pull: ' + a); return 2; }
    if (!args.length) { ctx.err('--dir needs a path'); return 2; }
    dir = args.shift();
  }
  let r;
  try { r = await ctx.engine('feedbackpull').pull(dir || undefined); } catch { ctx.err('could not pull the collected feedback'); return 1; }
  if (!r.ok) { ctx.err(r.because); return 1; }
  ctx.out('pulled ' + r.written + ' report(s)' + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + ' to ' + r.dir);
  ctx.out('next: kosmos feedback triage --dir ' + r.dir);
  return 0;
}

/* A verb whose first argument must be one of its subcommands: reached only when
   that argument is not one. install/kosmos's words and exit 2 for both cases. */
function subcommandRequired(verb) {
  return async (ctx, args) => {
    const sub = args[0];
    if (!sub || sub === 'help') { ctx.err(USAGE[verb]); return 2; }
    ctx.err('Unknown: kosmos ' + verb + ' ' + sub + '. Try: ' + Object.keys(SUBCOMMAND_HANDLERS[verb]).join(' | '));
    return 2;
  };
}

/* 🔑 THE DISPATCH, AND THE ONLY LIST OF WHAT THIS COMMAND DOES. A subcommand
   handler wins when the first argument names one; otherwise the verb's handler
   runs with every argument (a project id, a state, a message). */
const VERB_HANDLERS = {
  msg: verbMsg,
  reply: verbReply,
  post: verbPost,
  react: verbReact,
  report: verbReport,
  whoami: verbWhoami,
  room: verbRoom,
  task: subcommandRequired('task'),
  feedback: subcommandRequired('feedback'),
};
const SUBCOMMAND_HANDLERS = {
  report: { show: reportShow, status: reportShow },
  room: { reopen: roomReopen },
  task: { list: taskList, add: taskAdd, close: taskClose, message: taskMessage },
  feedback: { write: feedbackWrite, show: feedbackShow, list: feedbackList, pull: feedbackPull, triage: feedbackTriage },
};
const VERBS = Object.keys(VERB_HANDLERS);
const SUBCOMMANDS = Object.fromEntries(Object.entries(SUBCOMMAND_HANDLERS).map(([verb, subs]) => [verb, Object.keys(subs)]));

const BANNER = 'Usage: kosmos <' + VERBS.join('|') + '> ...   (this is the Windows agent command; the board itself runs from Kosmos.exe)';

/**
 * Run one command. `io` carries every seam: env, fetch, out/err writers, the
 * hook module (url, board token, agent token), the outbox module, stdin, and the
 * engine modules the feedback verbs require. Resolves to an exit code.
 */
async function main(argv, io) {
  const o = io || {};
  const env = o.env || process.env;
  const out = o.out || ((s) => process.stdout.write(s + '\n'));
  const err = o.err || ((s) => process.stderr.write(s + '\n'));
  let args;
  try { args = argvFrom(argv, o.readFile); } catch (e) { err(String(e.message)); return 2; }
  const verb = args.shift();
  const asksForHelp = args.some((a) => HELP_FLAGS.has(a));

  if (!Object.prototype.hasOwnProperty.call(VERB_HANDLERS, verb)) {
    /* `kosmos`, `kosmos --help`, `kosmos help`: the list, and nothing is sent. */
    if (HELP_FLAGS.has(verb) || verb === 'help' || asksForHelp) {
      out(BANNER);
      out('Add --help to any command to see how to use it; --help never sends anything.');
      return 0;
    }
    err(BANNER);
    return 2;
  }
  /* #1674: BEFORE any handler, so a verb added to the table later is covered
     without anyone remembering. No request of any kind, whoami included. */
  if (asksForHelp) { out(USAGE[verb]); return 0; }

  const doFetch = o.fetch || fetch;
  const hook = o.hook || require(path.join(engineDir(), 'kosmos-report-hook.js'));
  /* A leaf with no requires, so loading it here freezes nothing. */
  const identity = require(path.join(engineDir(), 'launchidentity.js'));
  const url = o.url || hook.resolveUrl(env, -1);

  /* Both credentials ride in headers, never in argv or a file. The board token is
     needed on an enforcing board (Windows always enforces); the agent token names
     the sender. Either may be absent: the board says what it refuses. The world
     header is always sent: it is how a board serving another Kosmos knows to say
     so rather than refuse the agent as a stranger. */
  function headersFor(withAgent) {
    const h = { 'content-type': 'application/json' };
    h[identity.WORLD_HEADER] = identity.worldHeaderValue(env);
    const bt = hook.readBoardToken();
    if (bt) h['x-kosmos-board-token'] = bt;
    const at = withAgent ? hook.agentToken(env) : null;
    if (at) h['x-kosmos-agent-token'] = at;
    return h;
  }

  /* One request. Resolves { reached:true, status, json, text } or
     { reached:false, timedOut } -- a timeout is told apart from "unreachable",
     because after a timeout the board may already have acted. */
  async function call(method, route, body, opts) {
    const c = opts || {};
    try {
      const res = await doFetch(url + route, {
        method,
        headers: headersFor(c.agent !== false),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs || REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* a text route, or not the board */ }
      return { reached: true, status: res.status, json, text };
    } catch (e) {
      const timedOut = Boolean(e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
      return { reached: false, timedOut };
    }
  }

  /* Required only on a 421: it reads store.ROOT, which this agent's environment
     already points at its own Kosmos. */
  const outbox = () => o.outbox || require(path.join(engineDir(), 'outbox.js'));
  const ctx = {
    env,
    out,
    err,
    call,
    outbox,
    readStdin: o.readStdin || (() => readStandardInput()),
    /* The feedback verbs' engine modules, required on use: each reads store.ROOT,
       which this agent's environment points at its own Kosmos, as outbox does. */
    engine: (name) => (o.engine && o.engine[name]) || require(path.join(engineDir(), name + '.js')),
    unreachable: (what) => { err('We could not reach Kosmos to ' + what + '. Is it running at ' + url + '?'); return 1; },
    refusedBy: (r) => (r.json && typeof r.json.error === 'string') ? clause(r.json.error) : null,
    /* The board is serving another Kosmos than this agent's. */
    wrongWorld: (r) => r.reached && r.status === WRONG_WORLD_STATUS && Boolean(r.json) && r.json.wrongWorld === true,
    /* reply / msg / post on a 421: keep it in this agent's Kosmos for later. */
    keepForLater: (sendVerb, body) => {
      const kept = outbox().keepFromClient({ verb: sendVerb, body, env });
      if (!kept.ok) { err(kept.because); return 1; }
      out(outbox().WRONG_WORLD_SENTENCES.kept);
      return 0;
    },
  };

  const subs = SUBCOMMAND_HANDLERS[verb];
  if (subs && Object.prototype.hasOwnProperty.call(subs, args[0])) return subs[args.shift()](ctx, args);
  return VERB_HANDLERS[verb](ctx, args);
}

/* The board's sentences mostly end in a period, and ours add one after them. */
function clause(s) { return s ? String(s).replace(/[.\s]+$/, '') : ''; }

/* A "maybe" is exit 3, never 1: 1 invites the retry that duplicates the send. */
function maybe(err, sentence) { err(sentence); return 3; }

module.exports = { main, argvFrom, readStandardInput, engineDir, projectSlug, VERBS, SUBCOMMANDS, USAGE, HELP_FLAGS, REQUEST_TIMEOUT_MS, POST_TIMEOUT_MS, STDIN_QUIET_LIMIT_MS, ARGV_FILE_FLAG };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write('kosmos: ' + String((e && e.message) || e) + '\n');
    process.exitCode = 1;
  });
}
