'use strict';
/**
 * kosmos#6464: every fetch a Windows sender makes to the board never follows a redirect. The board never redirects an
 * /api/ request, and fetch would otherwise carry the board and agent tokens (and the body) to wherever a listener
 * pointed it, past the proof that the listener holds the token (#1765, #6437).
 *
 * The senders say redirect: 'manual' (the 3xx comes back to them, unfollowed), never 'error': with 'error', undici's
 * own one retry of a 421 (the board serving another Kosmos, #1704) fails on a request with a body, so the wrong-world
 * answer arrives as a network error. Measured on node 24 while writing this; the 421 arm below holds it. The proof
 * itself (engine/boardproof.js, a GET with no body) keeps 'error'.
 *
 * Two halves:
 *   - a SOURCE guard over every sender that ships in the Windows bundle (the report hook, the kosmos command, the
 *     board opener, the proof itself, and every bin/*-report-bridge.js): each fetch call names redirect: 'manual'
 *     (the proof: 'error'), except the opener's wait for the board, which carries no token. A call added later
 *     without it goes red here.
 *   - a REAL redirect, here through the gemini and grok bridges (their main takes its env and input), and for the
 *     hook, the kosmos command and the opener in engine/kosmos-report-hook.board-proof-1765.test.js,
 *     tools.windows-kosmos-cli-board-proof-1765.test.js and tools.win-open-board-2007.test.js. The codex and agy
 *     bridges' entries read the process's own env and stdin, so they are held by the source guard alone.
 *
 *   node --test tools.board-redirects-6464.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = __dirname;
const BRIDGES = fs.readdirSync(path.join(REPO, 'bin')).filter((f) => /-report-bridge\.js$/.test(f)).map((f) => 'bin/' + f);
const SENDERS = ['engine/kosmos-report-hook.js', 'tools/windows/kosmos-cli.js', 'tools/kosmos-open-board.js', 'engine/boardproof.js', ...BRIDGES];
// The one fetch that may follow a redirect: the opener's wait for the board to answer at all (GET /, no token).
const NO_TOKEN = { 'tools/kosmos-open-board.js': [/^\(url \+ '\/', \{ method: 'GET', signal: AbortSignal\.timeout\(PROBE_TIMEOUT_MS\) \}\)$/] };

/* Every call of fetch( or doFetch( in `text` (not a property call such as x.fetch(, not a definition), with its
   whole argument list, found by matching the parentheses. Strings and template literals are skipped over, so a
   paren inside one does not end the call early. */
/* `text` with its comments blanked to spaces (newlines kept, so line numbers hold), strings and template literals left
   alone, so "fetch(" in a comment is not a call and "http://" in a string is not a comment. A regex literal is not
   recognised; none of the senders has one holding a quote or a comment marker before a fetch call. */
function withoutComments(text) {
  let out = '', quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quote) { out += c; if (c === '\\') { out += n || ''; i++; } else if (c === quote) quote = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } out += text[i] || ''; continue; }
    if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue; }
    out += c;
  }
  return out;
}

function fetchCalls(source) {
  const text = withoutComments(source);
  const calls = [];
  // fetch itself, and every name the file binds to something that mentions fetch (const doFetch = o.fetchImpl ||
  // fetch, and any other alias a later sender picks), so a call through an alias is held to the rule too.
  const names = new Set(['fetch', 'doFetch']);   // doFetch: also a parameter name (boardproof.js holdsViaFetch)
  for (const b of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\bfetch(?:Impl)?\b/g)) names.add(b[1]);
  const re = new RegExp('(^|[^\\w$.])(' + [...names].map((n) => n.replace(/\$/g, '\\$')).join('|') + ')\\s*\\(', 'g');
  let m;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, i = open, quote = null;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
      if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    const before = text.slice(Math.max(0, m.index - 12), m.index + m[1].length);
    if (/function\s*$/.test(before)) continue;
    calls.push({ at: text.slice(0, m.index).split('\n').length, args: text.slice(open, i + 1) });
  }
  return calls;
}

test('kosmos#6464: the guard reads what it claims to (every bridge, and the fetch calls in each sender)', () => {
  assert.ok(BRIDGES.length >= 4, 'fewer report bridges than the Windows build ships: ' + BRIDGES.join(', '));
  for (const f of SENDERS) assert.ok(fetchCalls(fs.readFileSync(path.join(REPO, f), 'utf8')).length > 0, f + ': no fetch call found, so the guard measures nothing there');
  // The matcher itself: a call over several lines, a paren inside a string, a property call and a definition.
  assert.deepEqual(fetchCalls("await fetch(`http://x${p}/api/report`, {\n  method: 'POST', body: '(', redirect: 'error',\n});").map((c) => /redirect: 'error'/.test(c.args)), [true]);
  assert.equal(fetchCalls('o.fetch(u); function fetch(u) {}').length, 0);
  // A call through an alias bound to fetch is a call too.
  assert.deepEqual(fetchCalls("const send = o.fetchImpl || fetch;\nawait send(u, { method: 'POST' });").map((c) => c.args), ["(u, { method: 'POST' })"]);
});

test('kosmos#6464: every token-bearing fetch in a Windows sender refuses redirects', () => {
  const missing = [];
  for (const f of SENDERS) {
    for (const c of fetchCalls(fs.readFileSync(path.join(REPO, f), 'utf8'))) {
      if ((f === 'engine/boardproof.js' ? /redirect:\s*'error'/ : /redirect:\s*'manual'/).test(c.args)) continue;
      if ((NO_TOKEN[f] || []).some((re) => re.test(c.args))) continue;
      missing.push(f + ':' + c.at + ' ' + c.args.replace(/\s+/g, ' ').slice(0, 120));
    }
  }
  assert.deepEqual(missing, [], 'these fetch calls would follow a redirect with the tokens');
});

/* A real redirect, through the gemini and grok bridges (both ship in the Windows bundle and run per turn there,
   engine/win32keyed.js): a listener that proves it holds the board token, then answers the report with a 307 to a
   second real listener. The second gets nothing; the first got the report it redirected. */
const http = require('node:http');
const { startListener, answerProof } = require('./test-support/proof-listener-1765');
const BOARD = 'BOARDTOKEN_redirect_6464_' + 'a'.repeat(24);
const AGENT = 'ef'.repeat(16);
for (const [name, working] of [['gemini', 'BeforeAgent'], ['grok', 'UserPromptSubmit']]) {
  test('kosmos#6464: the ' + name + ' bridge does not follow a proven board\'s redirect with its tokens', async () => {
    const bridge = require('./bin/' + name + '-report-bridge.js');
    const elsewhere = await startListener({ mode: 'squatter' });
    const redirected = [];
    const server = http.createServer((req, res) => {
      if (answerProof(req, res, [BOARD])) return;
      redirected.push(req.method + ' ' + req.url);
      res.writeHead(307, { location: elsewhere.url + req.url });   // 307 keeps the method and body if followed
      res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      await bridge.main({
        input: JSON.stringify({ hook_event_name: working }),
        env: { KOSMOS_PORT: String(server.address().port), KOSMOS_AGENT_TOKEN: AGENT },
        readBoardToken: () => BOARD,
      });
      assert.deepEqual(redirected, ['POST /api/report'], 'the report never reached the board, so this arm measures nothing');
      assert.deepEqual(elsewhere.seen.map((x) => x.method + ' ' + x.url), [], 'the report followed the redirect');
    } finally { server.closeAllConnections(); server.close(); await elsewhere.close(); }
  });
}

/* The reason the senders say 'manual' and not 'error': the board answers a request from another Kosmos's agent with
   421 (#1704), and undici retries a 421 once on a fresh connection. With 'error' that retry fails on a request with a
   body and the 421 never arrives. A real 421 listener, through the hook's report (the CLI's 421 is held by tools.windows-kosmos-cli-outbox-1704.test.js). */
function startWrongWorld() {
  const server = http.createServer((req, res) => {
    if (answerProof(req, res, [BOARD])) return;
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      res.writeHead(421, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ wrongWorld: true, serving: 'default', because: 'another Kosmos' }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

test('kosmos#6464: a 421 from a board serving another Kosmos still arrives as a 421 through the hook (redirect: manual)', async () => {
  const server = await startWrongWorld();
  try {
    const hook = require('./engine/kosmos-report-hook');
    const r = await hook.deliver({ state: 'working', text: 'x' }, { url: 'http://127.0.0.1:' + server.address().port, boardToken: BOARD, agentToken: AGENT });
    assert.equal(r.error, undefined, 'the send failed instead of reading the board\'s answer: ' + r.error);
    assert.equal(r.status, 421);
    assert.equal(r.wrongWorld, true);
  } finally { server.closeAllConnections(); server.close(); }
});
