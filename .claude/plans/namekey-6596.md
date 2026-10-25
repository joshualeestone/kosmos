# namekey-6596 (board): a key the connector names under the shipped list is not offered (kosmos#6596 follow-up)

Pairs with kosmos-relay namekey-6596, where the connector names a key it refuses for not being on the list it was
handed. Under the shipped list (production, a verified set shipped) the board's Accept is refused anyway
(acceptOfferedKey), so `withKeyChange` does not offer it there.

## Review 1 (fixed)
- Under the shipped list the refusal's words now carry that list's meaning ("not on the signed list that came with this
  version of Kosmos ... Something may be posing as the Kosmos+ service"), never the raw key: the connector cannot tell
  the shipped list from the board's own (the pin and an accepted key), and the board can.
- "Under the shipped list" is decided when the registration STARTS (setupRun records shippedList beside the list it
  hands over), not read again when it ends: a setting that changed in between could otherwise offer a key refused
  against the shipped list.
- Note: .claude/plans/acceptkey-6596.md (merged) still describes the connector's earlier words; it is the record of that
  slice as built.

## Tests
engine/acceptkey-6596.test.js: the connector's own words naming a key; with no shipped list it is offered (control),
under the shipped list it is not, with the shipped list's words and no key; and a run that starts under the shipped list
whose setting changes while it is out still offers nothing. 19 pass with the route tests. Arms: N1 the setting read
again at the end, N2 the shipped-list branch removed, N3 the raw words kept: each red on its own test.

## Review 2 (fixed)
- The shipped-list words were keyed on a NAMED key and came after the held-set return, so in the usual production state
  (a shipped list beside a held signed set, where the connector names no key) the person got the connector's neutral
  words and lost the warning. Now keyed on the connector's sentence ("not on the list of keys this computer expects",
  NOT_LISTED_WORDS, the board's copy of the connector's words), before the held-set return. Test: a shipped list with a
  held set and an unnamed refusal gets the shipped list's meaning; control without the list.
- Arms: N4 (the check after the held-set return) and N5 (keyed on a named key again) red on that test; N1b (the
  setting read at the end) at first SURVIVED, because the later branch still used the start-time flag to block the
  offer and the start/end test asserted only "no offer"; that test now also asserts the words, and N1b is red.

## Review 3: no real bug; three lows taken
- The later guard (a key named in other words under the shipped list) had no test once review 2 moved the not-listed
  check ahead of it, so plan arm N2 no longer held for it: new test (REFUSAL words under the shipped list: not offered;
  control without it: offered); arm N2b (the guard removed) reds it.
- One read of the shipped list per run: setupRun reads it once and hands it to setupEnv, so shippedList and the list
  the connector is handed cannot disagree.
- NOT_LISTED_WORDS is now the connector's whole sentence ("..., so nothing was registered"), so less echoed service
  text can match. It narrows, not closes: a service could still send those words; the branch only changes wording.
- Tests: 21 pass.
