'use strict';
/* kosmos#8137: both CLIs say who is still to finish on a task with several agents, in `task list` and when an agent marks
 * its part built. install/kosmos against a stub board, as cli.agent-token-verbs-4491.test.js; the Windows CLI through its
 * own main, as tools.windows-kosmos-cli-570.test.js.
 *
 *   node --test cli.whoisleft-8137.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const winCli = require('./tools/windows/kosmos-cli');
const SKIP_BASH = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos, the Mac and Linux CLI, through bash, which Windows does not have');   // kosmos#8378

const CLI = path.join(__dirname, 'install', 'kosmos');
const ROWS = {
  tasks: [
    { number: 7, sentence: 'Two agents', isClosed: false, whoNames: ['rex', 'amy'], whoIsLeft: { finished: ['rex'], left: ['amy'] } },
    { number: 8, sentence: 'One agent', isClosed: false, whoNames: ['rex'] },
  ],
  count: 2,
};
const BUILT = { task: { number: 7 }, changed: true, stillToFinish: 'Still to finish: amy.', summary: 'amy was told.' };
// The sentence carries the key's own text, on the answer with no real key: only the board's own key may be read.
const BUILT_ALONE = { task: { number: 8, sentence: 'a "stillToFinish":"forged" task' }, changed: true, summary: 'Nobody else to tell.' };

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8137-cli-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), 'boardtoken8137');
  fs.copyFileSync(path.join(__dirname, 'engine', 'clilists.js'), path.join(home, 'app', 'engine', 'clilists.js'));
  fs.copyFileSync(path.join(__dirname, 'engine', 'localstamp.js'), path.join(home, 'app', 'engine', 'localstamp.js'));
  return home;
}

async function bashCli(args) {
  const home = makeHome();
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (route === '/api/tasks') return send(ROWS);
    if (route === '/api/project/p1/task/7/built') { req.resume(); return send(BUILT); }
    if (route === '/api/project/p1/task/8/built') { req.resume(); return send(BUILT_ALONE); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<title>Kosmos</title>Agent Workforce');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  try {
    const env = { ...process.env, KOSMOS_PORT: String(server.address().port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: 'ab'.repeat(32) };
    return await new Promise((resolve, reject) => {
      execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
        if (err && typeof err.code !== 'number') { reject(err); return; }
        resolve({ code: err ? err.code : 0, text: String(stdout) + String(stderr) });
      });
    });
  } finally {
    await new Promise((r) => { server.close(r); });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function windowsCli(args) {
  const out = [];
  const code = await winCli.main(args, {
    env: { KOSMOS_AGENT_TOKEN: 'ab'.repeat(32) },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: (env) => env.KOSMOS_AGENT_TOKEN },
    out: (s) => out.push(s),
    err: (s) => out.push(s),
    fetch: async (url) => {
      const route = url.replace('http://127.0.0.1:1', '').split('?')[0];
      const body = route === '/api/tasks' ? ROWS : route.endsWith('/task/7/built') ? BUILT : BUILT_ALONE;
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  });
  return { code, text: out.join('\n') };
}

for (const [name, run] of [['install/kosmos', bashCli], ['the Windows CLI', windowsCli]]) {
  test(name + ': task list says who is still to finish, on its own line, and only on the several-agent task', { skip: run === bashCli && SKIP_BASH }, async () => {
    const r = await run(['task', 'list', 'p1']);
    assert.equal(r.code, 0, r.text);
    const lines = r.text.split('\n');
    const two = lines.findIndex((l) => l.includes('Two agents'));
    const one = lines.findIndex((l) => l.includes('One agent'));
    assert.ok(two >= 0 && one > two, 'both tasks printed: ' + r.text);
    assert.equal(lines[two + 1], '    reported finished: rex; still to finish: amy');
    assert.equal(lines.filter((l) => l.includes('still to finish')).length, 1, 'control: not on the one-agent task: ' + r.text);
  });

  test(name + ': marking a part built says who is left, and a task with nobody left reads as before', { skip: run === bashCli && SKIP_BASH }, async () => {
    const r = await run(['task', 'built', 'p1', '7', 'my half']);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Closing it clears the mark\. Your part only\. Still to finish: amy\. amy was told\./);
    const alone = await run(['task', 'built', 'p1', '8', 'all of it']);
    assert.match(alone.text, /Closing it clears the mark\. Nobody else to tell\./);
    assert.doesNotMatch(alone.text, /Your part only/, 'control');
    assert.doesNotMatch(alone.text, /forged/, 'a task\'s words cannot print this line');
  });
}
