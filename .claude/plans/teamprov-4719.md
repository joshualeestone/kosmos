# teamprov-4719: one provider and account for the whole prebuilt team

Card kosmos#4719 (found by #4557's blind review; the call is on the card). Built on
teamcreate-ui-4557 (PR #4709); rebased onto main after #4709 merged (e65e899d, 2026-10-01). The review loop
recorded below ran on the stacked base; a fresh loop runs on the rebased branch (see "After the rebase").

## What changes
- engine/teamseed.js `specs`: optional `provider` and `account`, carried by every member's spec the
  way the single-agent form sends them (provider only when not Anthropic, account only when chosen).
  A provider that is not a plain name (letters, digits and hyphens, read after trimming and lowercasing) is refused before anything is made. POST /api/agents
  still checks both, per member, so a bad account is refused with a reason on that member's row.
- server.js: the specs route passes them through.
- web/index.html: the team step has a Model menu and an account menu (the account row only at two or
  more accounts, #2097). fillCreateAccounts takes the element ids (the create form's by default), so
  both screens are filled by the same rules; the provider list is copied from the create form's own
  select, so they cannot drift; the Gemini-subscription and Meta Muse repaint loops include it. The
  team step reads the account list itself when the create form has not (openTeamCreate can be reached
  directly), and applies the form's default (OpenAI when it is the one usable provider). The choice is
  fixed when the team starts (TC.model) so a Try again makes the member on the same account, and the
  menus are disabled from then on.

## Calls
- One choice for the whole team, not per member (the card's call; per-member is a second card).
- Reuse, not a copy, of the create form's picker logic.
- Weakest premise: that the create form's current provider is the right starting point when both
  providers are usable; it follows the form's own default rule, which is what the person already sees.

## Measured
- On the stacked base: engine/teamseed.test.js 20/20 (3 new), teamcreate-structure 14/14,
  server.teamseed-4557 6/6, all web tests + wiring 2234/2234. Rebased onto main (2026-10-01): teamseed 26/26,
  team 16/16, server.teamseed 10/10, teamcreate-structure 7/7, teamprov-settle 9/9, team-route 19/19.
- Browser check render-teamcreate-4557 gains the #4719 arm (an OpenAI-only board makes the team in one
  press, every member on OpenAI and that account); it runs in PR CI.

## Review iteration 1 (changes)
- Meta Muse is offered on the team step (paintMuseOption treats tc-provider as a creating select), and
  a choice copied from the form that is not usable here falls back after the paint, not before.
- tcFillProvider takes the open's generation and does nothing if another team was opened while its
  account read was out.
- A failed account read sets CREATE_ACCOUNTS_FAILED, so Gemini and Grok say they could not check.
- The choice is fixed at the click (TC.model) and the menus disabled then; a click that is refused
  before anything is made (a name) opens them again. The refusal arm of the browser check pins that.
- Not changed (NITs, recorded): the team menus do not refresh if the account list changes after the
  step opened (a removed account is refused per member, visibly); the #3081 saved last-used provider
  is not applied on the team step (it starts from the form's current value, changeable).

## Review iteration 2 (changes)
- The copied provider options carried the create form's Swarm gating (OpenAI greyed "Swarms run on
  Claude for now" after a Swarm visit); the copy undoes it from the gate's saved state and starts from
  the form's choice before the gate moved it.
- The team step's own /api/accounts read is bounded to 5 s (it holds the button until it answers).
- The refusal arm now sees the menu lock at the click before asserting it is open again.
- Not changed (NIT, recorded): tc-provider is a plain select, so a greyed option's reason shows as the
  option's own text only, not the create form's enhanced combobox pill.

## Review iteration 3 (changes)
- A read of /api/accounts slower than the 5 s wait is no longer abandoned (on an OpenAI-only machine it
  left the team on Claude): when it lands, the untouched menu gets the default again, unless the team
  started. Browser arm: a late answer (8 s) moves the menu from Claude to OpenAI and its account.
- A Muse answer that disables Meta settles the team menu too (tcProviderSettle), so a Meta pick that is
  no longer allowed goes back to the default before anything is sent.
- The Swarm-undo comment says it is defensive (openCreate resets the Kind first).

## Review iteration 4 (changes)
- MAJOR (mine, from iteration 3): tcProviderSettle ran on every Muse answer; on an unopened team step
  the empty menu read as "unusable", refilled (which asks Muse again), and the answer settled again: a
  permanent /api/muse loop on every board with Muse on. Settle now acts only on an open, filled team
  step of an unstarted team, with a re-entry guard. web.teamprov-settle-4719.test.js pins it (the old
  guard fails its "no open team step" test).
- A late account list replaces only the plain default the step started on, never a choice copied
  from the create form.
- openTeamCreate starts the create form's own /api/accounts read too, so the step's read is mostly a
  duplicate (bounded, accepted); the browser check's claims no longer say which read supplied the list.
- The slow arm's margins widened (8 s answer, 10 s wait).

## Review iteration 5 (changes)
- A late account list now always refills the untouched menus (the accounts and which providers are
  usable); only the provider value is limited to replacing the plain default. Before, a choice copied
  from the form (OpenAI, say) kept an empty account menu and greyed Gemini/Grok after the list landed.
- Not changed (NITs, recorded): the create form's read and the step's read both write the shared
  account globals (last wins; matters only if one fails after the other succeeds); a non-string
  account is dropped rather than refused (POST /api/agents validates it anyway).

## Review iteration 6 (changes)
- The choice is fixed once any member exists (tcAnyMade), not at the start: a start whose lead was
  refused (a stale account, a provider with no sign-in; the name check does not validate these) left
  the menus locked on the bad choice, so Try again could only resend it. Now the menus open again until
  something is made, and the next run uses what they say. The lead-refused browser arm pins both halves.
- The menus are disabled during the up-to-5 s account wait (they held the last team's options).
- The Google-subscription (Antigravity) answer settles the team menu too, as the Muse answer does.

## Review iteration 7 (changes): one rule instead of several conditions
- Two MAJORs in iteration 6's logic: after a first start whose lead was refused the menus stayed locked
  (the click handler cleared busy without repainting), and a Try again run did not count as a run, so a
  menu changed mid-run could split the team or show a provider the team is not on.
- Cause: the lock, the remembered choice and the settle each had its own condition. Now ONE rule,
  tcChoiceFixed(): during a click (busy) or a run (running), or once any member exists or may exist
  (made, maybeMade). The lock, tcModel, the settle and the late read all use it; a menu change while
  the choice is open drops the remembered one; the click handler repaints when it ends.
- Tests: the rule's own unit test (7 cases); the lead-refused browser arm now changes the menu after
  the refusal and asserts the retry and every later member are made on the new choice.

## Review iteration 8 (changes)
- The remembered choice (TC.model) is used only once a member exists (tcMemberExists). Before that the
  menus are read, and they are locked for a click or a run, so a run reads one answer. This removes the
  need to keep TC.model fresh: a settle or a late account list that changed a menu had left a stale one
  that a Try again run then used. The change listeners and the click no longer clear it.
- A comment in tcProviderSettle says why no loop follows its refill (the default is never disabled).
- Test: tcModel with a stale remembered choice and nothing made reads the menus (fails with the
  iteration-7 condition restored); with a member made it returns the remembered one.

## Review iteration 9 (changes)
- A late account list that lands during a click or a run is kept (TC.lateAccounts) and applied when
  the choice is next open (tcPaint calls tcApplyLateAccounts), instead of being dropped for good.
- A provider that is not text is refused by the engine, not read as "none".
- ACCEPTED, recorded (MINOR): `maybeMade` (a create whose answer was lost, #4557's adoption logic)
  keeps the choice locked even if that member turns out not to exist and its retry is refused.
  It takes a dropped create that did not land, then a refused retry, then the agent not showing on the
  board; the way out is another team or a reload. Clearing maybeMade sooner would lose the adoption
  of a create that is still landing, which is the worse failure; that logic is #4557's.
- NIT, recorded: a disabled selected option can survive Back and reopen of a live team (the step is
  hidden, so nothing settles it); the server refuses it per member, visibly.

## Review iteration 10 (changes)
- A late account list also refills menus the person already touched (it was skipped, leaving the
  account menu on its placeholder): their provider is kept, and their account when the list still
  offers it.
- tcApplyLateAccounts has its own unit tests (kept while fixed, applied when open, never moving a
  copied or chosen provider, the chosen account restored); removing the restore fails one.

## Review iteration 11: converged (NITs only, recorded, not changed)
- tcFillProvider's 5 s wait watches only the step's own read; if the list becomes known from the
  create form's read first, the step still waits for its own or the timeout.
- The settle's no-loop argument needs #create-provider to carry both anthropic and openai options;
  a guard (return when the default is not among the options) would make that explicit.
- A #245 comment near the create form's POST says no account is sent on OpenAI; both the form and the
  team step send it. Pre-existing, not from this change.

## After the rebase onto main (2026-10-01)
- Review 1 found a BLOCKER: tcProviderSettle read `cstep-team`, which on main is the team chooser screen; the menu
  lives on `cstep-teammake` (#4557's final shape), so the guard returned early and nothing ever settled. Fixed, and
  web.teamprov-settle-4719.test.js now ties the id to the markup (the step must contain #tc-provider; control: the
  chooser does not). The stub had the same wrong id, which is why the test passed.
- The settle stops when the default is not usable either (a guard, in place of a comment claiming it never is).
- Review 2 (WARNINGs, fixed in c1253e477): menus stay disabled through tcFillProvider's 5 s account wait (TC_FILLING
  counts, so a second team opened during the first one's wait does not unlock early); the settle test reads the page
  by __dirname; server.teamseed-4557.test.js gains a route test (provider/account land in each member's spec.spec;
  control: absent without them).
- Review 3 (opus, fresh): NO NEW FINDINGS (47/47 across the three focused files). One wording point taken: line 10
  said "plain lowercase name", but the engine trims and lowercases first, so " OpenAI " is accepted; reworded.
- Converged after the rebase. Deferred and accepted: the menus read blank for up to 5 s while accounts load (matches
  the single-agent form).
