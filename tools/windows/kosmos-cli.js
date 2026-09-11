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
 * 🔑 WHY NODE AND NOT install/kosmos. The Mac CLI is bash. A Windows agent runs its
 * commands through Claude Code's PowerShell tool as often as through Git Bash
 * (the measured failure was in PowerShell), and nothing guarantees bash is there.
 * The zip already carries its own node.exe, so this runs in either shell, from
 * the `kosmos.ps1` / `kosmos` shims shipped beside it (tools/windows/).
 *
 * 🔑 THE SAME WIRE AS install/kosmos, AND THE BOARD'S OWN WORDS. Each verb sends
 * the request body the bash CLI sends, to the same route, and prints the board's
 * `because` sentence rather than inventing one. What this adds is identity: an
 * agent here has no tmux pane, so it presents the per-run agent token the
 * supervisor put in its environment (`KOSMOS_AGENT_TOKEN`), which /api/reply,
 * /api/report and /api/whoami already resolved, and which /api/msg, /api/post and
 * /api/react now resolve too (server.js `senderFromAgentToken`).
 *
 * 🔑 NOTHING ABOUT THE BOARD IS RE-DERIVED HERE. The url, the board token and the
 * agent-token check come from engine/kosmos-report-hook.js, the Windows client
 * that already delivers every self-report, so there is one copy of each.
 *
 * Exit codes follow install/kosmos: 0 done, 1 failed or refused, 2 usage,
 * 3 "maybe" -- never 1 for a maybe, which would invite the duplicate a retry
 * sends. One deliberate difference: a TIMEOUT on msg or reply is also 3 here (the
 * board may already have acted), where install/kosmos says 1.
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

/* install/kosmos's own usage lines, verb for verb. */
const USAGE = {
  msg: 'Usage: kosmos msg <agent> <what you want to tell them>',
  reply: 'Usage: kosmos reply <what you want to tell them>   (up to 2000 characters; longer is refused, not truncated)',
  post: 'Usage: kosmos post <project-id> <what you want to tell the room>  (text only; file attachments are not supported yet, kosmos#1955)',
  react: 'Usage: kosmos react <project-id> <post-id> <emoji>   (the post id is in brackets before each post in kosmos room, e.g. [m3])',
  report: 'Usage: kosmos report <started|working|idle|needs_you|blocked|stopped> [--on <what>] [--owner <who>] [--until <when>] [--project <project-id>] [--auto] [what you want to say about it]',
  room: 'Usage: kosmos room <project-id>   (project ids are in your instructions\' Your projects section)',
  task: 'Usage: kosmos task <list|add|close>\n  kosmos task list <project-id>\n  kosmos task add  <project-id> "<what the task is>" ["more detail"]\n  kosmos task close <project-id> <task-number>',
};
const VERBS = ['msg', 'reply', 'post', 'react', 'report', 'whoami', 'room', 'task'];

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
  try { parsed = JSON.parse(String(read(String(a[1] || ''))).replace(/^\uFEFF/, '')); } catch (e) {
    throw new Error('kosmos could not read the arguments PowerShell passed (' + ((e && e.message) || e) + ').');
  }
  if (!Array.isArray(parsed)) throw new Error('kosmos could not read the arguments PowerShell passed (not a list).');
  return parsed.map((x) => {
    if (x == null) return '';
    if (typeof x === 'object') throw new Error('One of the arguments reached kosmos as a PowerShell list or table, not text, so its words would change. Put that part in quotes and run it again.');
    return String(x);
  });
}
/* cmd_room's and cmd_task's sanitizer, exactly: a project id keeps only
   [A-Za-z0-9._-], so `kosmos room <id>` and `kosmos task <id>` reach one route. */
function projectSlug(id) { return String(id || '').replace(/[^A-Za-z0-9._-]/g, ''); }

/**
 * Run one command. `io` carries every seam: env, fetch, out/err writers, and the
 * hook module (url, board token, agent token). Resolves to an exit code.
 */
async function main(argv, io) {
  const o = io || {};
  const env = o.env || process.env;
  const out = o.out || ((s) => process.stdout.write(s + '\n'));
  const err = o.err || ((s) => process.stderr.write(s + '\n'));
  const doFetch = o.fetch || fetch;
  const hook = o.hook || require(path.join(engineDir(), 'kosmos-report-hook.js'));
  const url = o.url || hook.resolveUrl(env, -1);
  let args;
  try { args = argvFrom(argv, o.readFile); } catch (e) { err(String(e.message)); return 2; }
  const verb = args.shift();

  if (!verb || !VERBS.includes(verb)) {
    err('Usage: kosmos <' + VERBS.join('|') + '> ...   (this is the Windows agent command; the board itself runs from Kosmos.exe)');
    return 2;
  }

  /* Both credentials ride in headers, never in argv or a file. The board token is
     needed on an enforcing board (Windows always enforces); the agent token names
     the sender. Either may be absent: the board says what it refuses. */
  function headersFor(withAgent) {
    const h = { 'content-type': 'application/json' };
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
  const unreachable = (what) => { err('We could not reach Kosmos to ' + what + '. Is it running at ' + url + '?'); return 1; };
  const refusedBy = (r) => (r.json && typeof r.json.error === 'string') ? clause(r.json.error) : null;

  if (verb === 'msg') {
    const to = args.shift();
    const text = args.join(' ');
    if (!to || !text) { err(USAGE.msg); return 2; }
    const r = await call('POST', '/api/msg', { to, text, from_pane: '' });
    if (!r.reached) return r.timedOut ? maybe(err, 'Kosmos was slow to answer and we stopped waiting. The message may have been delivered; check with them before sending it again.') : unreachable('send that');
    if (refusedBy(r)) { err('Kosmos refused that request: ' + refusedBy(r) + '.'); return 1; }
    const d = (r.json && r.json.delivery) || {};
    if (d.state === 'placed') { out('Placed with ' + to + '.'); return 0; }
    if (d.state === 'unconfirmed') return maybe(err, 'Not confirmed: ' + (clause(d.because) || 'the text may already be in their composer') + '. Do not re-send; check with them.');
    err('Not delivered: ' + (clause(d.because) || 'we could not tell why') + '.');
    return 1;
  }

  if (verb === 'reply') {
    const text = args.join(' ');
    if (!text) { err(USAGE.reply); return 2; }
    const r = await call('POST', '/api/reply', { text, from_pane: '' });
    if (!r.reached) return r.timedOut ? maybe(err, 'Kosmos was slow to answer and we stopped waiting. Your answer may have been kept; check your conversation before sending it again.') : unreachable('keep that');
    if (refusedBy(r)) { err('Kosmos refused that: ' + refusedBy(r) + '.'); return 1; }
    if (r.json && r.json.kept === true) { out('Answered. It is in their conversation with you.'); return 0; }
    err('That was not kept: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
    return 1;
  }

  if (verb === 'post') {
    if (args.some((a) => /^--(file|attach)(=|$)/.test(a))) {
      err('Attaching a file to a room post is not supported yet (kosmos#1955).');
      err('Paste the document\'s content inline as the message, or share its path with the operator.');
      err('Text only for now: kosmos post <project-id> <text>');
      return 2;
    }
    const project = args.shift();
    const text = args.join(' ');
    if (!project || !text) { err(USAGE.post); return 2; }
    const r = await call('POST', '/api/post', { project, text, from_pane: '' }, { timeoutMs: POST_TIMEOUT_MS });
    if (!r.reached) return r.timedOut ? maybe(err, 'Kosmos is still delivering that post and we stopped waiting. Do not re-post; the room screen shows who got it.') : unreachable('post that');
    if (refusedBy(r)) { err('Kosmos refused that request: ' + refusedBy(r) + '.'); return 1; }
    const d = (r.json && r.json.delivery) || {};
    if (d.state === 'placed') { out('Posted to ' + project + '. Everyone on it has it waiting.'); return 0; }
    if (d.state === 'unconfirmed') return maybe(err, 'Posted, but not everyone is confirmed' + (d.because ? ': ' + clause(d.because) : '') + '. Do not re-post; the room screen shows who got it.');
    err('Not posted: ' + (clause(d.because) || 'we could not tell why') + '.');
    return 1;
  }

  if (verb === 'react') {
    const [project, of, emoji] = args;
    if (!project || !of || !emoji) { err(USAGE.react); return 2; }
    const r = await call('POST', '/api/react', { project, of, emoji, from_pane: '' });
    if (!r.reached) return r.timedOut ? maybe(err, 'Kosmos was slow to answer and we stopped waiting. Your reaction may have landed; check the room before reacting again, because reacting again takes it back off.') : unreachable('react');
    if (refusedBy(r)) { err('Kosmos refused that: ' + refusedBy(r) + '.'); return 1; }
    /* install/kosmos's sentences: the route TOGGLES, so the agent must hear which. */
    if (r.json && r.json.ok && r.json.op === 'remove') { out('Took your ' + emoji + ' back off that post.'); return 0; }
    if (r.json && r.json.ok) { out('Reacted ' + emoji + ' to that post.'); return 0; }
    err('Not reacted: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
    return 1;
  }

  if (verb === 'report') {
    if (args[0] === 'show' || args[0] === 'status') {
      const r = await call('GET', '/api/report?as=text&from_pane=');
      if (!r.reached) return unreachable('read your report');
      out(String(r.text || '').replace(/\n$/, ''));
      return r.status >= 400 ? 1 : 0;
    }
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
    if (!state) { err(USAGE.report); return 2; }
    /* #2001, as install/kosmos: the two states that summon a person need something
       a person can act on. */
    if ((state === 'blocked' || state === 'needs_you') && !(f.on + f.owner + text).trim()) {
      err('A \'' + state + '\' report needs at least one of --on <what>, --owner <who>, or a note: that state summons a person, and an empty one names nothing to act on.');
      return 2;
    }
    const r = await call('POST', '/api/report', { state, text, on: f.on, owner: f.owner, until: f.until, project: f.project, auto: f.auto, from_pane: '' });
    if (!r.reached) return unreachable('record that');
    if (refusedBy(r)) { err('Kosmos refused that: ' + refusedBy(r) + '.'); return 1; }
    if (r.json && r.json.recorded === true) { out('Recorded. The board reads it from here.'); return 0; }
    err('That was not recorded: ' + (clause(r.json && r.json.because) || 'we could not tell why') + '.');
    return 1;
  }

  if (verb === 'whoami') {
    const r = await call('POST', '/api/whoami', { from_pane: '' });
    if (!r.reached) { err('Kosmos did not answer, so we cannot tell you which account you are on.'); return 1; }
    /* The board's sentence, verbatim: a locally-invented answer is what this verb
       exists to stop (install/kosmos cmd_whoami). */
    out((r.json && typeof r.json.because === 'string') ? r.json.because : String(r.text || ''));
    return r.status >= 400 ? 1 : 0;
  }

  if (verb === 'room') {
    const project = args[0];
    if (!project) { err(USAGE.room); return 2; }
    const r = await call('GET', '/api/project/' + projectSlug(project) + '/room?as=text', undefined, { agent: false });
    if (!r.reached) return unreachable('read that room');
    out(String(r.text || '').replace(/\n$/, ''));
    return r.status >= 400 ? 1 : 0;
  }

  // task
  const sub = args.shift();
  const project = args[0];
  if (sub === 'list') {
    if (!project) { err('Usage: kosmos task list <project-id>'); return 2; }
    const r = await call('GET', '/api/tasks?project=' + projectSlug(project), undefined, { agent: false });
    if (!r.reached) return unreachable('list tasks');
    if (refusedBy(r)) { err('Kosmos refused that: ' + refusedBy(r) + '.'); return 1; }
    const tasks = (r.json && Array.isArray(r.json.tasks)) ? r.json.tasks : null;
    if (!tasks) { out(String(r.text || '')); return 0; }
    if (!tasks.length) { out('No tasks for this project yet. Add one: kosmos task add <project-id> <what the task is>'); return 0; }
    for (const x of tasks) {
      const who = (x.whoNames && x.whoNames.length) ? ' (' + x.whoNames.join(', ') + ')' : '';
      out('[' + (x.number != null ? x.number : '?') + '] ' + (x.isClosed ? '[done] ' : '') + (x.sentence || '(no description)') + who);
    }
    return 0;
  }
  if (sub === 'add') {
    const sentence = args[1];
    if (!project || !sentence) { err('Usage: kosmos task add <project-id> "<what the task is>" ["more detail"]'); return 2; }
    const detail = args.slice(2).join(' ');
    const r = await call('POST', '/api/project/' + projectSlug(project) + '/tasks', { sentence, detail, from_pane: '' }, { agent: false });
    if (!r.reached) return unreachable('add that task');
    if (r.json && r.json.task) { out('Task added to ' + project + '. See it with: kosmos task list ' + project); return 0; }
    if (refusedBy(r)) { err('Kosmos refused that task: ' + refusedBy(r) + '.'); return 1; }
    err('Kosmos gave an answer we could not read when adding that task.');
    return 1;
  }
  if (sub === 'close') {
    const num = args[1];
    if (!project || !num) { err('Usage: kosmos task close <project-id> <task-number>   (the number is shown by kosmos task list)'); return 2; }
    if (!/^[0-9]+$/.test(num)) { err('The task number must be a number, from: kosmos task list <project-id>.'); return 2; }
    const r = await call('POST', '/api/project/' + projectSlug(project) + '/task/' + num + '/close', undefined, { agent: false });
    if (!r.reached) return unreachable('close that task');
    if (r.json && r.json.task) { out('Closed task ' + num + ' on ' + project + '.'); return 0; }
    if (refusedBy(r)) { err('Kosmos could not close that task: ' + refusedBy(r) + '.'); return 1; }
    err('Kosmos gave an answer we could not read when closing that task.');
    return 1;
  }
  err(sub ? 'Unknown: kosmos task ' + sub + '. Try: list | add | close' : USAGE.task);
  return 2;
}

/* The board's sentences mostly end in a period, and ours add one after them. */
function clause(s) { return s ? String(s).replace(/[.\s]+$/, '') : ''; }

/* A "maybe" is exit 3, never 1: 1 invites the retry that duplicates the send. */
function maybe(err, sentence) { err(sentence); return 3; }

module.exports = { main, argvFrom, engineDir, projectSlug, VERBS, REQUEST_TIMEOUT_MS, POST_TIMEOUT_MS, ARGV_FILE_FLAG };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write('kosmos: ' + String((e && e.message) || e) + '\n');
    process.exitCode = 1;
  });
}
