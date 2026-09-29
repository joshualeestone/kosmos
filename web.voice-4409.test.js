'use strict';
/**
 * #4409: voice in Kosmos. Talk to an agent (a mic in each composer, the Mac app's ON-DEVICE recognizer)
 * and hear an agent (read aloud, the page's on-device voices).
 *
 * The pure helpers are EXECUTED (lifted out of the page, the way web.quoteb.test.js runs page code),
 * because a grep for a function name proves nothing about what it does with an input. What cannot run
 * here (a WKWebView bridge, a microphone, a signature) is read from source, and each read names the
 * silent failure it guards: the native half's decisions run as rows in --kosmos-app-voice-selftest at
 * bundle build.
 *
 *   node --test web.voice-4409.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SWIFT = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');
const ENTS = fs.readFileSync(path.join(__dirname, 'native-app', 'kosmos-app.entitlements'), 'utf8');

function fn(name) {
  const at = PAGE.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, name + ' is gone from the page');
  const end = PAGE.indexOf('\n}\n', at);
  return PAGE.slice(at + 1, end + 2);
}
// eslint-disable-next-line no-new-func
const lifted = new Function(fn('voiceSplice') + fn('speechTidy') + fn('speechChunks')
  + 'return { voiceSplice, speechTidy, speechChunks };')();

test('#4409: the instrument is reading the real files', () => {
  assert.ok(PAGE.length > 1000000, 'index.html read back only ' + PAGE.length + ' bytes');
  assert.ok(SWIFT.length > 40000, 'main.swift read back only ' + SWIFT.length + ' bytes');
});

test('#4409: heard words land at the caret, spaced from their neighbours, and never past the box\'s cap', () => {
  const { voiceSplice } = lifted;
  assert.deepEqual(voiceSplice('', 'hello there', '', 0), { text: 'hello there', caret: 11 });
  assert.deepEqual(voiceSplice('Hi', 'there', '', 0), { text: 'Hi there', caret: 8 }, 'glued to the word before it');
  assert.deepEqual(voiceSplice('Hi ', 'there', 'now', 0), { text: 'Hi there now', caret: 8 }, 'glued to the word after it');
  assert.deepEqual(voiceSplice('a\n', 'b', '\nc', 0), { text: 'a\nb\nc', caret: 3 }, 'an existing line break is a space');
  assert.deepEqual(voiceSplice('keep', '   ', ' this', 0), { text: 'keep this', caret: 4 }, 'nothing heard leaves the box as it was');
  assert.deepEqual(voiceSplice('abc', 'long text', '', 6), { text: 'abc lo', caret: 6 }, 'the 10,000 cap is a property of the box, and dictation does not get around it');
  // Review 7: at the cap the HEARD words give way, never the person's text after the caret.
  assert.deepEqual(voiceSplice('ab', 'hello', 'XYZ', 8), { text: 'ab h XYZ', caret: 4 }, 'the person\'s text after the caret was cut to fit the heard words');
  assert.deepEqual(voiceSplice('abcd', 'hello', 'XYZ', 8), { text: 'abcdXYZ', caret: 4 }, 'with no room the box changed');
  assert.deepEqual(voiceSplice('ab', 'hi', 'XYZ', 100), { text: 'ab hi XYZ', caret: 5 }, 'control: under the cap nothing is trimmed');
});

test('#4409: a message is read as words: code announced, links named, markdown marks silent', () => {
  const { speechTidy } = lifted;
  assert.equal(speechTidy('Run this:\n```sh\nrm -rf build\n```\nthen check.'), 'Run this: Code block. then check.');
  assert.equal(speechTidy('Open ```unclosed code to the end'), 'Open Code block.', 'an unclosed fence still is not spelled out');
  assert.equal(speechTidy('See [the card](https://github.com/x/y/issues/1).'), 'See the card.');
  assert.equal(speechTidy('It is at https://github.com/x/y.'), 'It is at link.', 'the sentence keeps its full stop');
  assert.equal(speechTidy('## Plan\n**Bold** and `npm test`\n- one\n1. two\n> quoted'), 'Plan Bold and npm test one two quoted');
  assert.equal(speechTidy(''), '');
});

test('#4409: long text is spoken in pieces at sentence ends, none over the cap, nothing lost', () => {
  const { speechChunks } = lifted;
  const long = 'One. Two! ' + 'word '.repeat(90) + 'end.';
  const parts = speechChunks(long, 100);
  assert.ok(parts.length > 3, 'a long message went as one utterance');
  for (const p of parts) assert.ok(p.length <= 100, 'a piece over the cap: ' + p.length);
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '), 'words were dropped or reordered');
  assert.deepEqual(speechChunks('Short. Also short.', 220), ['Short. Also short.']);
  assert.deepEqual(speechChunks('', 220), []);
});

test('#4409: the mic is drawn only where the on-device bridge exists; a browser never gets a network recognizer', () => {
  assert.equal((PAGE.match(/class="micbtn"/g) || []).length, 3, 'the DM, the room and the Guide each have one mic');
  for (const [id, box] of [['d-mic', 'd-say'], ['pj-mic', 'pj-post'], ['asp-mic', 'asp-say']]) {
    assert.match(PAGE, new RegExp('id="' + id + '" type="button" data-voice-for="' + box + '"'), id + ' does not point at its own box');
  }
  assert.match(PAGE, /\.micbtn \{ display: none;/, 'the mic is drawn by default, in a browser with no bridge');
  assert.match(PAGE, /html\.has-voice \.micbtn \{ display: grid; \}/);
  assert.match(PAGE, /try \{ if \(voiceBridge\(\)\) document\.documentElement\.classList\.add\('has-voice'\);/);
  assert.match(fn('voiceBridge'), /window\.webkit\.messageHandlers\.kosmosVoice/);
  // 🛑 USE, not mention: no page code constructs the browser recognizer (Chrome's sends audio to Google).
  assert.doesNotMatch(PAGE, /new\s+\(?\s*(window\.)?(webkit)?SpeechRecognition\b/i, 'the page builds a browser recognizer');
  assert.doesNotMatch(PAGE, /=\s*(window\.)?(webkitSpeechRecognition|SpeechRecognition)\b/, 'the page reaches for a browser recognizer');
});

test('#4409: sending, typing or leaving while listening drops anything still coming', () => {
  assert.match(PAGE, /closest\('#d-send, #pj-post-go, #asp-send'\)\) voiceCancel\(\);/, 'a word heard after Send would land in the emptied box');
  const cancel = fn('voiceCancel');
  assert.match(cancel, /VOICE\.btn = null; VOICE\.box = null;/, 'late events are not cut off at once');
  assert.match(cancel, /postMessage\(\{ op: 'cancel' \}\)/);
  assert.match(PAGE, /if \(!ev \|\| !VOICE\.btn\) return;   \/\/ a late word after a cancel goes nowhere/);
  assert.match(PAGE, /voiceCancel\(\);   \/\/ typing \(or Enter to send\) takes the box back/);
  // hashchange covers a hand-typed address only; opening another agent fires no event (history.replaceState), so the
  // guard that matters is the view check below, which the next test EXECUTES.
  assert.match(PAGE, /window\.addEventListener\('hashchange', \(\) => voiceCancel\(\)\);/);
});

/* The page's own functions, run against stubs: the view check in voiceOnEvent is what keeps one agent's words out of
   the next agent's box, so it is driven, not grepped. */
/* One statement of the page's, by its opening words, so the harness runs on the page's own state shapes. */
function pageLine(head) {
  const at = PAGE.indexOf('\n' + head);
  assert.notEqual(at, -1, head + ' is gone from the page');
  return PAGE.slice(at + 1, PAGE.indexOf(';', at) + 1);
}
function voiceHarness() {
  const posted = [];
  const mkBtn = () => ({ attrs: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; }, title: '' });
  const mkBox = (id) => ({ id, value: '', maxLength: 0, isConnected: true, shown: true, focused: 0, focus() { this.focused += 1; }, getClientRects() { return this.shown ? [1] : []; }, setSelectionRange() {}, dispatchEvent() {} });
  // eslint-disable-next-line no-new-func
  const timers = [];
  const make = new Function('window', 'document', 'posted', 'setInterval', 'clearInterval',
    'let CURRENT = null; let PJ_CURRENT = null; const VOICE_SAYS = {};\n'
    + ['const VOICE = {', 'const SPEAK = {', 'let VOICE_WATCH =', 'const VOICE_LISTENING ='].map(pageLine).join('\n') + '\n'   // the page's own state, not a copy
    + ['viewKey', 'shownNow', 'voiceWhere', 'voiceBridge', 'voiceSplice', 'voicePaint', 'voiceSay', 'voiceMsgEl', 'voiceMsgEmpty', 'voiceUnsayOwn', 'voiceUnsay', 'voiceToggle', 'voiceCancel', 'voiceOnEvent', 'voiceSpeakWatch', 'speakStop', 'speakPaint', 'speakSameText', 'speakFollow', 'speechTidy', 'speechTextOfRow'].map(fn).join('\n')
    + '\nreturn { VOICE, SPEAK, voiceWhere, voiceToggle, voiceOnEvent, speakFollow, viewKey, watching() { return VOICE_WATCH; }, set(agent, room) { CURRENT = agent ? { sessionName: agent } : null; PJ_CURRENT = room; } };');
  const win = { webkit: { messageHandlers: { kosmosVoice: { postMessage(m) { posted.push(m); } } } }, speechSynthesis: { cancel() {} } };
  const doc = { hidden: false, boxes: {}, getElementById(id) { return this.boxes[id] || null; }, querySelectorAll: () => [] };
  const h = make(win, doc, posted, (f) => { timers.push(f); return timers.length; }, (n) => { timers[n - 1] = null; });
  const tick = () => timers.forEach((f) => f && f());
  return { h, posted, mkBtn, mkBox, doc, tick, timers };
}

test('#4409 review 1: a word heard after switching to another agent goes nowhere and stops the mic', () => {
  const { h, posted, mkBtn, mkBox } = voiceHarness();
  const box = mkBox('d-say');
  h.set('april', null);
  box.value = 'Please check';
  Object.assign(h.VOICE, { btn: mkBtn(), box, before: 'Please check', after: '', where: h.voiceWhere(box), last: 'Please check' });
  h.voiceOnEvent({ kind: 'partial', text: 'the build' });
  assert.equal(box.value, 'Please check the build', 'control: the same agent gets the words');
  /* Opened Casey: no hashchange, the same #d-say box. The box value is left EXACTLY as dictation left it, so the
     review-6 "box changed" guard cannot be what stops this: only the view check can. */
  h.set('casey', null);
  h.voiceOnEvent({ kind: 'final', text: 'the build now' });
  assert.equal(box.value, 'Please check the build', 'April\'s words kept landing after the switch to Casey');
  assert.equal(h.VOICE.btn, null, 'still listening after the switch');
  assert.deepEqual(posted.at(-1), { op: 'cancel' }, 'the mic was not told to stop');
});

test('#4409 review 1: closing the Guide (its box hidden) or a hidden page also stops the words', () => {
  const { h, mkBtn, mkBox, doc } = voiceHarness();
  const box = mkBox('asp-say');
  Object.assign(h.VOICE, { btn: mkBtn(), box, before: '', after: '', where: h.voiceWhere(box) });
  box.shown = false;
  h.voiceOnEvent({ kind: 'partial', text: 'hello' });
  assert.equal(box.value, '', 'words landed in a closed Guide');
  const box2 = mkBox('d-say');
  Object.assign(h.VOICE, { btn: mkBtn(), box: box2, before: '', after: '', where: h.voiceWhere(box2) });
  doc.hidden = true;
  h.voiceOnEvent({ kind: 'partial', text: 'hello' });
  assert.equal(box2.value, '', 'words landed while the window was hidden');
});

test('#4409 review 2: moving from one mic to another, the old session\'s late "stopped" does not end the new one', () => {
  const { h, posted, mkBtn, mkBox, doc } = voiceHarness();
  doc.boxes['d-say'] = mkBox('d-say'); doc.boxes['asp-say'] = mkBox('asp-say');
  const dm = mkBtn(); dm.attrs['data-voice-for'] = 'd-say';
  const guide = mkBtn(); guide.attrs['data-voice-for'] = 'asp-say';
  h.voiceToggle(dm);
  const first = posted.at(-1);
  assert.equal(first.op, 'start');
  assert.equal(doc.boxes['d-say'].focused, 1, 'the box does not get focus back, so Escape from the keyboard cannot stop the mic');
  h.voiceOnEvent({ kind: 'listening', id: first.id });
  h.voiceToggle(guide);   // cancel(first) then start(second), in one turn
  assert.deepEqual(posted.slice(-2).map((m) => m.op), ['cancel', 'start']);
  const second = posted.at(-1);
  assert.notEqual(second.id, first.id, 'two starts share one id');
  h.voiceOnEvent({ kind: 'stopped', id: first.id });   // the cancel's answer, arriving late
  assert.equal(h.VOICE.btn, guide, 'the old stopped ended the new session: mic on, button off');
  h.voiceOnEvent({ kind: 'partial', text: 'hello', id: second.id });
  assert.equal(doc.boxes['asp-say'].value, 'hello', 'the new session\'s words were dropped');
  h.voiceOnEvent({ kind: 'partial', text: 'stale', id: first.id });
  assert.equal(doc.boxes['asp-say'].value, 'hello', 'a word from the old session landed');
  h.voiceOnEvent({ kind: 'stopped', id: second.id });
  assert.equal(h.VOICE.btn, null, 'control: the new session\'s own stopped ends it');
});

test('#4409 review 2: the watch stops the mic after a switch with nothing heard, and stops itself after', () => {
  const { h, posted, mkBtn, mkBox, doc, tick, timers } = voiceHarness();
  doc.boxes['d-say'] = mkBox('d-say');
  const dm = mkBtn(); dm.attrs['data-voice-for'] = 'd-say';
  h.set('april', null);
  h.voiceToggle(dm);
  assert.ok(h.watching(), 'no watch while listening');
  tick();
  assert.equal(h.VOICE.btn, dm, 'control: the watch cancelled with nothing moved');
  h.set('casey', null);
  tick();
  assert.equal(h.VOICE.btn, null, 'the mic listened on after a silent switch');
  assert.equal(posted.at(-1).op, 'cancel');
  tick();
  assert.equal(h.watching(), 0, 'the watch never stops');
  assert.equal(timers.filter(Boolean).length, 0);
});

test('#4409 review 5: a read-only or closed box takes no spoken words', () => {
  const { h, posted, mkBtn, mkBox, doc } = voiceHarness();
  const guide = mkBox('asp-say'); guide.readOnly = true; doc.boxes['asp-say'] = guide;
  const g = mkBtn(); g.attrs['data-voice-for'] = 'asp-say';
  h.voiceToggle(g);
  assert.equal(posted.length, 0, 'the mic started on an ended Guide chat');
  const dm = mkBox('d-say'); doc.boxes['d-say'] = dm;
  const b = mkBtn(); b.attrs['data-voice-for'] = 'd-say';
  h.voiceToggle(b);
  const id = posted.at(-1).id;
  h.voiceOnEvent({ kind: 'partial', text: 'one', id });
  assert.equal(dm.value, 'one', 'control: an open box gets the words');
  dm.disabled = true;   // the agent went offline mid-dictation
  h.voiceOnEvent({ kind: 'partial', text: 'one two', id });
  assert.equal(dm.value, 'one', 'words landed in a box the person can no longer type in');
  assert.equal(h.VOICE.btn, null, 'still listening into a closed box');
});

test('#4409 review 6: anything else writing the box while listening (an emoji, a Reply mention, undo) stops dictation instead of being wiped', () => {
  const { h, posted, mkBtn, mkBox, doc } = voiceHarness();
  const box = mkBox('pj-post'); box.value = 'hi'; doc.boxes['pj-post'] = box;
  const b = mkBtn(); b.attrs['data-voice-for'] = 'pj-post';
  h.voiceToggle(b);
  const id = posted.at(-1).id;
  h.voiceOnEvent({ kind: 'partial', text: 'there', id });
  assert.equal(box.value, 'hi there', 'control: words land');
  box.value = '@april hi there';   // Reply added the mention (no key, no paste)
  h.voiceOnEvent({ kind: 'partial', text: 'there friend', id });
  assert.equal(box.value, '@april hi there', 'the next word wiped what the page wrote');
  assert.equal(h.VOICE.btn, null, 'still listening after the box changed under it');
});

test('#4409 review 6: starting the mic keeps another message\'s line; the listening line waits for an empty one', () => {
  const { h, posted, mkBtn, mkBox, doc } = voiceHarness();
  const msg = { textContent: 'Still sending your last message.' };
  doc.boxes['d-say'] = mkBox('d-say'); doc.boxes['d-say-msg'] = msg;
  const b = mkBtn(); b.attrs['data-voice-for'] = 'd-say'; b.attrs['data-voice-msg'] = 'd-say-msg';
  h.voiceToggle(b);
  h.voiceOnEvent({ kind: 'listening', id: posted.at(-1).id });
  assert.equal(msg.textContent, 'Still sending your last message.', 'the mic wiped or overwrote another message');
});

test('#4409 review 5: listening is said in the box\'s message line, and cleared when it ends', () => {
  const { h, posted, mkBtn, mkBox, doc } = voiceHarness();
  const msg = { textContent: '' };
  doc.boxes['d-say'] = mkBox('d-say'); doc.boxes['d-say-msg'] = msg;
  const b = mkBtn(); b.attrs['data-voice-for'] = 'd-say'; b.attrs['data-voice-msg'] = 'd-say-msg';
  h.voiceToggle(b);
  h.voiceOnEvent({ kind: 'listening', id: posted.at(-1).id });
  assert.match(msg.textContent, /Press Escape to stop/, 'a screen reader in the box hears nothing about listening');
  h.voiceOnEvent({ kind: 'stopped', id: posted.at(-1).id });
  assert.equal(msg.textContent, '', 'the listening line stays after it stopped');
});

test('#4409 review 1: read-aloud follows its message through a repaint, and stops when the view moves', () => {
  const { h, mkBtn, doc } = voiceHarness();
  const row = { isConnected: true, getClientRects: () => [1], querySelector: () => null, cloneNode() { return { querySelectorAll: () => [], textContent: 'Hello there.' }; } };
  const oldBtn = Object.assign(mkBtn(), { isConnected: false, closest: () => row });
  const newBtn = Object.assign(mkBtn(), { isConnected: true, closest: () => row });
  doc.querySelectorAll = () => [newBtn];
  h.set('april', null);
  Object.assign(h.SPEAK, { btn: oldBtn, text: 'Hello there.', where: h.viewKey() });
  h.speakFollow();
  assert.equal(h.SPEAK.btn, newBtn, 'the repainted button lost the reading');
  assert.equal(newBtn.attrs['aria-pressed'], 'true', 'the repainted button says it is not reading');
  h.set('casey', null);
  h.speakFollow();
  assert.equal(h.SPEAK.btn, null, 'reading went on after switching agent');
});

test('#4409 review 2: two messages with the same words: read-aloud stays on the one it started on', () => {
  const { h, mkBtn, doc } = voiceHarness();
  const mkRow = () => ({ isConnected: true, getClientRects: () => [1], querySelector: () => null, cloneNode() { return { querySelectorAll: () => [], textContent: 'Done.' }; } });
  const r1 = mkRow(), r2 = mkRow();
  const a = Object.assign(mkBtn(), { isConnected: true, closest: () => r1 });
  const b = Object.assign(mkBtn(), { isConnected: true, closest: () => r2 });
  doc.querySelectorAll = () => [a, b];
  h.set('april', null);
  Object.assign(h.SPEAK, { btn: Object.assign(mkBtn(), { isConnected: false, closest: () => r2 }), text: 'Done.', where: h.viewKey(), nth: 1 });
  h.speakFollow();
  assert.equal(h.SPEAK.btn, b, 'the pressed state jumped to the other "Done."');
});

test('#4409: read aloud uses on-device voices only, and only an agent\'s message offers it', () => {
  assert.match(fn('speakVoice'), /\.filter\(\(v\) => v\.localService\)/, 'a network voice would send the message text off the Mac');
  assert.match(PAGE, /const agent = !!m && m\.operator !== true;/);
  assert.match(PAGE, /rxnsInner\(m && m\.reactions, true, agent\)/, 'the room offers read-aloud on the person\'s own post');
  assert.match(PAGE, /box\.hasAttribute\('data-speak'\)\);   \/\/ #4409/, 'a reaction repaint drops the read-aloud button');
  assert.match(PAGE, /if \(m\.from === session\) d\.appendChild\(speakButtonEl\(\)\);/, 'the Guide\'s answers cannot be read aloud');
  assert.match(fn('speechTextOfRow'), /'\.msg-nm, \.msg-t, \.msg-replyto, \.vh, \.rxns, button/, 'the name, the time or a button label is read out as the message');
  assert.match(fn('speechTextOfRow'), /querySelectorAll\('pre, \.mdcb'\)\.forEach\(\(n\) => n\.replaceWith\(document\.createTextNode\(' Code block\. '\)\)\)/, 'a rendered code block (span.mdcb) is spelled out');
  assert.match(fn('speechTextOfRow'), /querySelectorAll\('br, p, li, div'\)/, 'lines run together when read');
});

test('#4409: the native recognizer is on-device only, and only the board\'s own page can start it', () => {
  assert.match(SWIFT, /^import Speech\b/m);
  assert.match(SWIFT, /req\.requiresOnDeviceRecognition = true/, 'dictation could go to Apple\'s servers');
  assert.match(SWIFT, /config\.userContentController\.add\(voice, name: "kosmosVoice"\)/);
  const at = SWIFT.indexOf('final class VoiceBridge');
  assert.notEqual(at, -1);
  const bridge = SWIFT.slice(at, SWIFT.indexOf('\n}\n', at));
  assert.match(bridge, /guard message\.frameInfo\.isMainFrame, let owner else \{ return \}/, 'a subframe could turn the mic on');
  assert.match(bridge, /owner\.isBoardOrigin\(host: origin\.host, port: origin\.port, scheme: origin\.protocol\)/, 'any local page could turn the mic on');
  assert.match(bridge, /guard Self\.usageStringsPresent\(Bundle\.main\.infoDictionary\) else \{ refuse\("not-set-up"\); return \}/,
    'with a usage string missing macOS kills the app at the request');
  assert.ok(bridge.indexOf('usageStringsPresent(Bundle') < bridge.indexOf('SFSpeechRecognizer.requestAuthorization'), 'the check runs after the request');
  assert.match(bridge, /refuse\("no-on-device"\)/);
  assert.doesNotMatch(bridge, /requiresOnDeviceRecognition = false/);
  assert.match(bridge, /weak var owner: AppDelegate\?\n    weak var webView: WKWebView\?/, 'the handler holds the app or the view strongly (a cycle)');
  // Review 1, read from source (a mic cannot run here): each names the failure it guards.
  assert.match(bridge, /private var recognizer: SFSpeechRecognizer\?/, 'the recognizer is released while its task runs');
  assert.match(bridge, /self\.recognizer = recognizer/, 'the recognizer is never held');
  assert.match(bridge, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 5, execute: wait\)/, 'a stop with no final answer leaves "Stop listening" for good');
  assert.match(SWIFT, /voice\?\.hostCancel\("window hidden"\)   \/\/ #4409: a hidden window never leaves the mic on/, 'closing the window leaves the mic on');
  assert.match(SWIFT, /func windowDidMiniaturize\(_ notification: Notification\) \{\n        voice\?\.hostCancel\("window minimised"\)/, 'minimising leaves the mic on');
  // Review 3: a page that died or was replaced draws every mic off, so the listening ends with it.
  assert.match(SWIFT, /func webViewWebContentProcessDidTerminate\(_ webView: WKWebView\) \{\n[^\n]*\n        voice\?\.hostCancel\("page process ended"\)/, 'a crashed page leaves the mic on with no button');
  assert.match(SWIFT, /didCommit navigation: WKNavigation!\) \{\n        voice\?\.hostCancel\("new page loaded"\)/, 'a reload draws the mic off while it listens');
  assert.match(SWIFT, /delegate\.voice = voice/, 'the app has no handle on the bridge, so hostCancel is never reached');
  assert.match(bridge, /event\["id"\] = pageId/, 'events carry no session id, so a late one ends the next session');
  assert.match(bridge, /guard pending \|\| engine != nil/, 'a window hidden during the permission prompt leaves the next start listening');
});

test('#4409: the signature carries the microphone entitlement and the bundle carries both usage strings', () => {
  assert.match(ENTS, /<key>com\.apple\.security\.device\.audio-input<\/key><true\/>/);
  assert.equal((ENTS.match(/<key>/g) || []).length, 1, 'the entitlements file grants more than the mic');
  assert.match(BUILD, /--entitlements "\$REPO\/native-app\/kosmos-app\.entitlements" -s "\$_codesign_id" "\$STAGE\/app\/bin\/kosmos-app"/);
  assert.match(BUILD, /codesign -d --entitlements - --xml "\$STAGE\/app\/bin\/kosmos-app"/, 'the entitlement is not read back from the signature');
  assert.match(BUILD, /\*"com\.apple\.security\.device\.audio-input"\*\) echo/);
  assert.match(BUILD, /"\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-voice-selftest/, 'the build never runs the voice selftest');
  assert.match(BUILD, /\*"voice-check: all good"\*\) ;;/, 'the build accepts an exit 0 with no verdict');
  assert.match(SWIFT, /--kosmos-app-voice-selftest/);
  assert.match(SWIFT, /NO ON-DEVICE MODEL AT ALL REFUSES/, 'the row the promise rests on is gone');
  assert.match(SETUP, /<key>NSMicrophoneUsageDescription<\/key><string>Kosmos listens only while the microphone button is on, [^<]+<\/string>/);
  assert.match(SETUP, /<key>NSSpeechRecognitionUsageDescription<\/key><string>[^<]+<\/string>/);
});
