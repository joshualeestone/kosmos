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
test('#3829 each request is a compact card: kind, when, the code, one device-neutral sentence', () => {
  const at = JS.indexOf("'<div class=\"askreq'");
  const card = JS.slice(at, JS.indexOf("</div></div>';", at));
  assert.ok(at > -1 && card.length > 200, 'the request card moved; re-anchor');
  assert.match(JS, /Allow only if this code is showing on the device in your hand\./);
  assert.doesNotMatch(JS, /The phone is showing the code|If that is the phone in your hand/, 'the card assumes a phone again (a Windows browser was told it was one)');
  assert.doesNotMatch(card, /device_id\)\s*\+\s*'<\/(b|span|p|div)>/, 'the device id reaches readable text');
  assert.ok(!/>' \+ askEsc\(d\.device_id\)/.test(card), 'the device id is interpolated as text, which identifies the device beyond kind, time and code');
  // Positive control: the same card does carry the kind, the time and the code.
  assert.match(card, /askEsc\(kind\)/);
  assert.match(card, /askAgo\(d\.first_seen\)/);
  assert.match(card, /askEsc\(d\.code\)/);
  assert.match(card, /data-ask="allow"[^>]*>Allow<\/button>/);
  assert.match(card, /data-ask="deny"[^>]*>Deny<\/button>/);
});

test('#3829 an unnamed request is "Unknown device", never the bare noun', () => {
  assert.match(JS, /return d && typeof d\.name === 'string' && d\.name \? d\.name : 'Unknown device';/);
  // ICK's finding: this Mac's own in-app sign-in (no name) is "This Mac (Kosmos app)", matched by its own device id.
  assert.match(JS, /if \(d && ASK\.self && d\.device_id === ASK\.self\) return 'This Mac \(Kosmos app\)';/);
  assert.match(SERVER, /self_device_id: self/, 'the devices route no longer names this Mac\'s own id');
});

test('the change-your-password sentence appears on the Deny branch and the re-ask line, never on the plain ask', () => {
  const at = JS.indexOf("const say = d.code ?");
  const plain = JS.slice(at, JS.indexOf('\n', at));
  assert.ok(at > -1, 'the plain sentence moved; re-anchor');
  assert.doesNotMatch(plain, /password/, 'the plain ask carries the intruder sentence, which the wrong person reads every time');
  const d0 = JS.indexOf("e.state === 'denied'");
  // Comments stripped: a sentence ABOUT the password line is not the line.
  const oldBranch = JS.slice(d0, JS.indexOf('Got it', d0)).replace(/\/\*[\s\S]*?\*\//g, '');
  const freshBranch = JS.slice(JS.indexOf('Got it', d0) + 1, JS.indexOf('Got it', JS.indexOf('Got it', d0) + 1));
  assert.match(oldBranch, /if \(oldAsk\)/, 'the old-request Deny branch moved; re-anchor');
  assert.doesNotMatch(oldBranch, /password/, '#3829: denying an OLD request (likely the person\'s own) accuses someone');
  assert.match(freshBranch, /change that email\\?'s password/, 'a fresh Deny lost the password sentence');
  assert.match(JS, /has asked again\. If it is not yours, change that email\\?'s password; that is what stops it/);
});

/* #3829: "Not now" and "Not me" are gone (Mona Lisa's review: Allow / Deny only); a request that is left
   alone fades after an hour instead. Requests show ONCE, as cards, not again in the devices list. */
test('Remove confirms inline with the sentence the tunnel makes true; Allow / Deny only, and requests show once', () => {
  assert.match(JS, /Remove this ' \+ askEsc\(name\) \+ '\? It stops right away\. It can ask again by signing in\./);
  assert.equal((JS.match(/data-ask="later"/g) || []).length, 0, 'a Not now dismiss is back');
  assert.doesNotMatch(JS, />Not me</, 'a Not me button is back');
  assert.doesNotMatch(JS, /devrow pending/, 'pending requests are painted in the devices list too');
  // Stronger than the class name: the devices list paints no Allow or Deny at all.
  const pd = JS.slice(JS.indexOf('async function paintDevices'), JS.indexOf("document.getElementById('plus-devlist').addEventListener"));
  assert.ok(pd.length > 200, 'paintDevices moved; re-anchor');
  assert.doesNotMatch(pd, /data-ask="(allow|deny)"/, 'the devices list offers Allow / Deny, so a request shows twice');
  assert.doesNotMatch(JS, /ASK\.later|getItem\('ask-later'\)/, 'the Not now session flag is read again, which could hide a request with no way back');
  assert.match(JS, /const stale = d\.first_seen && \(Date\.now\(\) \/ 1000 - d\.first_seen\) > 60 \* 60;/);
  assert.doesNotMatch(JS, /confirm\(/, 'a browser confirm dialog crept in; the design has no modal');
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
  assert.match(PAGE, /data-go="plus" aria-controls="s-sec-plus"><span>Kosmos Plus<\/span><span class="dot" aria-hidden="true"><\/span><span class="vh"> \(needs you\)<\/span>/);
  assert.match(JS, /#s-nav button\[data-go="plus"\]/);
});

test('no em dash in anything a person reads here', () => {
  const region = PAGE.slice(PAGE.indexOf('id="askcard"'), PAGE.indexOf('id="askcard"') + 400) + JS +
    PAGE.slice(PAGE.indexOf('id="plus-devices"'), PAGE.indexOf('id="plus-devmsg"'));
  assert.doesNotMatch(region, /—/);
});

test('#718: the Allow card has no solid coloured left bar (Josh, 2026-09-24), and thumb-size buttons on a touchscreen', () => {
  const m = PAGE.match(/\.askcard \{[^}]*\}/);
  assert.ok(m, 'the .askcard rule exists');
  assert.doesNotMatch(m[0], /border-left/, 'no left bar: ' + m[0]);
  // #3829: Kosmos+ blue, not gold (the 09-16 ruling); still the whole border, never a bar.
  assert.match(m[0], /border: 1px solid #3a68d8;/, 'the blue edge is the whole border');
  // The rule is a one-line block: anchor on the whole of it, so the 44px cannot drift out of
  // the touchscreen query unnoticed.
  assert.match(PAGE, /@media \(hover: none\) \{ \.askcard button \{ min-height: 44px; \} \}/, 'a touchscreen block gives the Allow buttons 44px');
});
