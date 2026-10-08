'use strict';
/* #5169: source-wiring guards for the run/both main-frame navigation policy.
 *
 * The PURE behaviour (connectLinkDecision and isKosmosPlusSiteURL, including the Stripe-checkout
 * merge-gate row) is proven by --kosmos-app-mode-selftest, which tools/build-kosmos-bundle.sh runs
 * at build and fails on a wrong row. These assertions guard the parts a pure selftest cannot reach:
 * that the HANDLER actually applies the policy to run AND both (not only connect), and that the new
 * seams exist and are wired the safe way.
 *
 * Source-only on purpose (it reads main.swift, never runs the binary), so it needs no KOSMOS_APP_BIN
 * and cannot spuriously fail when the Swift binary is absent (the #5188 review's "skip the binary
 * selftest when unset" concern, addressed here by having no binary dependency to skip). The fast
 * suite does not compile Swift; the binary selftest is the build's job.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'native-app', 'main.swift'), 'utf8');

test('#5169: the main-frame nav handler applies to run and both, not only connect', () => {
  // The guard that used to read `computerMode == .connect` must now cover all three modes, so a
  // foreign link or redirect cannot replace the board on a computer that runs agents.
  assert.match(
    SRC,
    /computerMode == \.connect \|\| computerMode == \.run \|\| computerMode == \.both/,
    'the decidePolicyForNavigationAction guard must cover connect, run AND both (#5169)'
  );
});

test('#5169: connectLinkDecision takes a fromKosmosPlusPage flag, keyed on the site in the handler', () => {
  assert.match(SRC, /func connectLinkDecision\([\s\S]*?fromKosmosPlusPage: Bool/,
    'connectLinkDecision must take a fromKosmosPlusPage flag');
  // The handler keys it on the SITE (isKosmosPlusSiteURL), NOT isKosmosPlusURL, or a connect
  // computer's own board page would count as a Kosmos+ page and skip the #5169 block.
  assert.match(SRC, /fromKosmosPlusPage: isKosmosPlusSiteURL\(committedPageURL\)/,
    'the handler must pass isKosmosPlusSiteURL(committedPageURL) as fromKosmosPlusPage');
});

test('#5169: isKosmosPlusSiteURL exists and is distinct from isKosmosPlusURL', () => {
  assert.match(SRC, /func isKosmosPlusSiteURL\(/,
    'isKosmosPlusSiteURL (the site-only predicate) must exist so computer board addresses stay blocked');
  assert.match(SRC, /func isKosmosPlusURL\(/, 'isKosmosPlusURL must still exist');
});

test('#5169: the unclicked-foreign-https rule allows the Kosmos+ checkout hand-off (Buy must work)', () => {
  // A non-Kosmos+ https url opens in the browser when clicked OR when the current page is the
  // Kosmos+ site (the signin.html -> checkout.stripe.com hand-off); otherwise it is blocked.
  assert.match(SRC, /\(clicked \|\| fromKosmosPlusPage\) \? \.browser : \.block/,
    'foreign https must be (clicked || fromKosmosPlusPage) ? .browser : .block, so checkout from the site is not blocked (#5169 merge gate)');
});

test('#5169: the mode selftest pins the checkout merge-gate row', () => {
  assert.match(SRC, /MERGE GATE: an UNCLICKED checkout hand-off from the Kosmos\+ sign-in page/,
    'the --kosmos-app-mode-selftest must carry the checkout merge-gate row');
});
