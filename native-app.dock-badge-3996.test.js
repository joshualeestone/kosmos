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
  assert.match(SRC, /resolvedPort = resolved\.port\n\s+startDockBadge\(port: resolved\.port\)/,
    'the badge is not started where the port is resolved');
  const start = body('private func startDockBadge(port: Int)');
  assert.match(start, /badgeTimer\?\.invalidate\(\)/, 'a second start would leave two timers polling');
  assert.match(start, /refreshDockBadge\(port: port\)\n\s+badgeTimer = Timer\.scheduledTimer\(withTimeInterval: 10, repeats: true\)/,
    'no first read before the timer, or the timer is not a repeating 10 s one');
});

test('#3996: it reads counts.waiting from /api/status with the board token, and a board that did not answer clears the badge', () => {
  const refresh = body('private func refreshDockBadge(port: Int)');
  assert.match(refresh, /\/api\/status/);
  assert.match(refresh, /x-kosmos-board-token/, 'an enforcing board refuses a request without its token');
  assert.match(refresh, /statusCode == 200/);
  assert.match(refresh, /answered \? Self\.badgeLabel\(fromStatusJSON: data\) : nil/, 'a refused or failed read does not clear the badge');
  assert.match(refresh, /DispatchQueue\.main\.async \{ NSApp\.dockTile\.badgeLabel = allowed \? label : nil \}/,
    'the Dock tile is set off the main thread, or the person\'s setting is not applied');
  assert.match(body('static func badgeLabel(fromStatusJSON data: Data?)'), /counts\["waiting"\]/);
});

test('#3996: the person\'s macOS badge setting wins, without asking for notification permission', () => {
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
