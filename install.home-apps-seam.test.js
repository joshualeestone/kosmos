'use strict';
/* #721: the installer reaches the person's Applications folder through ONE
   name, HOME_APP_DIR, overridable independently of HOME. A test that must keep
   HOME real (a signed-in Claude lives under it) can still write nothing real.
   The class stays closed by grepping the source: no code line names
   $HOME/Applications except the definition of the seam itself. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SETUP = fs.readFileSync(path.join(__dirname, 'install', 'setup.sh'), 'utf8');

test('#721: no code line reaches $HOME/Applications directly; every reach goes through HOME_APP_DIR', () => {
  const offenders = [];
  SETUP.split('\n').forEach((l, i) => {
    if (/^\s*#/.test(l)) return;
    if (l.includes('HOME_APP_DIR="${KOSMOS_HOME_APP_DIR:-$HOME/Applications}"')) return;
    if (l.includes('$HOME/Applications')) offenders.push((i + 1) + ': ' + l.trim());
  });
  assert.deepEqual(offenders, [], 'a reach into the real ~/Applications that a HOME-real walk cannot redirect');
  assert.match(SETUP, /HOME_APP_DIR="\$\{KOSMOS_HOME_APP_DIR:-\$HOME\/Applications\}"/, 'the seam definition moved');
});
