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
  const stop = body('private func stopUpdateLooks()');
  for (const [re, what] of [[/updateTimer\?\.invalidate\(\); updateTimer = nil\n/, 'the daily timer'], [/updateRetry\?\.cancel\(\); updateRetry = nil\n/, 'the hour retry'],
    [/NSWorkspace\.shared\.notificationCenter\.removeObserver\(o\); updateWakeObserver = nil/, 'the wake look'], [/installedUpdate = nil\n\s+showUpdateOffer\(nil\)\n/, 'the offer']]) {
    assert.match(stop, re, 'Run agents leaves ' + what + ' of the app\'s looks in place');
  }
});

test('#4382: an update counts as a stop of ours, so Run agents cannot start a board in the middle of it', () => {
  const look = body('private func lookForUpdate(install: Bool, retry: Bool = false)');
  assert.match(look, /guard computerMode == \.connect, let home = modeHome else \{ return \}/);
  assert.match(look, /guard !updateLookInFlight else/, 'two looks can run two installers at once');
  const took = look.indexOf('stopsInFlight += 1');
  assert.ok(took !== -1 && took < look.indexOf('runKosmosUpdate('), 'the count is not taken, or is taken after the install starts');
  assert.match(look, /DispatchQueue\.main\.async \{[\s\S]*self\.updateLookInFlight = false\n\s+self\.stopsInFlight -= 1\n\s+self\.lastUpdateLookAt = Date\(\)\n\s+self\.updateLookDone\(answer, asked: install\)/,
    'the count is not given back when the look ends');
  // And the refusal it relies on is still there, now also for an install an earlier run of the app started.
  const runHere = body('@objc func runAgentsHere(_ sender: Any?)');
  assert.match(runHere, /let installing = updateLookInFlight \|\| Self\.installUnderWay\(kosmosHome: home\)\n\s+guard stopsInFlight == 0, !installing else \{/);
  assert.match(SRC, /let marker = kosmosHome \+ "\/logs\/install\.started"[\s\S]{0,200}let age = Date\(\)\.timeIntervalSince\(at\)\n\s+return age >= 0 && age < 30 \* 60/,
    'the app and the CLI disagree on when an install is under way');
});

test('#4382: what each answer does: offer, retry, relaunch, or nothing', () => {
  const done = body('private func updateLookDone(_ answer: UpdateAnswer, asked: Bool)');
  assert.match(done, /guard computerMode == \.connect else \{ showUpdateOffer\(nil\); return \}/);
  assert.match(done, /case \.newer\(let v\):\n(\s+\/\/.*\n)*\s+showUpdateOffer\(v\)\n/);
  assert.match(done, /case \.failed\(let v\):\n\s+showUpdateOffer\(v, note:/);
  // Review 1: only the person's own Update restarts at once, and never under a dialog of ours. An install
  // made because updates are on waits for Restart, so words typed on the page are never lost to it.
  // The person's own Update: the offer is kept under the relaunch, so a relaunch that fails leaves Restart.
  assert.match(done, /case \.updated\(let v\) where asked && !ownDialogOpen:\n(\s+\/\/.*\n)*\s+showInstalledOffer\(v\)\n\s+relaunchAfterUpdate\(to: v\)\n/);
  assert.match(body('private func lookForUpdate(install: Bool, retry: Bool = false)'), /updateBarLabel\?\.stringValue = "Updating Kosmos\. It restarts when the update is installed\."/,
    'the person is not told the app restarts when their update is done');
  const unasked = done.slice(done.indexOf('case .updated(let v):\n'));
  assert.ok(done.indexOf('case .updated(let v):\n') !== -1, 'no branch for an install nobody asked for');
  assert.match(unasked, /^case \.updated\(let v\):\n(\s+\/\/.*\n)*\s+showInstalledOffer\(v\)\n\s+case /, 'an install nobody asked for does something other than offer the restart');
  assert.equal((done.match(/relaunchAfterUpdate\(/g) || []).length, 1, 'a second path restarts the app from a look');
  assert.match(done, /case \.current, \.board, \.refused:\n(\s+\/\/.*\n)*\s+if let v = installedUpdate \{ showInstalledOffer\(v\) \} else \{ showUpdateOffer\(nil\) \}/,
    'a later look hides the restart an installed update is waiting for');
  // A look that could not look takes nothing away: neither an offer nor a waiting Restart.
  assert.match(done, /case \.unknown:\n(\s+\/\/.*\n)*\s+if let v = installedUpdate \{ showInstalledOffer\(v\) \}\n\s+case /);
  // Review 3: a look that could not reach the host is tried again within the hour, not tomorrow.
  // Once: the retry's own unknown is not retried, and a refusal (not a connect computer, or an agent) never is.
  assert.match(done, /case \.current, \.board, \.refused:/);
  // Review 5: an install this app did not see finish (another run of it started it) still gets its Restart:
  // the CLI names the version on disk, and one that differs from the running app, with an app carrying it, is offered.
  // Review 6: only an install NEWER than the running app is offered (restartWanted's rows are in the update selftest).
  assert.match(done, /case \.current\(let v\) where installedUpdate == nil && Self\.restartWanted\(running: runningAppVersion\(\), onDisk: v\)\n\s+&& Self\.freshAppURL\(theirs: v\) != nil:\n(\s+\/\/.*\n)*\s+showInstalledOffer\(v\)\n/);
  assert.match(SRC, /static func restartWanted\(running: String\?, onDisk: String\) -> Bool \{\n\s+guard let running else \{ return false \}\n\s+return isBehind\(running, onDisk\) == true\n/);
  assert.ok(done.indexOf('case .current(let v) where') < done.indexOf('case .current, .board, .refused:'), 'the version arm must come before the general one, or it never runs');
  assert.match(SRC, /case \("current", 2\) where version\(words\[1\]\): return \.current\(words\[1\]\)/);
  // Review 5: a refusal nobody pressed for (an install under way) is looked at again within the hour, once.
  assert.match(done, /if !updateLookIsRetry \{\n\s+if case \.unknown = answer \{ retryUpdateLookSoon\(\) \}\n(\s+\/\/.*\n)*\s+if case \.refused = answer, !asked \{ retryUpdateLookSoon\(\) \}\n\s+\}/);
  // Review 5: Update pressed from the menu after Not Now still shows the bar that says the app restarts.
  const pressed = body('private func lookForUpdate(install: Bool, retry: Bool = false)');
  assert.match(pressed, /if install \{\n(\s+\/\/.*\n)*\s+let bar = updateBar \?\? makeUpdateBar\(\)\n[\s\S]*?bar\.isHidden = false\n[\s\S]*?updateKosmosNow\(_:\)\) \}\)\?\.isHidden = true\n\s+\}/,
    'a menu press after Not Now installs and restarts with the bar still hidden');
  // Review 4: a pressed Update that could not start says so and keeps the offer, rather than vanishing.
  assert.match(done, /case \.board where asked, \.refused where asked:\n(\s+\/\/.*\n)*\s+showUpdateOffer\(offeredUpdate, note: "Kosmos could not start the update right now\. Try again in a few minutes\."\)\n/);
  assert.ok(done.indexOf('case .board where asked') < done.indexOf('case .current, .board, .refused:'), 'the asked arm comes after the general one and never runs');
  // Review 4: Not Now holds for that version whatever the bar says about it.
  assert.match(SRC, /guard let text, version == nil \|\| version != updateBarDismissed else \{/);
  assert.match(body('private func lookForUpdate(install: Bool, retry: Bool = false)'), /updateLookInFlight = true\n\s+updateLookIsRetry = retry\n/);
  assert.match(SRC, /static let updateRetryAfterUnknown: TimeInterval = 60 \* 60\n/);
  const retry = body('private func retryUpdateLookSoon()');
  assert.match(retry, /guard updateRetry == nil else \{ return \}/, 'retries stack');
  assert.match(retry, /asyncAfter\(deadline: \.now\(\) \+ Self\.updateRetryAfterUnknown, execute: work\)/);
  assert.match(retry, /self\?\.lookForUpdate\(install: false, retry: true\)/, 'the retry is not marked as one, so it retries itself hourly');
  const start = body('private func startUpdateLooks()');
  assert.match(start, /NSWorkspace\.didWakeNotification/, 'a Mac that slept through its daily look waits another day');
  assert.match(start, /Date\(\)\.timeIntervalSince\(last\) < Self\.updateLookInterval \{ return \}/, 'every wake looks, not only an overdue one');
  const installed = body('private func showInstalledOffer(_ v: String)');
  assert.match(installed, /installedUpdate = v\n\s+showUpdateOffer\(v, note: "Kosmos \\\(v\) is installed\. Restart Kosmos to start using it\.", installed: true\)/);
  const relaunch = body('private func relaunchAfterUpdate(to v: String)');
  assert.match(relaunch, /guard let target = Self\.freshAppURL\(theirs: v\) else \{/, 'the relaunch is not aimed at the copy that carries the new version');
  assert.match(relaunch, /relaunch\(mine: runningAppVersion\(\) \?\? "unknown", theirs: v, target: target, waited: 0, asked: true, askedBefore: true\)/);
});

test('#4382: the person\'s choice installs whatever the Updates switch says; the CLI is told so', () => {
  const now = body('@objc func updateKosmosNow(_ sender: Any?)');
  assert.match(now, /guard !updateLookInFlight else \{ logLine\(/, 'a second press runs a second installer');
  assert.match(now, /if let v = installedUpdate \{\n\s+updateBarDismissed = nil\n\s+relaunchAfterUpdate\(to: v\)\n\s+return\n\s+\}\n\s+guard offeredUpdate != nil else \{ return \}\n\s+updateBarDismissed = nil.*\n\s+lookForUpdate\(install: true\)/);
  assert.match(SRC, /process\.arguments = install \? \["update", "--if-newer", "--install"\] : \["update", "--if-newer"\]/);
});

test('#4382: the offer is native (menu item and a bar under the title bar), never in the page, never a notification (Liu Kang)', () => {
  const show = body('private func showUpdateOffer(_ version: String?, note: String? = nil, menu: Bool = true, installed: Bool = false)');
  const bar = body('private func makeUpdateBar() -> NSTitlebarAccessoryViewController');
  for (const [name, b] of [['showUpdateOffer', show], ['makeUpdateBar', bar]]) {
    assert.doesNotMatch(b, /evaluateJavaScript|WKUserScript|webView/, name + ' reaches into the page, which on a connect computer is the other computer\'s');
  }
  assert.match(bar, /window\.addTitlebarAccessoryViewController\(bar\)/);
  // The app only READS notification settings (#3996's badge) and never asks for permission or posts one.
  assert.doesNotMatch(SRC, /requestAuthorization\(options:|UNUserNotificationCenter\.current\(\)\.add\(|NSUserNotification/, 'the app asks for notification permission, which it never does');
  for (const sig of ['private func lookForUpdate(install: Bool, retry: Bool = false)', 'private func updateLookDone(_ answer: UpdateAnswer, asked: Bool)', 'private func relaunchAfterUpdate(to v: String)',
    'private func showInstalledOffer(_ v: String)', 'private func retryUpdateLookSoon()', 'private func startUpdateLooks()']) {
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
