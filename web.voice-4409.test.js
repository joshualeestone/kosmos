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
  assert.match(PAGE, /window\.addEventListener\('hashchange', \(\) => voiceCancel\(\)\);/, 'words for one agent could land in the next agent\'s box');
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
