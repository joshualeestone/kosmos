'use strict';
/**
 * kosmos#2710, the CLI half:
 *   - a post the room loop-guard refuses no longer ends in a doubled period
 *     ("...bring you in.." -> "...bring you in."), and the agent's text is
 *     HANDED BACK so a refused substantive post is not silently lost;
 *   - `kosmos room reopen <project-id>` clears a held room over HTTP, and its
 *     usage / not-found arms behave.
 *
 * Same stub-server posture as cli.post-setE-2321.test.js: a fake board serves
 * the health page (so healthy() passes) and canned JSON for the routes under
 * test, and the real `install/kosmos` script is driven with execFile.
 *
 *   node --test cli.room-reopen-2710.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
/* #4796: the CLI reads the board token from the data root. A fresh one here, so the live board's token never
   travels to this test's stub board (or into anything the test records). */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-room-reopen-2710-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

const CLI = path.join(__dirname, 'install', 'kosmos');
const HEALTH = '<title>Kosmos</title>Agent Workforce';
const VALVE_BECAUSE = 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.';

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* A stub board. `routes` maps "METHOD /path-prefix" to { code, body }; any GET
   not matched serves the health page so healthy() passes. */
function withBoard(routes, fn) {
  const server = http.createServer((req, res) => {
    for (const key of Object.keys(routes)) {
      const [m, p] = key.split(' ');
      if (req.method === m && req.url.startsWith(p)) {
        const r = routes[key];
        res.writeHead(r.code, { 'content-type': 'application/json' });
        res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
        return;
      }
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(HEALTH);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#2710: a valve-refused post ends in ONE period and hands the agent its text back', () => {
  const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', because: VALVE_BECAUSE } } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const TEXT = 'the lease renews monthly unless notice is given, which changes our timeline';
    const out = await runCli(['post', 'henderson', TEXT], env);
    assert.match(out.stdout, /bring you in\./, 'the refusal sentence is missing');
    assert.doesNotMatch(out.stdout, /bring you in\.\./, 'the refusal still ends in a doubled period');
    assert.ok(out.stdout.includes(TEXT), 'the agent’s text was not handed back, so a refused post is still lost');
    assert.match(out.stdout, /not sent/, 'the hand-back does not tell the agent the post was not sent');
    assert.notEqual(out.code, 0, 'a not-posted result must exit non-zero');
  });
});

/* #4934: the loop guard's refusal says nothing was kept and not to send it another way (agents sent it by direct
   message too, then posted it again once the room opened, so people got it twice). */
test('#4934: a loop-guard refusal (code room_held) says nothing was kept, not to send it another way, and hands the text back', () => {
  const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', code: 'room_held', because: VALVE_BECAUSE } } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const TEXT = 'the lease renews monthly unless notice is given';
    const out = await runCli(['post', 'henderson', TEXT], env);
    assert.match(out.stdout, /Not posted: this room went back and forth without landing, so Kosmos has paused it until your person steps in\. Nothing was sent to anyone, and Kosmos does not keep it or send it later\./);
    assert.match(out.stdout, /Do not send it another way, such as a direct message: post it here again once your person has posted in the room or reopened it, or in about an hour\./);
    assert.doesNotMatch(out.stdout, /bring you in/, 'the person-facing sentence reached the agent');
    assert.match(out.stdout, /Here it is to keep:\n *the lease renews monthly/);
    assert.equal(out.code, 1);
  });
});

test('#6920: a room_held refusal offers the one closing summary, unless the board says this member used it', async () => {
  for (const [extra, offered] of [[{ closingEligible: true }, true], [{ closingUsed: true }, false], [{}, false]]) {   // #6925: {} is an older board
    const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', code: 'room_held', because: VALVE_BECAUSE, ...extra } } } };
    await withBoard(routes, async (port) => {
      const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
      const out = await runCli(['post', 'henderson', 'the lease renews monthly'], env);
      assert.match(out.stdout, /Not posted: this room went back and forth/, 'CONTROL: the refusal itself is still said');
      const hint = /The one exception: a summary that settles the thread can go through now, once: 400 characters or more\./;
      if (offered) {
        assert.match(out.stdout, hint, 'the closing summary was not offered');
        const min = (fs.readFileSync(path.join(__dirname, 'engine', 'messages.js'), 'utf8').match(/^const CLOSING_POST_MIN = (\d+);/m) || [])[1];
        assert.ok(min, 'CLOSING_POST_MIN not found in engine/messages.js');
        assert.ok(out.stdout.includes(min + ' characters or more'), 'the CLI offers a different length than the board requires (' + min + ')');
        assert.ok(out.stdout.indexOf('Do not send it another way') < out.stdout.indexOf('The one exception'),
          'the exception was said before the wait, so the two read as opposite instructions');
      }
      else assert.doesNotMatch(out.stdout, hint, 'a member that used its closing post was offered it again');
    });
  }
});

/* #6420: the board says when the held room's limit lifts (clearsInMinutes); the CLI passes it on in place of
   "about an hour". The test above, with no such field (an older board), is the CONTROL that the old words stay. */
test('#6420: a held room\'s refusal says when the limit lifts', () => {
  const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', code: 'room_held', because: VALVE_BECAUSE, clearsAt: '2026-10-17T19:12:00.000Z', clearsInMinutes: 17 } } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['post', 'henderson', 'the lease renews monthly'], env);
    assert.match(out.stdout, /or reopened it, or in about 17 minutes, when the limit on agent posts here lifts\./);
    assert.doesNotMatch(out.stdout, /about an hour/, 'the board said when the room clears, and the CLI still said an hour');
    assert.equal(out.code, 1);
  });
});

test('#6420: a clearsInMinutes that is not a whole number of minutes, 1 or more, keeps the old words', async () => {
  for (const bad of ['0', '"17"', '017', '2.5', 'null', '60', '75']) {   // sixty or more: about an hour
    const routes = { 'POST /api/post': { code: 200, body: '{"delivery":{"state":"could_not","code":"room_held","because":"held","clearsInMinutes":' + bad + '}}' } };
    await withBoard(routes, async (port) => {
      const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
      const out = await runCli(['post', 'henderson', 'x'], env);
      assert.match(out.stdout, /or in about an hour\./, 'clearsInMinutes ' + bad + ' was said as a time');
    });
  }
});

test('#6420: one minute reads as a minute', () => {
  const routes = { 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', code: 'room_held', because: VALVE_BECAUSE, clearsInMinutes: 1 } } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['post', 'henderson', 'x'], env);
    assert.match(out.stdout, /or in about a minute, when the limit on agent posts here lifts\./);
  });
});

/* #6608: an agreement-only reply to a post that named one owner. The board sends `owner`; the CLI names them rather than
   saying the reply "only agreed with what was already said", which is untrue there. CONTROL: no owner, the old words. */
test('#6608: an owner-named refusal (ack_only with owner) names the owner; without one the old words stay', async () => {
  const at = (owner) => ({ 'POST /api/post': { code: 200, body: { delivery: { state: 'could_not', code: 'ack_only', because: 'x', ...(owner ? { owner } : {}) } } } });
  await withBoard(at('Mara'), async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['post', 'henderson', 'agreed'], env);
    assert.match(out.stdout, /Not posted: that post named Mara to take it, so Kosmos did not pass on an agreement-only reply from anyone else\. Nothing was sent\./);
    assert.doesNotMatch(out.stdout, /already said/, 'the owner-named refusal still said the reply repeated what was already said');
    assert.equal(out.code, 1);
  });
  await withBoard(at(null), async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['post', 'henderson', 'agreed'], env);
    assert.match(out.stdout, /Not posted: this only agreed with what was already said/, 'CONTROL: the plain ack refusal lost its words');
  });
  // A display name with a quote arrives escaped; the sed would halve it, so the general words are said instead.
  await withBoard(at('Ma"ra'), async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['post', 'henderson', 'agreed'], env);
    assert.doesNotMatch(out.stdout, /named Ma\\?( |$)/, 'a quoted name was cut in half');
    assert.match(out.stdout, /Not posted: this only agreed with what was already said/, 'a quoted name did not fall back to the general words');
  });
});

test('#2710: `kosmos room reopen <project>` clears a held room and says so', () => {
  const routes = { 'POST /api/project/henderson/room/reopen': { code: 200, body: { ok: true, at: '2026-09-10T20:00:00.000Z' } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen', 'henderson'], env);
    assert.match(out.stdout, /Reopened henderson/, 'reopen did not confirm the room was reopened: ' + out.stdout);
    assert.equal(out.code, 0, 'a successful reopen must exit 0');
  });
});

test('#2710: `kosmos room reopen` with no project prints usage and exits 2', () => {
  return withBoard({}, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen'], env);
    assert.match(out.stdout, /Usage: kosmos room reopen/, 'no-project reopen did not print its usage');
    assert.equal(out.code, 2, 'a usage error must exit 2');
  });
});

test('#2710: reopen of an unknown project reports it and exits non-zero', () => {
  const routes = { 'POST /api/project/nope/room/reopen': { code: 404, body: { ok: false, because: 'there is no project by that name' } } };
  return withBoard(routes, async (port) => {
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
    const out = await runCli(['room', 'reopen', 'nope'], env);
    assert.match(out.stdout, /no project called "nope"/, 'a 404 reopen was not reported clearly: ' + out.stdout);
    assert.notEqual(out.code, 0, 'a failed reopen must exit non-zero');
  });
});

/* #6925: a post that went through a held room as this member's one summary says so, placed or unconfirmed; an ordinary
   post does not. One body is written with a space after the colon, the shape the CLI's match must still read. */
test('#6925: the one-summary line on a landed closing post (compact and spaced JSON), not on an ordinary post', async () => {
  const LINE = /This went through as your one summary while the room is held; anything more is not posted until the room opens\./;
  const cases = [
    ['{"delivery":{"state":"placed","closing":true}}', true],
    ['{"delivery":{"state":"placed", "closing": true}}', true],
    ['{"delivery":{"state":"unconfirmed","because":"x","closing":true}}', true],
    ['{"delivery":{"state":"placed"}}', false],
  ];
  for (const [body, said] of cases) {
    const routes = { 'POST /api/post': { code: 200, body } };
    await withBoard(routes, async (port) => {
      const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), TMUX_PANE: '%42' };
      const out = await runCli(['post', 'henderson', 'a summary'], env);
      if (said) assert.match(out.stdout, LINE, 'not told it used the one summary: ' + body);
      else assert.doesNotMatch(out.stdout, /your one summary/, 'an ordinary post was called the one summary');
    });
  }
});
