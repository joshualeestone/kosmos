'use strict';
/**
 * The first thing a person sees when the installer is printed instead of run.
 *
 * 🛑 THE FAILURE THIS IS FOR. On 2026-08-22 the first person outside this team
 * to try Kosmos ran `curl -fsSL .../setup` with no `| sh`. curl printed 2,169
 * lines of the installer to her terminal and exited 0. She told Josh the
 * product was broken, which was the reasonable conclusion: the failure is
 * silent, it succeeds, and it looks catastrophic.
 *
 * ⚠️ AND IT IS PINNED AT A POSITION, not merely present. The whole value is
 * being at the TOP of what scrolled past. A banner twenty lines down is a
 * banner she never reaches, and nothing else in this file would notice it
 * moving.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const SETUP = fs.readFileSync(nodePath.join(__dirname, 'install', 'setup.sh'), 'utf8');
const HEAD = SETUP.split('\n').slice(0, 15).join('\n');

test('the installer opens by telling a person it did not install', () => {
  assert.match(HEAD, /KOSMOS DID NOT INSTALL/,
    'the banner is not in the first fifteen lines, which is the only place it works');
  // The remedy, not just the diagnosis: she needs the line, whole.
  assert.match(HEAD, /curl -fsSL https:\/\/installkosmos\.com\/setup \| sh/,
    'the banner says something went wrong and does not say what to run');
});

test('it is addressed to her, not to us', () => {
  /* ⚠️ THE TEST THAT KEEPS THIS HONEST OVER TIME. The rest of this file is
     written for whoever maintains the installer, and the pressure on any
     comment block is to grow toward that audience. These are the words that
     make it hers, and a rewrite that drops them has quietly given the top of
     the screen back to us. */
  assert.match(HEAD, /Nothing went wrong and nothing was broken/,
    'the reassurance is gone: she has just watched two thousand lines scroll past');
  assert.doesNotMatch(HEAD, /launchd|plist|LSArchitecture|Applications icon/,
    'the first screen is spending its one moment of attention on our plumbing again');
});

test('the shebang is still the first line', () => {
  /* A banner above `#!/bin/sh` is not a banner, it is a broken script. */
  assert.equal(SETUP.split('\n')[0], '#!/bin/sh');
});
