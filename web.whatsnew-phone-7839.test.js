'use strict';
/* kosmos#7839 (Josh, iPhone build 29): the "Kosmos has been updated" window is about the Mac or Linux app, so a phone
   never shows it, and records nothing there, so the computer's own window still shows it. The functions are lifted
   from the page, so the test cannot drift from what ships. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const MQ = SCRIPT.match(/\nconst PNAV_PHONE_MQ = [^\n]*\n/);
const H1 = [{ icon: 'spark', title: 'A thing', line: 'It does a thing.' }];

// The page as each viewer sees it: its <html> classes, and whether the phone media query matches.
async function load({ classes = [], phoneWidth = false, host = '127.0.0.1' } = {}) {
  const posts = [], opened = [], reads = [];
  const fetchStub = async (url, opts) => {
    if (opts && opts.method === 'POST') { posts.push(url); return { ok: true, text: async () => '' }; }
    reads.push(url);
    return { ok: true, json: async () => ({ current: '0.7.85', seen: '0.7.84', highlights: H1 }) };
  };
  const document = { documentElement: { classList: { contains: (c) => classes.includes(c) } }, querySelector: () => null };
  const window = { matchMedia: () => ({ matches: phoneWidth }) };
  const location = { hostname: host };
  const run = new Function('fetch', 'bakedVersion', 'wnOpen', 'document', 'window', 'location',
    MQ[0] + page.liftAll(SCRIPT, ['kplusRemote', 'wnNewer', 'wnOnPhone', 'whatsNewCheck']) + '\nreturn whatsNewCheck();');
  await run(fetchStub, () => '0.7.85', (v) => opened.push(v), document, window, location);
  await new Promise((r) => setImmediate(r));
  return { posts, opened, reads };
}

test('#7839: CONTROL: the board on the computer shows the window and records it', async () => {
  assert.ok(MQ, 'CONTROL: PNAV_PHONE_MQ was not found in the page');
  const r = await load();
  assert.deepEqual(r.opened, ['0.7.85']);
  assert.deepEqual(r.posts, ['/api/whats-new/seen']);
});

test('#7839: inside the iPhone app (html.kapptabs, every page it loads) no window, nothing recorded, nothing read', async () => {
  for (const phoneWidth of [true, false]) {   // the app marks the page whatever its width (an iPad, a rotated phone)
    const r = await load({ classes: ['kapptabs'], phoneWidth });   // at load the app's mark is all there is
    assert.deepEqual(r.opened, [], 'the desktop update window showed inside the phone app');
    assert.deepEqual(r.posts, [], 'the phone recorded the version as seen, so the computer would never show it');
    assert.deepEqual(r.reads, [], 'the phone still asked for What\'s New');
  }
});

test('#7839: a Kosmos+ address at phone width (the Android app, a phone browser) shows nothing, with no class set yet', async () => {
  // No html class at all: at load, kplusBar has not added kremote yet; the address is what the page knows.
  const phone = await load({ host: 'sample.kosmosplus.com', phoneWidth: true });
  assert.deepEqual([phone.opened, phone.posts], [[], []], 'a phone over Kosmos+ got the desktop window');
  const desk = await load({ host: 'sample.kosmosplus.com', phoneWidth: false });
  assert.deepEqual(desk.opened, ['0.7.85'], 'CONTROL: a Kosmos+ session in a desktop browser still shows it');
  const local = await load({ host: '127.0.0.1', phoneWidth: true });
  assert.deepEqual(local.opened, ['0.7.85'], 'CONTROL: a narrow window on the computer itself still shows it');
});

test('#7839: the iPhone app still marks every page it loads with kapptabs (the signal this depends on)', () => {
  const swift = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ShellLogic.swift'), 'utf8');
  assert.match(swift, /document\.documentElement\.classList\.add\('kapptabs'\)/);
  const view = fs.readFileSync(path.join(__dirname, 'ios', 'Kosmos', 'ContentView.swift'), 'utf8');
  assert.match(view, /AppTabs\.markScript, injectionTime: \.atDocumentStart, forMainFrameOnly: true/);
});
