'use strict';

/**
 * Every provider menu offers the same coming-soon roster.
 *
 * 🛑 THREE MENUS, TWO ANSWERS. `#d-provider` and the create-agent picker listed
 * six providers coming soon; `#acct-provider-pick` listed four, worded
 * differently ("Google Gemini — coming" against "Google Gemini · coming soon").
 * **The same question got a different answer depending on which screen you
 * opened**, and the shortest list was on the ADD A PROVIDER screen, which is
 * the one a person opens to do exactly this.
 *
 * ⚠️ AND IT REACHED PAST THE SCREEN. The agent instruction block tells an agent
 * that those six "appear in the menu marked coming soon", so an agent helping
 * somebody connect a provider was describing a menu the person was not looking
 * at. A drifted list is not cosmetic once something else quotes it.
 *
 * 🔑 THE ASSERTION IS AGREEMENT, NOT A HARDCODED ROSTER. Pinning the six here
 * would make this file a fourth place to update, and the next person would find
 * four lists instead of three. What must hold is that the menus AGREE; which
 * providers they name is Josh's call and is flagged in the markup as his.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Every <select> in the markup, as its inner HTML. */
function selects() {
  return [...PAGE.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/g)].map((m) => ({
    id: (m[0].match(/id="([^"]+)"/) || [])[1] || '(no id)',
    body: m[1],
  }));
}

/** The disabled option labels of a menu, normalised for comparison. */
function comingSoon(body) {
  return [...body.matchAll(/<option\b[^>]*\bdisabled\b[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m) => m[1].replace(/&middot;|·|—/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((t) => t.includes('coming'))
    .sort();
}

/** Menus that offer providers: the ones with a coming-soon row at all. */
function providerMenus() {
  return selects().map((s) => ({ id: s.id, roster: comingSoon(s.body) })).filter((s) => s.roster.length);
}

test('CONTROL: more than one provider menu is found, and each has a roster', () => {
  /* An agreement test over one menu, or zero, passes for the wrong reason: a
     set always agrees with itself and an empty list always agrees with another
     empty list. This is the assertion that stops that. */
  const menus = providerMenus();
  assert.ok(menus.length >= 2, `expected several provider menus, found ${menus.length}`);
  for (const m of menus) {
    assert.ok(m.roster.length >= 2, `${m.id} has a suspiciously short roster: ${m.roster.length}`);
  }
});

test('CONTROL: the extractor can tell two different rosters apart', () => {
  /* Proves the comparison below can return the dangerous answer. Without it a
     normaliser that flattened everything to one string would agree always. */
  const a = comingSoon('<option disabled>Google Gemini &middot; coming soon</option>');
  const b = comingSoon('<option disabled>Google Gemini &middot; coming soon</option>'
    + '<option disabled>Mistral &middot; coming soon</option>');
  assert.notDeepEqual(a, b, 'the extractor cannot distinguish two different rosters');
  assert.deepEqual(a, ['google gemini coming soon'], `unexpected normalisation: ${JSON.stringify(a)}`);
});

test('every provider menu names the same providers as coming soon', () => {
  const menus = providerMenus();
  const first = menus[0];
  for (const m of menus.slice(1)) {
    assert.deepEqual(m.roster, first.roster,
      `${m.id} disagrees with ${first.id} about what is coming soon.\n`
      + `  ${first.id}: ${first.roster.join(', ')}\n`
      + `  ${m.id}: ${m.roster.join(', ')}`);
  }
});
