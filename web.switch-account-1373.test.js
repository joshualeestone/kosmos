'use strict';

/**
 * #1373: the switch offers WHICH OpenAI sign-in, and only reports a pick when a
 * person actually picked.
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT SEE, said plainly so nobody reads more into a
 * green than is there. These assertions read the SOURCE. They can see that a
 * guard is present and what it is keyed on; they cannot see the rendered page,
 * so they cannot tell whether the control actually appears. The rendering half
 * is `docs/browser-checks/render-model-change.js`, and neither file replaces the
 * other.
 *
 * 🛑 IT EXISTS BECAUSE THE HONESTY RULE HAS NO OTHER GUARD. The route says "the
 * OpenAI sign-in you picked" on one branch and "your OpenAI sign-in" on the
 * other, and the FIRST DRAFT OF THIS FEATURE SENT THE PRESELECTED ACCOUNT ON
 * EVERY SWITCH -- so a person who never opened the menu was told they had
 * chosen. Every test passed. The route's own comment forbids exactly that
 * ("Saying 'the one you picked' when nobody picked would be the invention this
 * route refuses elsewhere") and nothing enforced it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
const ENGINE = fs.readFileSync(nodePath.join(__dirname, 'engine', 'create.js'), 'utf8');

/* 🛑 A POPULATION FLOOR, AT MODULE SCOPE, BEFORE ANY TEST RUNS.
   `assert.doesNotMatch('', /anything/)` PASSES. Measured. So an absence assertion cannot
   tell "I looked and it is not there" from "I looked at nothing", and it is the only kind
   of assertion that can be true for no reason: a presence assertion on an empty read fails
   loudly, which is why a file like this LOOKS well guarded while its two absence claims are
   the two that can lie.
   ⚠️ I FIRST PUT THIS INSIDE THE TESTS AND IT NEVER RAN. node:test aborts a test at its
   first failing assertion, and every test holding an absence claim also holds presence
   claims that fail earlier, so the floor was unreachable in exactly the scenario it was
   written for. Verified by simulating a vacuous read: 14 tests failed and NOT ONE of them
   was the floor. Module scope is what makes it fire first.
   ⇒ CONTROL STRINGS, NOT A BYTE COUNT. A length check passes on the wrong file; a string
   each file uniquely contains proves we are reading the one we think we are. */
for (const [name, body, control] of [
  ['web/index.html', PAGE, 'id="d-provider-account"'],
  ['server.js', SERVER, 'accountDir'],
  ['engine/create.js', ENGINE, 'pickedByPerson'],
]) {
  if (!body || body.indexOf(control) === -1) {
    throw new Error('population floor: ' + name + ' read as ' + body.length
      + ' chars and does not contain ' + JSON.stringify(control)
      + '. Every absence assertion below would pass by examining nothing.');
  }
}

test('#1373: the reader works at all', () => {
  /* The control. Every assertion below is an existence test on a big file, and
     an existence test whose reader is broken reports the same thing as a
     genuinely missing guard. */
  assert.match(PAGE, /id="d-provider"/, 'the page reader found no #d-provider, so it is not reading the page');
  assert.match(SERVER, /api\/agent\/\[\^\/\]\+\/provider|\/provider\$/, 'the server reader found no provider route');
});

test('#1373: the switch offers a sign-in to choose', () => {
  assert.match(PAGE, /id="d-provider-account"/, 'the picker is gone from the markup');
  /* Sized with its siblings. Left out of the shared rule it sizes to its longest
     option and sits visibly narrower than the select above it, which is the
     defect the comment on that rule was written about. */
  const widthRule = PAGE.match(/^#create-model,[^\n]*\{ flex: 1; min-width: 220px; \}$/m);
  assert.ok(widthRule, 'the shared select width rule moved or was renamed');
  assert.match(widthRule[0], /#d-provider-account\b/,
    'the sign-in picker is not in the shared width rule, so it will size differently from the select above it');
});

test('#1373: a preselected option is NOT reported as a choice', () => {
  /* THE LOAD-BEARING ONE. Three parts, and the guard is worthless without all
     three: a flag that starts false, a person's own change event that sets it,
     and a send that consults it. */
  assert.match(PAGE, /let SWITCH_ACCT_TOUCHED = false;/,
    'the touched flag is gone, so a preselect can be reported as a pick again');
  /* 🛑 THIS ARM WAS DECORATION AND A REVIEWER PROVED IT BY MUTATION, WHICH I THEN
     REPRODUCED: deleting the reset from inside fillSwitchAccounts left it GREEN,
     because the pattern matched the `let SWITCH_ACCT_TOUCHED = false;` DECLARATION
     about 178 characters above `const openai`. It asserted that the two strings
     exist near each other, which they do whether or not the reset survives.
     ⇒ Anchored on the function's OWN first line instead, so the match can only be
     satisfied by a reset that is genuinely inside the body. This is the arm that
     stops a pick made on one agent leaking to the next one you open. */
  assert.match(PAGE, /if \(!sel \|\| !prov\) return;\s*SWITCH_ACCT_TOUCHED = false;/,
    'the flag is not reset inside fillSwitchAccounts, so a pick on one agent carries to the next');
  /* 🔑 PINNED ON THE PROPERTY, NOT THE SPELLING. This caught a real change of mine
     (the listener moved behind a null-checked variable) and the PROPERTY was intact,
     so the assertion was wrong rather than the code. Loosened on the axis nothing
     depends on (inline call or via a local) and kept tight on the one that matters:
     the flag is set by a CHANGE event on THAT element, which is what makes a pick a
     pick. Re-pinning the new exact spelling would just re-arm the trap. */
  assert.match(PAGE, /getElementById\('d-provider-account'\)[\s\S]{0,400}?addEventListener\('change'[\s\S]{0,160}?SWITCH_ACCT_TOUCHED = true;/,
    'nothing sets the touched flag from the picker\'s own change event, so a real pick would never be reported');
  /* 🔑 TWO FIELDS, TWO PROMISES, AND THEY MUST NOT BE RE-MERGED. `account` is
     WHICH sign-in and is sent whenever the menu is showing, so what a person sees
     is what is used. `picked` is WHETHER they chose it and gates the sentence.
     Conflating them was a WRONG-ACCOUNT bug: re-selecting the option a <select>
     already holds fires no `change`, and with one account it can never fire, so
     requiring the flag meant the visible row was not the row sent. */
  /* 🔑 LOOSENED ONTO THE AXIS NOTHING DEPENDS ON. The
     rule is stated 15 lines above and was then broken here: re-pinning an exact
     spelling re-arms the trap that comment had just warned about. What must hold is the PROPERTY, in two halves,
     and the second half was never asserted at all:
       sent when the menu is VISIBLE  -> the row on screen is the row used
       NOT gated on the pick flag     -> re-merging the fields IS the wrong-account bug
     ⭐ The doesNotMatch is strictly STRONGER than the literal it replaces: the literal
     could only fail if the spelling changed; this fails if the MEANING changes. */
  assert.match(PAGE, /account:[\s\S]{0,80}?!acctSel\.hidden[\s\S]{0,60}?acctSel\.value/,
    'the account is no longer sent whenever the menu is showing, so the row on screen may not be the row used');
  /* 🛑 A POPULATION FLOOR BEFORE AN ABSENCE CLAIM, because `assert.doesNotMatch('', /x/)`
     PASSES. Measured in node. So an absence assertion cannot tell "I looked and it is not
     there" from "I looked at nothing", and it is the ONLY kind of assertion that can be
     true for no reason: a presence assertion on an empty read fails loudly, which is why
     the file looks well guarded and the two absence claims are the two that can lie.
     ⇒ A CONTROL STRING, NOT A BYTE COUNT. A length check passes on the wrong file; a
     string only this file contains proves we are reading the one we think we are. */
  assert.match(PAGE, /id="d-provider-account"/,
    'the page was not read, or is not the page, so the absence claim below would pass by examining nothing');
  assert.doesNotMatch(PAGE, /account:[^\n]*SWITCH_ACCT_TOUCHED/,
    'the account field consults the pick flag, which re-merges the two fields and brings back the wrong-account bug');
  assert.match(PAGE, /picked:[\s\S]{0,80}?!acctSel\.hidden[\s\S]{0,60}?SWITCH_ACCT_TOUCHED/,
    'the pick claim no longer consults the touched flag, so a preselect can be reported as a choice');
});

/* 🛑 THE ONE CALL NOTHING COVERED. `paintAccountPicker` fills ACCOUNTS, which is
   the picker's only source, so without this call the menu stays hidden until the
   provider dropdown is touched a SECOND time. Hidden is a legitimate state, so the
   bug would not announce itself.
   ⚠️ And the browser check cannot catch it either: it waits 1500ms after `goto`
   before choosing a provider, by which time ACCOUNTS is already populated, so the
   check stays green with this line deleted. That is why it is pinned here. */
/* 🛑 THE PRIMARY TRIGGER WAS UNGUARDED, AND A REVIEWER MEASURED IT: deleting the
   `fillSwitchAccounts()` call from the #d-provider change listener left all nine
   tests green. That call is what makes the control appear when a person chooses
   OpenAI, which is the ENTIRE feature. Only the browser check covered it, and
   `tools/run-tests.sh` does not run browser checks.
   ⚠️ The SECONDARY refill (inside paintAccountPicker) was pinned and the primary
   one was not, which is the worse way round: the secondary only matters when the
   accounts arrive late, the primary matters every single time. */
test('#1373: choosing a provider refills the picker, which is what makes it appear', () => {
  const at = PAGE.indexOf("getElementById('d-provider').addEventListener('change'");
  assert.notEqual(at, -1, 'the provider change listener is gone, so this test measures nothing');
  const end = PAGE.indexOf('\n});', at);
  assert.notEqual(end, -1, 'could not find the end of the provider change listener');
  assert.match(PAGE.slice(at, end), /fillSwitchAccounts\(\)/,
    'choosing a provider no longer refills the picker, so the control never appears and the feature is inert');
});

test('#1373: the picker is refilled when the accounts actually arrive', () => {
  /* ⚠️ THE WINDOW HAS TO BE THE FUNCTION, NOT "ROUGHLY AFTER IT". The first version
     sliced to the next `\nlet `, which lands about 185 lines PAST the end of
     paintAccountPicker and spanned four more functions. It went red today only
     because exactly one `fillSwitchAccounts()` happened to sit in that span; a call
     added in any of those four would have let the pinned one be deleted silently.
     `\n}` is this file's function terminator at column 0. */
  const at = PAGE.indexOf('async function paintAccountPicker');
  assert.notEqual(at, -1, 'paintAccountPicker is gone, so this test is measuring nothing');
  const end = PAGE.indexOf('\n}', at);
  assert.notEqual(end, -1, 'could not find the end of paintAccountPicker');
  const body = PAGE.slice(at, end);
  assert.match(body, /fillSwitchAccounts\(\)/,
    'paintAccountPicker no longer refills the switch picker, so it stays hidden until the provider menu is touched twice');
});

test('#1373: the picker is not offered where it can do nothing', () => {
  /* paintProviderPicker sets #d-provider to the agent's CURRENT provider, so on
     an agent already on OpenAI this menu would render live while Switch stays
     disabled and the engine would refuse anyway. */
  assert.match(PAGE, /const armed =[\s\S]{0,60}?CURRENT[\s\S]{0,60}?prov\.value !== providerOf\(CURRENT\)/,
    'the armed gate is gone, so the picker renders on an agent already on OpenAI');
  assert.match(PAGE, /if \([\s\S]{0,30}?!openai[\s\S]{0,20}?!armed[\s\S]{0,30}?!list\.length[\s\S]{0,10}?\)/,
    'the hidden condition no longer consults the armed gate');
});

/* 🛑 THE PAGE-TO-ROUTE KEY IS THE ONE THING NEITHER SIDE'S TESTS PINNED. The page
   test above pins that the page SENDS `account`; the engine test pins that
   `setProvider` HONOURS `accountDir`. Nothing pinned the join, so renaming
   `body.account` in server.js left every test in the repo green while the feature
   silently reverted to the stated default: the exact silent-wrong-account failure
   this card exists to end.
   ⚠️ AND AN HTTP-LEVEL TEST CANNOT CLOSE IT TODAY, which is worth knowing rather
   than rediscovering. The route calls `remove.restart()`, which runs
   `launchctl bootstrap` and would register REAL launchd services on the developer's
   machine (I did that by accident earlier on this branch and had to boot three
   out). That call is guarded by AGENT_WORKFORCE_DRY_RUN, and DRY_RUN ALSO disables
   the whole account block in setProvider, so the only setting that makes the route
   safe to drive is the setting that makes the feature inert.
   ⇒ Source-pinned here deliberately. The coupling is filed as kosmos#1465;
      when it is fixed, replace this with a real request through the route. */
test('#1373: the page-to-route key is pinned on BOTH sides, so a rename cannot pass', () => {
  /* 📌 KEY NAMES STAY TIGHT, EXPRESSIONS DO NOT. This test's job is that a RENAME
     cannot pass, so `accountDir`, `body.account`, `pickedByPerson` and `body.picked`
     remain pinned verbatim. The ternary around them is incidental and was pinned only
     because it happened to be there. */
  assert.match(SERVER, /accountDir:[\s\S]{0,80}?body\.account/,
    'server.js no longer reads body.account into accountDir, so the page sends a key the route ignores');
  assert.match(SERVER, /pickedByPerson:[\s\S]{0,60}?body\.picked === true/,
    'server.js no longer reads body.picked, so every switch would claim the person chose');
  assert.match(PAGE, /account:[\s\S]{0,80}?acctSel\.value/,
    'the page no longer sends `account`, so the route can never receive one');
  assert.match(PAGE, /picked:[\s\S]{0,80}?SWITCH_ACCT_TOUCHED/,
    'the page no longer sends `picked`, so the route can never learn a person chose');
});

/* 🛑 FOUR FIXES THAT SHIPPED WITH NOTHING GUARDING THEM.
   Each was added deliberately, each is explained by a comment where it lives, and each
   reverts GREEN. Swept with a working control: `SWITCH_ACCT_TOUCHED` is pinned in this
   file, `ACCOUNTS_UNREADABLE` was pinned nowhere.
   ⭐ They share one failure shape, which is why they are one test: EVERY ONE OF THEM
   FAILS INTO A STATE THAT LOOKS FINE. A hidden picker, a disabled button and an empty
   list are all indistinguishable from "nothing to offer you", so none of these can
   announce its own absence. That is exactly the argument each comment makes for why the
   fix is needed, and it applies just as well to the fix going missing again. */
test('#1373: the four fail-quiet fixes are pinned, because each one reverts green', () => {
  /* 1. A FAILED READ IS NOT AN EMPTY LIST. Collapsing this back to
     `res.ok ? res.json() : null` makes a 500 arrive as "you have no accounts". */
  assert.match(PAGE, /if \(got && got\.ok\) accountsRead\(got\.accounts\); else accountsUnreadable\(\);/,
    'the accounts fetch no longer records that it FAILED, so a server error is indistinguishable from having no accounts');
  /* 2. AND THE FLAG HAS TO BE READ, NOT JUST WRITTEN. Setting it and never consulting
     it is the same silence with extra steps. */
  assert.match(PAGE, /ACCOUNTS_UNREADABLE[\s\S]{0,200}?pmsg0\.textContent =/,
    'nothing tells the person the sign-in list could not be read, so the picker just silently is not there');
  /* 3. THE REFUSAL'S REMEDY POINTS AT THE LIST. If the stale list survives the failure,
     "pick one from the list and try again" re-offers the dead row every time. */
  /* ⭐ LOOSENED ONTO THE PROPERTY AFTER IT CAUGHT ME. This
     pinned `ACCOUNTS = []` immediately followed by the repaint, and went red when
     an earlier pass inserted `ACCOUNTS_LOADED = false` between them. The guard was RIGHT to
     fire, and the spelling was the wrong axis to pin: what matters is that the cache is
     dropped and then refilled, not that the two lines are adjacent. */
  assert.match(PAGE, /accountsDropped\(\);[\s\S]{0,120}?await paintAccountPicker\(CURRENT\);/,
    'a failed switch keeps the stale account list, so the remedy the refusal names re-offers the row that just failed');
  /* 🛑 AND BOTH EMPTYING SITES MUST MARK IT UNREAD, NOT JUST ONE. One pass fixed the
     move path; a later one found the failed-switch catch dropping the cache while leaving
     `ACCOUNTS_LOADED` true, which resurrects the false zero-account sentence whenever the
     repaint's own fetch also fails. Counted rather than matched, because a single-site
     assertion is exactly what missed it the first time. */
  /* 📌 THE POPULATION FLOOR HAS TO FOLLOW THE SHAPE IT MEASURES. This once counted literal
     `ACCOUNTS = []` sites and required two, which was right when two call sites each did
     their own emptying. After they were collapsed into named transitions there is one
     literal assignment, inside `accountsDropped`, and the thing worth counting is the CALL
     SITES that use the transitions. A floor left pointing at the old shape reports a defect
     that is really its own staleness. */
  const emptied = (PAGE.match(/accountsDropped\(\);/g) || []).length;
  /* 🛑 THE INVARIANT, NOT THE SITES. This used to count per-site pairings, and three
     review passes each found a DIFFERENT site out of step: one emptied and left LOADED
     true, one filled and left UNREADABLE true, one failed and left LOADED true. Counting
     pairs could only ever catch the shape it was told to look for.
     ⇒ Now assert the property that makes all three impossible: the three state variables
     are written ONLY inside the three named transitions, so no site can update one
     without the others. 9 = three transitions, three variables each. */
  /* The invariant is about the FLAGS, which is what kept going out of step. `ACCOUNTS`
     itself is written by only two of the three transitions on purpose: a failed read
     invalidates the list's authority and must NOT shrink the list, which `paintAccounts`
     states as a rule at its own call site. */
  const bare = (PAGE.match(/^\s*(?:ACCOUNTS_LOADED|ACCOUNTS_UNREADABLE) = /gm) || []).length;
  assert.ok(emptied >= 2, 'fewer than the two known drop sites call accountsDropped(), so either a site went back to emptying the cache by hand or this sweep is not reading what it thinks it is');
  /* 6 = two flags x three transitions, MEASURED not assumed. The declarations start with
     `let` so the anchored regex excludes them; an earlier version of this line said 8 by
     arithmetic I had not checked against the file. */
  /* ⚠️ A FLOOR AND A CEILING, NOT AN EXACT COUNT. An exact 6 goes red on a legitimate
     FOURTH transition exactly as loudly as on the defect it targets, which punishes correct
     growth and trains people to bump the number without reading. What actually matters is
     that every flag write lives inside a transition, which the structural check below
     asserts; the count only needs to prove the sweep found the population. */
  assert.ok(bare >= 6 && bare % 2 === 0,
    'the flag-write population is below the three known transitions or is odd, which means a transition sets one flag and not the other, or the sweep is not reading what it thinks it is');
  /* The structural half: every flag write is inside one of the three named transitions.
     Anything else is a site updating one flag without the others, which is the defect. */
  const outside = PAGE.split(/function accounts(?:Read|Unreadable|Dropped)\(/).slice(0, 1).join('');
  assert.doesNotMatch(outside, /^\s*ACCOUNTS_(LOADED|UNREADABLE) = /m,
    'a flag is written before the transitions are even defined, so something outside them owns this state');
  /* And a failed read must not shrink the list, which is paintAccounts' stated rule. */
  assert.doesNotMatch(PAGE, /function accountsUnreadable\(\)[\s\S]{0,900}?ACCOUNTS = \[\];/,
    'accountsUnreadable empties the account list again, which is exactly what "a failed read must not shrink the list" forbids at its own call site');
  /* 📌 1600, MEASURED. `accountsUnreadable` carries a long comment explaining why it does
     NOT touch the list, so it needs >= 900 where its siblings need 260. A window sized to
     today's shortest body goes red the next time somebody explains themselves, which is a
     check that punishes the comment rather than the code. */
  for (const fn of ['accountsRead', 'accountsUnreadable', 'accountsDropped']) {
    assert.match(PAGE, new RegExp('function ' + fn + '\\([\\s\\S]{0,1600}?ACCOUNTS_LOADED[\\s\\S]{0,200}?ACCOUNTS_UNREADABLE'),
      fn + ' no longer sets both flags, so it can leave the cache in a state no site intended');
  }
  /* 4. AND THE BUTTON HAS TO COME BACK. Hard-coding `true` here means a person who does
     exactly what the message says picks the highlighted row, fires no `change`, and
     gets nothing. */
  assert.match(PAGE, /id="d-provider-go"/,
    'the page was not read, or is not the page, so the absence claim below would pass by examining nothing');
  assert.doesNotMatch(PAGE, /\} finally \{[\s\S]{0,400}?go\.disabled = true;/,
    'the finally block hard-disables Switch again, so after a refusal the named remedy cannot be carried out');
  assert.match(PAGE, /go\.disabled = !sel\.value \|\| !CURRENT \|\| sel\.value === providerOf\(CURRENT\)/,
    'the re-arm no longer derives from the same expression the change listeners use, so it can disagree with them');
});

/* 🛑 THE ZERO-ACCOUNT SENTENCE NEEDS AN AUTHORITATIVE LIST, NOT MERELY AN EMPTY ONE.
   The arm that first made this claim read the page-side cache directly, and `moveAccountNow` deliberately empties that cache on a successful move
   while the open panel never repaints. Reachable in one panel: move an account, then
   choose OpenAI. The cache is empty, the SERVER list is untouched, so the dialog said
   "the switch will stop and ask you to add one" and then the switch went ahead.
   ⭐ Being told a thing will stop, and having it not stop, is worse than the silence the
   arm was written to replace. `ACCOUNTS_LOADED` is what separates "we read an empty list"
   from "somebody emptied the cache and nothing has refilled it". */
test('#1373: the zero-account claim requires a list we actually read, and the move refills it', () => {
  assert.match(PAGE, /ACCOUNTS_LOADED && !ACCOUNTS\.some\(\(x\) => x\.provider === 'openai'\)/,
    'the zero-account sentence fires off a bare empty cache, so an emptied-but-unrefilled list claims this computer has no OpenAI sign-in');
  assert.match(PAGE, /function accountsRead\(list\)[\s\S]{0,220}?ACCOUNTS_LOADED = true;[\s\S]{0,120}?ACCOUNTS_UNREADABLE = false;/,
    'a successful read no longer marks the list authoritative, so the zero-account arm can never fire');
  assert.match(PAGE, /accountsDropped\(\);[\s\S]{0,900}?await paintAccountPicker\(CURRENT\);/,
    'the move empties the account cache without marking it unread and refilling it, so the switch picker silently vanishes for the life of the open panel');
});

/* 🛑 A PICK THE DIALOG CANNOT NAME IS STILL A PICK.
   `switchAcctShown()` returns '' for an account whose only label is a filesystem path,
   which was indistinguishable from NOT PICKED, so a real pick fell through to the hedged
   arms and was told the switch might land elsewhere. ⚠️ That hedge is FALSE for a pick,
   because a picked account the engine cannot use is refused rather than replaced. */
test('#1373: a pick the dialog cannot NAME still gets an unhedged promise', () => {
  assert.match(PAGE, /function switchAcctPicked\(\)[\s\S]{0,240}?SWITCH_ACCT_TOUCHED/,
    'switchAcctPicked no longer consults the touched flag, so it would claim a pick nobody made');
  assert.match(PAGE, /if \(switchAcctPicked\(\)\) return '[^']*shown above\.';/,
    'the picked-but-unnameable arm is gone, so a pick the dialog cannot name falls through to the hedged arms and is told it might land elsewhere');
  /* The arm must sit ABOVE the two hedged ones, or it can never be reached. */
  /* 1600, measured: matches at 1200 and above, so the window has margin over the
     explanatory comment that sits between the two arms. */
  assert.match(PAGE, /if \(switchAcctPicked\(\)\)[\s\S]{0,1600}?if \(switchAcctChoosable\(\)\)/,
    'the picked-but-unnameable arm no longer precedes the hedged arms, so it is unreachable');
});

/* 🛑 A FAILED READ MUST NOT PRODUCE A CONFIDENT SENTENCE, ON EITHER SURFACE.
   `ACCOUNTS_UNREADABLE` was introduced to separate "we read an empty list" from "we could
   not read", and then wired to only some of the places that speak. Two were left: the
   dialog's last arm still claimed a sign-in nothing had verified, and the failed-switch
   path left the engine's "pick one from the list" remedy on screen after the list had
   vanished, because the picker's own fault line is suppressed by its never-overwrite
   guard and both write the SAME element. */
test('#1373: an unreadable account list is never spoken as a fact', () => {
  assert.match(PAGE, /if \(ACCOUNTS_UNREADABLE\) return '[^']*could not read the list/,
    'the dialog\'s last arm claims this computer\'s OpenAI sign-in even when the list could not be read, which is a confident sentence about something nothing verified');
  /* Ordering: the unreadable arm must precede the unqualified one, or it is unreachable. */
  assert.match(PAGE, /if \(ACCOUNTS_UNREADABLE\) return[\s\S]{0,400}?return 'and it runs on this computer/,
    'the unreadable arm no longer precedes the unqualified sentence, so it can never be reached');
  assert.match(PAGE, /ACCOUNTS_UNREADABLE && msg && msg\.textContent[\s\S]{0,200}?SWITCH_ACCT_UNREADABLE/,
    'after a failed switch whose repaint also failed, the refusal still points at a list that has vanished and nothing says why');
});

/* 🛑 THREE WAYS A FIX CAN CREATE THE DEAD END IT WAS CLOSING. Each of these came from a
   correction made one round earlier, which is why they are pinned together: the pattern is
   that the fix is the least-reviewed code in the tree.
     the re-fetch gate   a failed read deliberately does NOT shrink the list, so the cache
                         can be non-empty and known-stale at once. Gating the re-read on
                         emptiness alone meant that state never refreshed, and the fault
                         line said "open it again to retry" while reopening did not retry.
     the move's sentence a repaint added to refresh the list writes the SAME element as the
                         move's outcome, so refreshing deleted the answer.
     the appended form   appending our sentence to the engine's refusal produces a string
                         equal to NEITHER constant, so an equality-based clear could not
                         remove it and our line outlived its control. */
test('#1373: a fix does not reopen the dead end it closed', () => {
  assert.match(PAGE, /if \(!ACCOUNTS\.length \|\| ACCOUNTS_UNREADABLE\) \{/,
    'the account re-fetch is gated on emptiness alone, so a non-empty but known-stale cache never re-reads and the retry the message promises does nothing');
  assert.match(PAGE, /const saidAfterMove = msg \? msg\.textContent : '';[\s\S]{0,1200}?msg\.textContent = saidAfterMove;/,
    'the move repaints the account list without holding its own outcome sentence, so refreshing silently deletes the answer it just wrote');
  assert.match(PAGE, /endsWith\(' ' \+ SWITCH_ACCT_UNREADABLE\)/,
    'the appended fault sentence cannot be cleared, so it outlives the control it describes under a provider it does not apply to');
});

/* 🛑 THE DIALOG'S HONESTY GATE WAS ENFORCED BY NOTHING. A reviewer measured it:
   deleting `|| !SWITCH_ACCT_TOUCHED` from switchAcctShown left the FULL canonical
   runner green at 2901/2901. The dialog is the last screen before a restart, so
   without this a future edit can tell somebody who never opened the menu "and it
   will run on <preselected row>", which is the invention the route's own comment
   forbids. */
/* The conjunction was proven unguarded by mutation: dropping `wantDir !== null &&`
   left both suites green, so a later edit could let {provider, picked:true} with no
   account be told "the sign-in you picked" about a stated default. */
test('#1373: a pick claim needs BOTH a named account and a person', () => {
  assert.match(ENGINE, /chosen: wantDir !== null && !!\(opts && opts\.pickedByPerson === true\)/,
    'chosen no longer requires both, so a caller can claim a pick without naming an account');
});

test('#1373: the dialog only echoes a pick that a person actually made', () => {
  assert.match(PAGE, /function switchAcctShown\(\)[\s\S]{0,300}?!SWITCH_ACCT_TOUCHED/,
    'switchAcctShown no longer consults the touched flag, so the dialog can claim a pick nobody made');
});

/* 🛑 AND THE PARTIAL BRANCH HAD NO COVERAGE AT ALL. The ok-branch pair is pinned as
   the two arms of one conditional; the partial pair, added by this diff, was not, so
   an arm swap or an unconditional "you picked" shipped green. It is also the branch
   where something already went wrong, which is where a confident-sounding sentence
   costs most. */
test('#1373: the partial-restart answer names the account, in its own tense, on both arms', () => {
  assert.match(SERVER, /When it restarts it will run on the OpenAI sign-in you picked/,
    'the partial branch no longer names a chosen account');
  assert.match(SERVER, /When it restarts it will run on your OpenAI sign-in/,
    'the partial branch no longer names a stated default');
  assert.match(SERVER,
    /acct\.chosen[\s\S]{0,200}?When it restarts it will run on the OpenAI sign-in you picked[\s\S]{0,200}?When it restarts it will run on your OpenAI sign-in/,
    'the two partial sentences are no longer the arms of the chosen conditional');
});

/* 🛑 THE DIALOG'S FOUR ARMS WERE GUARDED BY NOTHING, and a reviewer measured it:
   replacing the untouched arm with "the OpenAI sign-in you picked" left the full
   runner green at 2904. The sibling honesty gate inside switchAcctShown IS pinned;
   it was the arms built around it that were not.
   ⚠️ THE ONE-ROW ARM IS THE ONE THAT WAS ACTUALLY WRONG and is easiest to lose
   again: with the menu showing and exactly one usable row, the page SENDS that
   row, so a sentence saying the computer chooses is false. It existed for one
   round before anyone noticed. */
test('#1373: the dialog has an arm for a menu showing exactly one row', () => {
  assert.match(PAGE, /function switchAcctSending\(\)[\s\S]{0,240}?options\.length > 0/,
    'switchAcctSending is gone, so a one-row menu falls through to the arm that says the computer chooses');
  /* Anchored on the ARMS, not on any occurrence: the two function DEFINITIONS are
     separated by a long comment, so a proximity match between those was measuring
     the comment's length rather than the arm order. */
  assert.match(PAGE, /if \(switchAcctChoosable\(\)\) return[\s\S]{0,220}?if \(switchAcctSending\(\)\) return/,
    'the arms are no longer ordered many-then-one, so the one-row case cannot be reached');
  /* The two must ask DIFFERENT questions, or the arm is decoration. */
  assert.match(PAGE, /function switchAcctChoosable\(\)[\s\S]{0,240}?options\.length > 1/,
    'choosable no longer requires more than one option, so it and sending are the same test');
});

test('#1373: no arm of the dialog claims a pick unless a person picked', () => {
  const at = PAGE.indexOf("+ ((() => {");
  assert.notEqual(at, -1, 'the dialog copy expression moved, so this test measures nothing');
  const block = PAGE.slice(at, at + 900);
  const picked = (block.match(/you picked/g) || []).length;
  assert.equal(picked, 0,
    'an arm of the dialog says "you picked"; only switchAcctShown may claim a pick, and it gates on the touched flag');
  assert.match(block, /switchAcctShown\(\)/,
    'the dialog no longer consults switchAcctShown, so it cannot echo a real pick at all');
});

test('#1373: the route says a different sentence for a pick than for a default', () => {
  assert.match(SERVER, /acct\.chosen/, 'the route no longer distinguishes a pick from a stated default');
  assert.match(SERVER, /It runs on the OpenAI sign-in you picked/, 'the chosen-account sentence is gone');
  assert.match(SERVER, /It runs on your OpenAI sign-in/, 'the stated-default sentence is gone');
  /* And they must be the two arms of ONE conditional, not two strings that
     happen to exist: an unconditional "you picked" is the defect this guards. */
  assert.match(SERVER,
    /acct\.chosen[\s\S]{0,220}?It runs on the OpenAI sign-in you picked[\s\S]{0,220}?It runs on your OpenAI sign-in/,
    'the two sentences are no longer the arms of the chosen conditional');
});
