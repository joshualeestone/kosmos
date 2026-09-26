'use strict';

/**
 * #3996: the waiting count on the Mac Dock icon.
 *
 * The number itself is the board's (engine/status.js waitingTotal, served as counts.waiting and
 * tested in engine/status.waiting-3996.test.js and server.test.js). How the app READS it is a pure
 * Swift function the --kosmos-app-badge-selftest rows drive at bundle build. What neither can
 * reach is the wiring in an AppKit delegate and a URLSession callback, so that is read here from
 * source: the timer starts when the board's port is known, the badge is set on the main thread,
 * a board that did not answer clears it, and the person's own badge setting wins.
 *
 *   node --test native-app.dock-badge-3996.test.js
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

test('#3996: the instrument is reading the app', () => {
  assert.ok(SRC.length > 40000, 'main.swift read back only ' + SRC.length + ' bytes');
});

test('#3996: the badge starts once the board\'s port is known, and keeps polling on its own timer', () => {
  assert.match(SRC, /resolvedPort = resolved\.port\n\s+badgeOrigin = \("127\.0\.0\.1", resolved\.port\)\n\s+startDockBadge\(port: resolved\.port\)/,
    'the badge is not started where the port is resolved');
  const start = body('private func startDockBadge(port: Int)');
  assert.match(start, /badgeTimer\?\.invalidate\(\)/, 'a second start would leave two timers polling');
  assert.match(start, /refreshDockBadge\(port: port\)\n\s+let t = Timer\(timeInterval: 10, repeats: true\)/, 'no first read, or not a repeating 10 s timer');
  assert.match(start, /RunLoop\.main\.add\(t, forMode: \.common\)/, 'the badge stops counting while a dialog or menu is open');
});

test('#3996: while the page polls, the app asks the board nothing extra; otherwise it reads /api/status with the token', () => {
  const refresh = body('private func refreshDockBadge(port: Int)');
  assert.match(refresh, /if let at = lastPageBadgeAt, Date\(\)\.timeIntervalSince\(at\) < 8 \{ return \}/,
    'the app polls the heaviest route even while the page is already handing it the count');
  assert.match(refresh, /\/api\/status/);
  assert.match(refresh, /x-kosmos-board-token/, 'an enforcing board refuses a request without its token');
  assert.match(refresh, /answered \? Self\.badgeLabel\(fromStatusJSON: data\) : nil/, 'a refused or failed read does not clear the badge');
  assert.match(refresh, /logLine\("dock badge: the board did not answer/, 'a missing badge leaves no trace in the log');
  const said = body('func pageSaidWaiting(_ body: Any)');
  assert.match(said, /lastPageBadgeAt = Date\(\)/);
  assert.match(said, /badgeLabel\(fromCount: body\)/, 'the page\'s count is not read by the same rule as the board\'s');
  const show = body('private func showBadge(_ label: String?, asked: Int)');
  assert.match(show, /guard asked >= self\.badgeShown else \{ return \}/, 'an older answer can overwrite a newer one');
  assert.match(show, /DispatchQueue\.main\.async \{/);
  assert.match(show, /let next = allowed \? label : nil\n\s+if NSApp\.dockTile\.badgeLabel != next \{ NSApp\.dockTile\.badgeLabel = next \}/);
});

test('#3996: only the board\'s own page can hand over a count, and the page hands it on every poll', () => {
  assert.match(SRC, /config\.userContentController\.add\(BadgeMessageProxy\(delegate\), name: "kosmosBadge"\)/);
  const at = SRC.indexOf('final class BadgeMessageProxy');
  assert.notEqual(at, -1);
  const proxy = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(proxy, /weak var owner: AppDelegate\?/, 'the handler holds the app strongly (a cycle)');
  assert.match(proxy, /guard message\.frameInfo\.isMainFrame, let owner else \{ return \}/, 'a subframe could set the badge');
  assert.match(proxy, /owner\.isBoardOrigin\(host: origin\.host, port: origin\.port\)/, 'the origin is not checked');
  const board = body('func isBoardOrigin(host: String, port: Int) -> Bool');
  assert.match(board, /return host == mine\.host && port == mine\.port/, 'another local service on another port could set the badge');
  assert.match(SRC, /badgeOrigin = \("127\.0\.0\.1", resolved\.port\)/, 'the board\'s own origin is not the one allowed');
  assert.match(SRC, /if let last = badgeSettingAnswer, Date\(\)\.timeIntervalSince\(last\.at\) < 300 \{ done\(last\.allowed\); return \}/, 'the badge setting is asked on every update');
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(page, /if \(h\) h\.postMessage\(typeof c\.waiting === 'number' \? c\.waiting : null\);/,
    'the page does not hand the count over (or stays silent on an old board, which sets the app polling)');
});

test('#3996: a macOS badge setting of off would win (a forward check), and Kosmos never asks for notification permission', () => {
  const allowed = body('static func badgesAllowed(');
  assert.match(allowed, /settings\.badgeSetting != \.disabled/);
  assert.match(allowed, /Bundle\.main\.bundleIdentifier != nil/, 'UNUserNotificationCenter outside a bundle crashes');
  assert.doesNotMatch(SRC, /requestAuthorization/, 'Kosmos asks for notification permission (a system dialog nobody asked for)');
});

test('#3996: the bundle build runs the badge selftest and requires its verdict', () => {
  assert.match(SRC, /--kosmos-app-badge-selftest/);
  assert.match(SRC, /ZERO CLEARS IT/, 'the zero row is gone');
  assert.match(BUILD, /"\$STAGE\/app\/bin\/kosmos-app" --kosmos-app-badge-selftest/, 'the build never runs it');
  assert.match(BUILD, /\*"badge-check: all good"\*\) ;;/, 'the build accepts an exit 0 with no verdict');
});

test('#3996: the board serves the one number the badge shows', () => {
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /counts\.waiting = waitingTotal\(counts, rows\);/);
});
