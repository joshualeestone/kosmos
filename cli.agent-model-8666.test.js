'use strict';
/**
 * kosmos#8666: `kosmos agent model "<name>"` shows an agent's model (its card's line, from the agent list, #8665) and the
 * models it can switch to (GET /api/agent/<name>/model); `kosmos agent model "<name>" "<model>" [--yes]` switches it
 * through AI Settings' own route (POST /api/agent/<name>/model), after a confirm, never for the caller itself. Run
 * against a stub board in a sandboxed KOSMOS_HOME for install/kosmos, and in process for the Windows CLI, as
 * cli.agent-restart-8071.test.js does. Every case that sends nothing has a control showing the same stub records a POST.
 * The route's own answers are pinned by server.switch-account-1373.test.js; these are the shapes it sends.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);
const create = require('./engine/create');

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agentmd-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
const CLI = path.join(__dirname, 'install', 'kosmos');

// The menu the route sends for a Claude agent (create.modelChoices), from the real list.
const MENU = { ok: true, provider: 'anthropic', kind: 'menu', set: 'claude-sonnet-5',
  models: create.modelsFor('anthropic').map((m) => ({ key: m.key, label: m.label, arg: m.arg })) };
const FREE = { ok: true, provider: 'google', kind: 'free', set: 'gemini-2.5-flash', vendorLabel: 'Gemini' };
const UNLISTED = { ok: true, provider: 'openai', kind: 'account', set: '', listed: false, because: 'this sign-in cannot list models yet; it is not an API key' };
const MUSE = { ok: false, because: 'Meta Muse picks its own model, so one cannot be chosen here' };
// The route's two answers, in its own words (server.js POST /api/agent/<name>/model).
const CHANGED = [200, { outcome: 'changed', model: { key: 'opus55' }, because: 'Claude Opus 5.5 it is. It is starting again now, and it will look idle until you say something to it.' }];
const REFUSED = [400, { outcome: 'refused', because: 'that is not a valid Gemini model name' }];
const LIST = { agents: [{ name: 'Sally Sales', role: 'Sales', state: 'Idle', model: 'Claude Sonnet 5' }] };

function withStub(choices, reply, fn, self = 'me-agent') {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/api/whoami') {
        let b = {}; try { b = JSON.parse(raw || '{}'); } catch { b = {}; }
        const says = (b.from_pane && String(b.from_pane).length) || req.headers['x-kosmos-agent-token'];
        return json(200, self !== null && says ? { ok: true, agent: self } : { ok: false, because: 'we could not match that to one of your agents' });
      }
      if (req.url === '/api/agents/list') return json(200, LIST);
      const m = /^\/api\/agent\/([^/?]+)\/model(\?resolve=1)?$/.exec(req.url);
      if (m) {
        seen.push({ method: req.method, url: req.url, body: raw });
        /* Review 5: as the real route. The read resolves a name as the list prints it ("Sally Sales", any case) to the
           agent's own name (sally-sales), and says found:false for a name no agent answers to. The switch is NOT
           resolved, and refuses a name that is not an agent's own (create.NAME_RE), so a CLI that switched by the
           display name goes red here. */
        const asked = decodeURIComponent(m[1]);
        if (req.method === 'GET') {
          const key = asked.trim().toLowerCase();
          if (!m[2]) return json(200, /^[a-z0-9_-]+$/.test(asked) ? choices : { ok: false, because: 'that is not a name we can act on' });
          if (key === 'sally sales' || key === 'sally-sales') return json(200, { ...choices, name: 'sally-sales', shown: 'Sally Sales' });
          // Review 6: a word that is one agent's folder (sal) while the list shows another by it, and a word two answer to.
          if (key === 'sal') return json(200, { ...choices, name: 'sal', shown: 'Sal Folder' });
          if (key === 'twice') return json(200, { ok: false, ambiguous: true, because: 'more than one agent is called Twice (twice-a, shown as Twice; twice-b); name it by one of those names', name: 'Twice' });
          return json(200, { ok: false, because: asked + ' was not started by Kosmos, so we cannot change what it runs on.', name: asked, found: false });
        }
        if (!/^[a-z0-9_-]+$/.test(asked)) return json(400, { outcome: 'refused', because: 'that is not a name we can act on' });
        return json(reply[0], reply[1]);
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}
const posts = (seen) => seen.filter((s) => s.method === 'POST');

async function cli(port, args, extra = {}) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: 'abc123', ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  try { const { stdout, stderr } = await run(CLI, args, { env, timeout: 30000 }); return { code: 0, out: stdout + stderr }; }
  catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}
const wincli = require('./tools/windows/kosmos-cli');
const hookStub = { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'BOARDTOKEN_test_8666', agentToken: (env) => (/^[0-9a-f]+$/.test(env.KOSMOS_AGENT_TOKEN || '') ? env.KOSMOS_AGENT_TOKEN : null) };
async function winRun(port, argv, seams) {
  const out = []; const err = []; const asked = [];
  const s = seams || {};
  const code = await wincli.main(argv, { env: s.env || { KOSMOS_AGENT_TOKEN: 'abc123' }, hook: hookStub, url: 'http://127.0.0.1:' + port,
    out: (x) => out.push(x), err: (x) => err.push(x), canAsk: () => s.tty === true,
    ask: (q) => { asked.push(q); return Promise.resolve(s.answer || ''); } });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}
// kosmos#8378: on Windows only the Windows CLI runs (the Mac CLI runs install/kosmos by its shebang), so a count that
// adds both CLIs' requests expects RUNS of them, and a control that needs one CLI uses the one this host runs.
const RUNS = SKIP_POSIX_SHELL ? 1 : 2;
const hostRun = (port, argv) => (SKIP_POSIX_SHELL ? winRun(port, argv) : cli(port, argv));
const both = async (port, argv) => [...(SKIP_POSIX_SHELL ? [] : [await cli(port, argv)]), await winRun(port, argv)].map((r) => ({ code: r.code, text: r.out + (r.err ? '\n' + r.err : '') }));

test('kosmos#8666: with no model, both CLIs show the card\'s model line and the menu, mark the job\'s model, and send nothing', () => withStub(MENU, CHANGED, async (port, seen) => {
  for (const r of await both(port, ['agent', 'model', ' Sally Sales '])) {
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /^ *Sally Sales \(sally-sales\)'s model: Claude Sonnet 5$/m);
    assert.match(r.text, /It can switch to \(kosmos agent model "Sally Sales" "<model>"\):/);
    assert.match(r.text, /^ *opus55 {2}Claude Opus 5\.5$/m);
    assert.match(r.text, /^ *sonnet {2}Claude Sonnet 5 {2}\(its startup job starts it on this one\)$/m);
  }
  assert.deepEqual(seen.map((s) => s.method + ' ' + s.url), Array(RUNS).fill('GET /api/agent/Sally%20Sales/model?resolve=1'), 'the name trimmed and resolved, and no switch');
}));

test('kosmos#8666: --yes switches through AI Settings\' route, by the menu key or the full id, in the route\'s words', () => withStub(MENU, CHANGED, async (port, seen) => {
  for (const want of ['opus55', 'claude-opus-5-5']) {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', want, '--yes'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /Switching Sally Sales \(sally-sales\) to Claude Opus 5\.5 restarts it/, 'the confirm names the agent that will restart');
      assert.match(r.text, /Claude Opus 5\.5 it is\. It is starting again now, and it will look idle until you say something to it\.$/m);
    }
  }
  assert.deepEqual(posts(seen).map((s) => JSON.parse(s.body).model), ['opus55', 'claude-opus-5-5'].flatMap((m) => Array(RUNS).fill(m)), 'sent as given');
  // Review 5: switched by the agent's own name, which the read resolved, never by the name the list prints.
  assert.deepEqual([...new Set(posts(seen).map((s) => s.url))], ['/api/agent/sally-sales/model']);
}));

test('kosmos#8666: a model not on the menu is refused with the list, and the job\'s own model is "already set"; nothing is sent', () => withStub(MENU, CHANGED, async (port, seen) => {
  for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'gpt-5', '--yes'])) {
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /gpt-5 is not a model Sally Sales can switch to\. Nothing was changed\. Pick one of: fable52 \(Claude Fable 5\.2\), .*sonnet \(Claude Sonnet 5\)/);
  }
  for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'sonnet', '--yes'])) {
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Sally Sales's startup job already names Claude Sonnet 5, so nothing was changed\. To start it again on that model, use kosmos agent restart "Sally Sales"\./);
  }
  assert.equal(posts(seen).length, 0, 'a refused or unneeded switch was sent');
  assert.equal((await hostRun(port, ['agent', 'model', 'Sally Sales', 'haiku', '--yes'])).code, 0, 'CONTROL: a good switch was not sent');
  assert.equal(posts(seen).length, 1);
}));

test('kosmos#8666: no terminal and no --yes, an option-shaped word, an empty model, an extra word, or yourself: nothing is sent', async () => {
  await withStub(MENU, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'opus55'])) {
      assert.equal(r.code, 2, r.text);
      assert.match(r.text, /Nothing was changed: there is no terminal here to confirm on\. To switch Sally Sales to opus55 without being asked, add --yes\./);
    }
    for (const argv of [['agent', 'model', '--foo'], ['agent', 'model', 'Sally Sales', '--opus'], ['agent', 'model', 'Sally Sales', '', '--yes'],
      ['agent', 'model', 'Sally Sales', 'opus55', 'extra', '--yes'], ['agent', 'model']]) {
      for (const r of await both(port, argv)) assert.equal(r.code, 2, argv.join(' ') + ': ' + r.text);
    }
    assert.equal(seen.length, 0, 'a refused usage still reached the board');
    const w = await winRun(port, ['agent', 'model', 'Sally Sales', 'opus55'], { tty: true, answer: 'n' });
    assert.equal(w.code, 1, w.err);
    assert.match(w.err, /Cancelled\. Nothing was changed\./);
    assert.equal(posts(seen).length, 0, 'a cancelled switch was sent');
  });
  await withStub(MENU, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'sally sales', 'opus55', '--yes'])) {
      assert.equal(r.code, 2, r.text);
      assert.match(r.text, /Nothing was changed: sally sales is you, and switching your own model restarts you/);
    }
    assert.equal(posts(seen).length, 0, 'an agent switched its own model');
  }, 'sally-sales');   // review 5: whoami names the agent by its own name, which the typed display name resolves to
});

test('kosmos#8666: Gemini takes a model id; a refused list is said; the route\'s refusal is said; an account that cannot list says why', async () => {
  await withStub(FREE, REFUSED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /Its startup job starts it on gemini-2\.5-flash\./);
      assert.match(r.text, /Kosmos has no list of Gemini's models\. To switch it, give the model's id as Gemini names it/);
    }
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'gemini 3', '--yes'])) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /Kosmos did not change Sally Sales's model: that is not a valid Gemini model name\.$/m);
    }
    assert.deepEqual(posts(seen).map((s) => JSON.parse(s.body).model), ['gemini 3', 'gemini 3'], 'a free id goes to the route, which checks it');
  });
  await withStub(MUSE, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /Its model cannot be changed here: Meta Muse picks its own model, so one cannot be chosen here\./);
    }
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'x', '--yes'])) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /Kosmos did not change Sally Sales's model: Meta Muse picks its own model/);
    }
    assert.equal(posts(seen).length, 0);
  });
  await withStub(UNLISTED, CHANGED, async (port) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /Kosmos could not list the models its OpenAI account can run: this sign-in cannot list models yet; it is not an API key\./);
    }
  });
});

test('kosmos#8666 review 1: an OpenAI account\'s menu (rows with no full id) marks the job\'s model and says "already set" on both CLIs', () => withStub(
  { ok: true, provider: 'openai', kind: 'account', set: 'gpt-5', models: [{ key: 'o3', label: 'o3' }, { key: 'gpt-5', label: 'GPT 5' }] }, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /^ *gpt-5 {2}GPT 5 {2}\(its startup job starts it on this one\)$/m, 'the set mark moved: ' + r.text);
      assert.match(r.text, /^ *o3 {2}o3$/m);
    }
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'gpt-5', '--yes'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /Sally Sales's startup job already names GPT 5, so nothing was changed\./);
    }
    assert.equal(posts(seen).length, 0, 'a switch to the model it is already set to was sent');
    assert.equal((await hostRun(port, ['agent', 'model', 'Sally Sales', 'o3', '--yes'])).code, 0, 'CONTROL: a listed model is sent');
    // Review 2: the menu folds dated snapshots, and the route takes any id the account runs, so a miss goes to the route.
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'gpt-5-2025-08-07', '--yes'])) assert.equal(r.code, 0, r.text);
    assert.deepEqual(posts(seen).map((s) => JSON.parse(s.body).model), ['o3', 'gpt-5-2025-08-07', 'gpt-5-2025-08-07']);
  }));

test('kosmos#8666 review 1: an empty Claude menu says the policy allows none, not the OpenAI sentence', () => withStub(
  { ok: true, provider: 'anthropic', kind: 'menu', set: 'claude-sonnet-5', models: [] }, CHANGED, async (port) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, /None of the models Kosmos offers for Sally Sales is allowed by your company's policy/);
      assert.doesNotMatch(r.text, /OpenAI/);
    }
  }));

test('kosmos#8666 review 2: a refused request (no ok in the answer) exits 1 as "could not say", never "cannot be changed"', () => withStub(
  { error: 'only the person on this computer can do that' }, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /Kosmos could not say what Sally Sales can switch to: only the person on this computer can do that\./);
      assert.doesNotMatch(r.text, /cannot be changed here/);
    }
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'opus55', '--yes'])) assert.equal(r.code, 1, r.text);
    assert.equal(posts(seen).length, 0);
  }));

test('kosmos#8666 review 2: both CLIs find the card for a name typed in another case', () => withStub(MENU, CHANGED, async (port) => {
  for (const r of await both(port, ['agent', 'model', 'sally sales'])) assert.match(r.text, /^ *Sally Sales \(sally-sales\)'s model: Claude Sonnet 5$/m, r.text);
}));

test('kosmos#8666 review 3: an agent the whole list does not name exits 1; a read that failed exits 1; a padded option is refused', async () => {
  await withStub(MUSE, CHANGED, async (port, seen) => {
    for (const argv of [['agent', 'model', 'Nobody'], ['agent', 'model', 'Nobody', 'opus55', '--yes']]) for (const r of await both(port, argv)) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /There is no agent called Nobody on this board\. kosmos agent list shows them all\./);
      assert.doesNotMatch(r.text, /cannot be changed here|just now/);
    }
    assert.equal(posts(seen).length, 0);
    // CONTROL: a listed agent whose model cannot be chosen is information, exit 0.
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) assert.equal(r.code, 0, r.text);
  });
  await withStub({ ok: false, readFailed: true, because: 'we could not read what it runs on just now' }, CHANGED, async (port, seen) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /Kosmos could not say what Sally Sales can switch to: we could not read what it runs on just now\./);
    }
    for (const argv of [['agent', 'model', ' --foo'], ['agent', 'model', 'Sally Sales', ' --opus ', '--yes']]) {
      for (const r of await both(port, argv)) assert.equal(r.code, 2, JSON.stringify(argv) + ': ' + r.text);
    }
    assert.equal(seen.length, RUNS, 'only the reads above (one per CLI) reached the board: ' + JSON.stringify(seen.map((s) => s.url)));
  });
});

test('kosmos#8666 review 4: control characters from the board or the typed word never reach the terminal', () => withStub(
  { ok: true, provider: 'anthropic', kind: 'menu', set: '', models: [{ key: 'k\u001b[31m', label: 'L\u001b]0;x\u0007', arg: 'a' }] }, CHANGED, async (port) => {
    for (const r of await both(port, ['agent', 'model', 'Sally Sales'])) {
      assert.equal(r.code, 0, r.text);
      assert.doesNotMatch(r.text, /[\u001b\u0007]/, 'a control character was printed');
    }
    for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'a\nb', '--yes'])) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /a b is not a model Sally Sales can switch to/);
    }
  }));

test('kosmos#8666 review 6: a name two agents answer to exits 1 on both paths; a resolved agent is named in the confirm', () => withStub(MENU, CHANGED, async (port, seen) => {
  for (const argv of [['agent', 'model', 'Twice'], ['agent', 'model', 'Twice', 'opus55', '--yes']]) {
    for (const r of await both(port, argv)) {
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, /Kosmos cannot tell which agent you mean: more than one agent is called Twice \(twice-a, shown as Twice; twice-b\); name it by one of those names\./);
    }
  }
  assert.equal(posts(seen).length, 0, 'an ambiguous name was switched');
  // Review 7: the typed word is one agent's own name (sal, shown as Sal Folder): the confirm names that agent by its
  // card AND its own name, so a person who meant another agent the list shows as "sal" can tell.
  for (const r of await both(port, ['agent', 'model', 'sal', 'opus55', '--yes'])) {
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Switching Sal Folder \(sal\) to Claude Opus 5\.5/);
  }
  // Typed in another case, it resolves to that agent's own name, and the confirm says which agent that is.
  const w = await winRun(port, ['agent', 'model', 'Sal', 'opus55'], { tty: true, answer: 'n' });
  assert.match(w.out + w.err, /Switching Sal Folder \(sal\) to Claude Opus 5\.5/);
  assert.match(w.asked.join(' '), /Switch Sal Folder \(sal\) to Claude Opus 5\.5\? \[y\/N\]/);
  assert.deepEqual(posts(seen).map((s) => s.url), ['/api/agent/sal/model', '/api/agent/sal/model']);
}));

test('kosmos#8666 review 7: no control character from any field the board sends reaches the terminal; a refused OpenAI pick gets the list', async () => {
  const esc = '\u001b]0;x\u0007';
  await withStub({ ok: true, provider: 'google', kind: 'free', set: 'g' + esc, vendorLabel: 'Gemini' }, [400, { outcome: 'refused', because: 'no' + esc }], async (port) => {
    for (const argv of [['agent', 'model', 'Sally Sales'], ['agent', 'model', 'Sally Sales', 'x', '--yes']]) {
      for (const r of await both(port, argv)) assert.doesNotMatch(r.text, /[\u001b\u0007]/, JSON.stringify(argv) + ' printed a control character');
    }
  });
  await withStub({ ok: true, provider: 'openai', kind: 'account', set: '', models: [{ key: 'o3', label: 'o3' }] },
    [400, { outcome: 'refused', because: 'gpt-9 is not a model this agent\'s account can run; pick one from the list' }], async (port) => {
      for (const r of await both(port, ['agent', 'model', 'Sally Sales', 'gpt-9', '--yes'])) {
        assert.equal(r.code, 1, r.text);
        assert.match(r.text, /pick one from the list\. Pick one of: o3 \(o3\)\./);
      }
    });
});
