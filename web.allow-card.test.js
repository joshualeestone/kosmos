'use strict';

/**
 * The Allow moment (#567): the card above the board and the list under Plus.
 * What these pin is the design's falsifiable part: the card starts hidden
 * and never asks about a device this Mac already allowed; the
 * change-your-password sentence lives only on the Deny branch (#3829: was Not me); Remove
 * confirms inline with the sentence the engine makes true; the poll for
 * what is waiting reads a file and never spawns; and the Plus tab carries
 * the needs-you dot in the nav's own grammar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const jsStart = SCRIPT.indexOf('/* ---- #567: the Allow moment');
const jsEnd = SCRIPT.indexOf('async function paintPlus(', jsStart);
const JS = SCRIPT.slice(jsStart, jsEnd);

test('the card exists once, starts hidden, and announces politely rather than stealing focus', () => {
  const cards = PAGE.match(/id="askcard"/g) || [];
  assert.equal(cards.length, 1);
  assert.match(PAGE, /<div class="askcard" id="askcard" role="status" aria-live="polite" hidden>/);
  assert.ok(jsStart > -1 && jsEnd > jsStart, 'the Allow block moved; re-anchor');
});

/* #3829 (Josh, 16:54, and his 17:19 shots: "the phone is showing the code" for a Windows browser; Mona Lisa's
   sketch): each request is one compact card. Its one sentence names the DEVICE, never assumes a phone, and it
   shows only kind, time and code. */
/* #4637 (Mona Lisa's design, replacing #3829's card): one approval card per request, the same in the sheet and inline.
   Who (from the name the device sends), when, the code once as large text, a gold Allow and a quiet "Not me". */
test('#4637 each request is one approval card: who, when, the code as text, Allow and Not me', () => {
  const at = JS.indexOf('function kpCard(');
  const card = JS.slice(at, JS.indexOf('\n}\n', at));
  assert.ok(at > -1 && card.length > 800, 'the approval card moved; re-anchor');
  assert.match(card, /Make sure ' \+ askEsc\(w\.who\) \+ ' is showing this code/);
  assert.doesNotMatch(JS, /The phone is showing the code|If that is the phone in your hand/, 'the card assumes a phone again (a Windows browser was told it was one)');
  assert.doesNotMatch(card, /device_id\)\s*\+\s*'<\/(b|span|p|div|h2)>/, 'the device id reaches readable text');
  assert.ok(!/>' \+ askEsc\(d\.device_id\)/.test(card), 'the device id is interpolated as text, which identifies the device beyond who, time and code');
  assert.doesNotMatch(card, /devCodeHtml/, 'the code is back in letter boxes, the developer screen #4637 replaced');
  // Positive control: the same card does carry who, the time and the code.
  assert.match(card, /askEsc\(w\.head\)/);
  assert.match(card, /askAgoSpan\(d\.first_seen\)/);   // #3978: the time is a span filled in place
  assert.match(card, /kpCode\(d\.code\)/);
  assert.match(card, /data-ask="allow"[^>]*>Allow<\/button>/);
  assert.match(card, /data-ask="deny"[^>]*>Not me<\/button>/);
});

test('#3829 an unnamed request is "Unknown device", never the bare noun', () => {
  assert.match(JS, /return d && typeof d\.name === 'string' && d\.name \? d\.name : 'Unknown device';/);
  /* #4610 (Josh's ruling 13:00): this Mac's own sign-in is granted by the board and never shown, so the page no
     longer relabels it and the board no longer sends its id (it picks the automatic grant, so it stays off the read
     routes). Replaces #3829's "This computer (Kosmos app)" pin. */
  assert.doesNotMatch(JS, /This computer \(Kosmos app\)/, 'the page still relabels a row it should never see');
  assert.doesNotMatch(SERVER, /self_device_id/, 'a read route still sends this Mac\'s own device id to the page');
});

test('the change-your-password sentence appears on the Deny branch and the re-ask line, never on the plain ask', () => {
  const at = JS.indexOf("const match = d.code");
  const plain = JS.slice(at, JS.indexOf(';\n', at));
  assert.ok(at > -1, 'the plain sentence moved; re-anchor');
  assert.doesNotMatch(plain, /password/, 'the plain ask carries the intruder sentence, which the wrong person reads every time');
  const d0 = JS.indexOf("e.state === 'denied'");
  // Comments stripped: a sentence ABOUT the password line is not the line.
  const branch = JS.slice(d0, JS.indexOf('Got it', d0)).replace(/\/\*[\s\S]*?\*\//g, '');
  const w = /const why = oldAsk \? '([^']*)'\s*:\s*'([^\n]*)/.exec(branch);
  assert.ok(w, 'the kept-out branch moved; re-anchor');
  assert.doesNotMatch(w[1], /password/, '#3829: keeping out an OLD request (likely the person\'s own) accuses someone');
  assert.match(w[2], /Change that email\u2019s password/, 'keeping out a fresh request lost the password sentence');
  assert.match(JS, /If it is not yours, change that email\u2019s password; that is what stops it/);
});

/* #3829: "Not now" is gone (Allow / keep out only). #4637 (Mona Lisa): keep-out reads "Not me", the person's own words,
   and an old request says its age ("Asked 3 hours ago") instead of fading. Requests show ONCE, as cards, not again in
   the devices list. */
test('Remove confirms inline with the sentence the tunnel makes true; Allow / Not me only, and requests show once', () => {
  assert.match(JS, /Remove this ' \+ askEsc\(name\) \+ '\? It stops right away\. It can ask again by signing in\./);
  assert.equal((JS.match(/data-ask="later"/g) || []).length, 0, 'a Not now dismiss is back');
  assert.doesNotMatch(JS, /devrow pending/, 'pending requests are painted in the devices list too');
  // Stronger than the class name: the devices list paints no Allow or Deny at all.
  const pd = JS.slice(JS.indexOf('async function paintDevices'), JS.indexOf("document.getElementById('plus-devlist').addEventListener"));
  assert.ok(pd.length > 200, 'paintDevices moved; re-anchor');
  assert.doesNotMatch(pd, /data-ask="(allow|deny)"/, 'the devices list offers Allow / Deny, so a request shows twice');
  assert.doesNotMatch(JS, /ASK\.later|getItem\('ask-later'\)/, 'the Not now session flag is read again, which could hide a request with no way back');
  assert.match(JS, /const old = d\.first_seen && \(Date\.now\(\) \/ 1000 - d\.first_seen\) > 60 \* 60;/);
  assert.match(JS, /const when = old \? 'Asked ' \+ askAgoSpan\(d\.first_seen\)/, 'an old request no longer says its age');
  // The sheet is the page's own dialog (#4637), opened only by Review; never the browser's.
  assert.doesNotMatch(JS, /confirm\(/, 'a browser confirm dialog crept in');
});

test('the poll for what is waiting reads a file and never spawns; the verbs shell to the tunnel', () => {
  const a = SERVER.indexOf("pathname === '/api/remote/pending'");
  const b = SERVER.indexOf("pathname === '/api/remote/devices'", a);
  assert.ok(a > -1 && b > a, 'the pending route moved; re-anchor');
  const route = SERVER.slice(a, b);
  assert.match(route, /pendingDevices\(\)/);
  assert.doesNotMatch(route, /devicesList|setupRun|spawn/, 'the five-second poll spawns a process');
  assert.match(JS, /setInterval\(pollAsk, 5000\)/);
});

test('the Plus tab carries the needs-you dot in the nav’s own grammar', () => {
  assert.match(PAGE, /data-go="plus" aria-controls="s-sec-plus"><span>Kosmos\+<\/span><span class="dot" aria-hidden="true"><\/span><span class="vh"> \(needs you\)<\/span>/);
  assert.match(JS, /#s-nav button\[data-go="plus"\]/);
});

test('no em dash in anything a person reads here', () => {
  const region = PAGE.slice(PAGE.indexOf('id="askcard"'), PAGE.indexOf('id="askcard"') + 400) + JS +
    PAGE.slice(PAGE.indexOf('id="plus-devices"'), PAGE.indexOf('id="plus-devmsg"'));
  assert.doesNotMatch(region, /—/);
});

test('#718: the Allow card has no solid coloured left bar (Josh, 2026-09-24), and thumb-size buttons on a touchscreen', () => {
  for (const sel of ['.kp-notice', '.kp-sheet', '.kp-inline']) {
    const m = PAGE.match(new RegExp(sel.replace('.', '\\.') + ' \\{[^}]*\\}'));
    assert.ok(m, 'the ' + sel + ' rule exists');
    assert.doesNotMatch(m[0], /border-left/, 'no left bar: ' + m[0]);
    // #4637: the whole Kosmos+ navy edge, never a bar.
    assert.match(m[0], /border: 1px solid #2a3f6b;/, 'the navy edge is the whole border on ' + sel);
  }
  // The rule is a one-line block: anchor on the whole of it, so the 44px cannot drift out of
  // the touchscreen query unnoticed.
  assert.match(PAGE, /@media \(hover: none\) \{ \.askcard button, \.kp-card button, \.plus-asks button \{ min-height: 44px; \} \}/, 'a touchscreen block gives the Allow buttons 44px');
});

test('#4637 a request the coordinator minted for a new computer draws a computer by its id, never by its name', () => {
  const page = require('./test-support/page');
  const lifted = page.liftConst(SCRIPT, 'KP_KINDS') + '\n' + page.liftAll(SCRIPT, ['askKind', 'kpWords', 'kpIcon']);
  const { kpWords, kpIcon } = new Function(lifted + '\nreturn { kpWords, kpIcon };')();
  const phone = kpIcon('phone');
  const computer = kpIcon('computer');
  assert.notEqual(phone, computer);
  const minted = { device_id: 'computer:8f2c', name: 'computer Phone room' };
  assert.equal(kpWords(minted).icon, 'computer');
  assert.equal(kpIcon(kpWords(minted).icon), computer, 'a Mac named "Phone room" drew a phone');
  assert.equal(kpWords(minted).head, 'computer Phone room', 'the name is still what the card says');
  // CONTROLS: the same name without the minted id is keyed on the name (so the id is what decided above), and a
  // real phone is still a phone.
  assert.equal(kpIcon(kpWords({ device_id: 'dev-1', name: 'computer Phone room' }).icon), phone);
  assert.equal(kpIcon(kpWords({ device_id: 'dev-2', name: 'iPhone' }).icon), phone);
});
