'use strict';

/**
 * #683: the About-you name placeholder was "Josh". A stranger genuinely
 * cannot tell whether the software is asking about them or already belongs to
 * somebody named Josh -- and on the co-founder's install the box would carry
 * the name of the person who sent them the app, which makes the wrong reading
 * the natural one (the first-run journey walk, minute one).
 *
 * The placeholder stays an example, because its siblings are examples; it
 * stops being a person connected to the product. Pinned textually on the page
 * source: the field is composed inside a script string, so there is no
 * renderer to lift, and what ships IS the string.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('#683: the About-you name placeholder is an example, and not the author', () => {
  const field = PAGE.match(/<input[^>]*id="fr-you-name"[^>]*>/);
  assert.ok(field, 'the About-you name field vanished from the page');
  assert.match(field[0], /placeholder="Alex"/,
    'the example name changed; if that is deliberate, move this pin to the new one');
  assert.doesNotMatch(field[0], /placeholder="Josh"/,
    'the box shows the author\'s name to every stranger, who cannot tell whose software this is (#683)');
});
