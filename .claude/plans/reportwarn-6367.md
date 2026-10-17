# reportwarn-6367: Remove this computer says the company will see it stop reporting (kosmos#6367, slice 2)

Card: kosmos#6367 (enforce Reporting required). Design, decided on the card (comment 6234168812):
- reporting is the daily rollup arriving;
- a work Kosmos has no switch that turns reports off, so nothing is refused;
- the enforcement is what the admin sees, in the console slice, built after #6365 merges;
- this slice is the member-side warning.

## What changes
- `engine/orgpolicy.js` `reportingRequired(policy)`: true only when `telemetry.required === true`. With no argument it
  reads `current()` (a plain read, no signature check, never throws out). No policy, the key unset, or a non-boolean
  value: false.
- `server.js` `GET /api/org`: adds `reportingRequired`, for the enrolled Kosmos only (false otherwise). The agents' view of
  /api/org (not the screen) is unchanged: it returns earlier with only `enrolled`.
- `web/index.html` Kosmos+ pane: the Remove this computer confirm has a new line, `#plus-forget-required`, hidden by
  default. `plusForgetArm(true)` fills it from `PLUS_ORG.state` when the state is enrolled with `reportingRequired`:
  "Your company requires this computer to report to it. Once it is removed, it stops reporting, and your company will
  see that." For a family, "family" replaces "company" (plusOrgIn). Closing the confirm hides it.

## Rejected
- Refusing Remove while reporting is required: it is the person's computer, and quitting Kosmos stops reports too.
- `inForce()` for the read: it runs a signature check, and /api/org is read once a minute. The policy is applied
  hourly by the enrollment refresh either way.

## Weakest premise
`PLUS_ORG.state` is at most a minute old, so a policy changed in the last minute shows the previous answer in the
confirm. Accepted: it is a warning, and the policy itself reaches the board only hourly.

## Checks
- `web.plus-forget-required-6367.test.js`: the engine's reading (true only for exactly true), /api/org's field (a
  source pin), the confirm line for a company, a family, and five states that say nothing, hidden on close, and its
  place in the markup. Three mutants, each failing one test: dropping the enrolled check, a truthy read, and a line
  never shown.
- `server.orgenroll-5531.test.js`: the exact /api/org shape now includes `reportingRequired: false`.
- Static set 3336/3336; org server tests 61/61; both browser-check gates pass (a `Browser-check:` trailer: the line is
  hidden unless enrolled under the policy, which no browser check stands up).

## Round 1 (Opus), applied
- "Stops reporting" only while this Kosmos reports now (`st.reporting === true`). Not reporting yet (family words to
  accept, waiting for its print, words naming no reports): "Once it is removed, it cannot report." That is true
  either way.
- A read of /api/org that lands while the confirm is open fills the line (plusOrgMaybe calls plusForgetRequiredPaint).
  Before, pressing Remove before the pane's first read left the confirm without the line for as long as it stayed open.
- A behavioural /api/org arm in server.orgenroll-5531.test.js: the applied policy file says required, then not, then
  the enrollment names another world. Mutants: always "stops", no refresh on read, server always false. Each fails.

## Round 2 (Sonnet)
- Removed the /api/org source pin: the behavioural arm in server.orgenroll-5531.test.js covers it, and a pin of the
  spelling fails on a harmless rewrite.
- Declined: "after a join the state lacks reportingRequired for up to a minute". Both join paths set PLUS_ORG.at = 0
  and call plusOrgMaybe() at once (web/index.html, the enroll and family-accept handlers), so the full state is read
  straight away.
