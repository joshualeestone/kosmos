'use strict';

/**
 * #4382: a computer that connects to agents on another computer runs no board, and the board is what
 * looks for updates. So the Mac app looks itself: `kosmos update --if-newer` after the launch-time stop
 * and once a day, installing when updates are on and offering "Update Kosmos to X" when they are off.
 *
 * Reading the CLI's answer is pure and has its own rows (--kosmos-app-update-selftest, run at bundle
 * build). What no selftest reaches is the wiring in the AppKit delegate, so that is read here from
 * source. The CLI itself is cli.update-ifnewer-4382.test.js; the real installer leaving a connect
 * computer's board stopped is tools/test-install.sh.
 *
 *   node --test native-app.update-ifnewer-4382.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
function body(sig) {
  const at = SRC.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from main.swift');
  return SRC.slice(at, SRC.indexOf('\n    }\n', at) + 6);
}

test('#4382: the instrument is reading the app', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#4382: a connect computer looks after its launch-time stop, and after a switch to connect, never before the stop', () => {
  const stop = body('private func stopBoardIfRunning()');
  assert.match(stop, /let outcome = stopBoard\(kosmosHome: home, port: port\)\n\s+DispatchQueue\.main\.async \{[\s\S]*self\?\.stopsInFlight -= 1[\s\S]*self\?\.startUpdateLooks\(\)\n\s+\}/,
    'the launch look does not run once the stop has finished');
  const sw = body('private func switchToConnect(home: String)');
  assert.ok(sw.indexOf('stopBoard(kosmosHome: home, port: port)') !== -1 && sw.indexOf('self.startUpdateLooks()') > sw.indexOf('stopBoard(kosmosHome: home, port: port)'),
    'a computer switched to connect never starts looking, or looks before its board is stopped');
  const start = body('private func startUpdateLooks()');
  assert.match(start, /guard computerMode == \.connect else \{ return \}/, 'a computer that runs a board would run a second updater');
  assert.match(start, /Timer\.scheduledTimer\(withTimeInterval: Self\.updateLookInterval, repeats: true\)/, 'no daily look');
  assert.match(SRC, /static let updateLookInterval: TimeInterval = 24 \* 60 \* 60\n/, 'the look is not daily');
  assert.match(start, /if updateTimer == nil \{/, 'a second switch to connect would stack a second daily timer');
});

test('#4382: switching back to run agents stops the looks; the board looks again', () => {
  const run = body('@objc func runAgentsHere(_ sender: Any?)');
  assert.ok(run.indexOf('computerMode = .run') !== -1 && run.indexOf('stopUpdateLooks()') > run.indexOf('computerMode = .run'), 'Run agents leaves the app\'s update timer running beside the board\'s');
  assert.match(body('private func stopUpdateLooks()'), /updateTimer\?\.invalidate\(\); updateTimer = nil\n\s+showUpdateOffer\(nil\)/);
});

test('#4382: an update counts as a stop of ours, so Run agents cannot start a board in the middle of it', () => {
  const look = body('private func lookForUpdate(install: Bool)');
  assert.match(look, /guard computerMode == \.connect, let home = modeHome else \{ return \}/);
  assert.match(look, /guard !updateLookInFlight else/, 'two looks can run two installers at once');
  const took = look.indexOf('stopsInFlight += 1');
  assert.ok(took !== -1 && took < look.indexOf('runKosmosUpdate('), 'the count is not taken, or is taken after the install starts');
  assert.match(look, /DispatchQueue\.main\.async \{[\s\S]*self\.updateLookInFlight = false\n\s+self\.stopsInFlight -= 1\n\s+self\.updateLookDone\(answer, asked: install\)/,
    'the count is not given back when the look ends');
  // And the refusal it relies on is still there.
  assert.match(body('@objc func runAgentsHere(_ sender: Any?)'), /guard stopsInFlight == 0 else \{/);
});

test('#4382: what each answer does: offer, retry, relaunch, or nothing', () => {
  const done = body('private func updateLookDone(_ answer: UpdateAnswer, asked: Bool)');
  assert.match(done, /guard computerMode == \.connect else \{ showUpdateOffer\(nil\); return \}/);
  assert.match(done, /case \.newer\(let v\):\n\s+showUpdateOffer\(v\)/);
  assert.match(done, /case \.failed\(let v\):\n\s+showUpdateOffer\(v, note:/);
  assert.match(done, /case \.updated\(let v\):\n\s+showUpdateOffer\(nil\)\n\s+relaunchAfterUpdate\(to: v\)/);
  assert.match(done, /case \.current, \.board, \.unknown:\n\s+showUpdateOffer\(nil\)/);
  const relaunch = body('private func relaunchAfterUpdate(to v: String)');
  assert.match(relaunch, /guard let target = Self\.freshAppURL\(theirs: v\) else \{/, 'the relaunch is not aimed at the copy that carries the new version');
  assert.match(relaunch, /relaunch\(mine: runningAppVersion\(\) \?\? "unknown", theirs: v, target: target, waited: 0, asked: true, askedBefore: true\)/);
});

test('#4382: the person\'s choice installs whatever the Updates switch says; the CLI is told so', () => {
  assert.match(body('@objc func updateKosmosNow(_ sender: Any?)'), /guard computerMode == \.connect, offeredUpdate != nil else \{ return \}\n\s+lookForUpdate\(install: true\)/);
  assert.match(SRC, /process\.arguments = install \? \["update", "--if-newer", "--install"\] : \["update", "--if-newer"\]/);
});

test('#4382: the offer is native (menu item and a bar under the title bar), never in the page, never a notification (Liu Kang)', () => {
  const show = body('private func showUpdateOffer(_ version: String?, note: String? = nil, menu: Bool = true)');
  const bar = body('private func makeUpdateBar() -> NSTitlebarAccessoryViewController');
  for (const [name, b] of [['showUpdateOffer', show], ['makeUpdateBar', bar]]) {
    assert.doesNotMatch(b, /evaluateJavaScript|WKUserScript|webView/, name + ' reaches into the page, which on a connect computer is the other computer\'s');
  }
  assert.match(bar, /window\.addTitlebarAccessoryViewController\(bar\)/);
  // The app only READS notification settings (#3996's badge) and never asks for permission or posts one.
  assert.doesNotMatch(SRC, /requestAuthorization\(options:|UNUserNotificationCenter\.current\(\)\.add\(|NSUserNotification/, 'the app asks for notification permission, which it never does');
  for (const sig of ['private func lookForUpdate(install: Bool)', 'private func updateLookDone(_ answer: UpdateAnswer, asked: Bool)', 'private func relaunchAfterUpdate(to v: String)']) {
    assert.doesNotMatch(body(sig), /UNUserNotification|NSUserNotification|evaluateJavaScript/, sig + ' notifies or reaches into the page');
  }
  assert.match(SRC, /let updateItem = NSMenuItem\(title: "Update Kosmos",\n\s+action: #selector\(AppDelegate\.updateKosmosNow\(_:\)\),/);
  assert.match(SRC, /updateItem\.isHidden = true\n/, 'the menu item shows on a computer with nothing to offer');
});

test('#4382: the bundle build runs the update selftest and pins the menu row', () => {
  assert.match(BUILD, /"\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-update-selftest/);
  assert.match(BUILD, /\*"update-check: all good"\*\) ;;/);
  assert.match(BUILD, /\n {2}item:Update Kosmos\tshortcut:-\taction:updateKosmosNow:\ttarget:set\n/);
  assert.match(SRC, /if CommandLine\.arguments\.contains\("--kosmos-app-update-selftest"\) \{/);
});
