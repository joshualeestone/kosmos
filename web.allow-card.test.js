'use strict';

/**
 * The Allow moment (#567): the card above the board and the list under Plus.
 * What these pin is the design's falsifiable part: the card starts hidden
 * and never asks about a device this Mac already allowed; the
 * change-your-password sentence lives only on the Not-me branch; Remove
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

test('the pending sentence asks about the phone in your hand and names only kind, time and code', () => {
  assert.match(JS, /If that is the phone in your hand, allow it/);
  assert.match(JS, /The phone is showing the code/);
  /* The id reaches the markup only as a data attribute on a button, never
     as text a person reads: the readable paragraph is the slice before its
     closing tag, and the id must not be interpolated into it. */
  const para = JS.slice(JS.indexOf("'<div class=\"askrow\"><p>Someone signed in as"), JS.indexOf("</p>' +", JS.indexOf("'<div class=\"askrow\"><p>Someone signed in as")));
  assert.ok(para.length > 200, 'the pending paragraph moved; re-anchor');
  assert.doesNotMatch(para, /device_id/, 'the card shows the device id, which identifies the device beyond kind, time and code');
  /* Positive control: the same slice does carry the kind and the code. */
  assert.match(para, /askKind|kind/);
  assert.match(para, /d\.code/);
});

test('the change-your-password sentence appears on the Not-me branch and the re-ask line, never on the plain ask', () => {
  const plain = JS.slice(JS.indexOf("'<div class=\"askrow\"><p>Someone signed in as"), JS.indexOf("If that is the phone in your hand"));
  assert.doesNotMatch(plain, /password/, 'the plain ask carries the intruder sentence, which the wrong person reads every time');
  const denied = JS.slice(JS.indexOf("e.state === 'denied'"), JS.indexOf('Got it'));
  assert.match(denied, /change that email\\?'s password/);
  assert.match(JS, /has asked again\. If it is not yours, change that email\\?'s password; that is what stops it/);
});

test('Remove confirms inline with the sentence the tunnel makes true, and Not now is the only dismiss', () => {
  assert.match(JS, /Remove this ' \+ askEsc\(name\) \+ '\? It stops right away\. It can ask again by signing in\./);
  assert.equal((JS.match(/data-ask="later"/g) || []).length, 1);
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
  assert.match(PAGE, /data-go="plus" aria-controls="s-sec-plus"><span>Plus Account<\/span><span class="dot" aria-hidden="true"><\/span><span class="vh"> \(needs you\)<\/span>/);
  assert.match(JS, /#s-nav button\[data-go="plus"\]/);
});

test('no em dash in anything a person reads here', () => {
  const region = PAGE.slice(PAGE.indexOf('id="askcard"'), PAGE.indexOf('id="askcard"') + 400) + JS +
    PAGE.slice(PAGE.indexOf('id="plus-devices"'), PAGE.indexOf('id="plus-devmsg"'));
  assert.doesNotMatch(region, /—/);
});
