# apostrophe-8784: agent names with an apostrophe

Card: kosmos#8784 (Josh, 2026-11-19 20:39: "we need to be able to support apostrophes in agent names"). A new Kosmos
Cloud user's first agent, "<Name>'s Coach" typed on the iPhone app, was refused.

## Reproduced (main, 20:4x CST)
`create.createAgent` refused "Taylor's Coach" and "Taylor's Coach" (curly, what iOS types) with "use letters, numbers,
hyphens and underscores, starting with a letter or number"; "Taylors Coach" was created. Cause: `slugFor` folds spaces
and periods to hyphens but left the apostrophe in the machine name, and NAME_RE refused it. Every platform and both
apps reach this one function; the board page and the iOS app validate nothing themselves (iOS trims and checks
non-empty only, NewAgentLogic.swift).

## Change
- `engine/create.js` slugFor: an apostrophe, straight or curly (' U+2018 U+2019), is DROPPED from the machine name.
  "Taylor's Coach" is shown as typed and is `taylors-coach` to the folder, session and launch script.
- nameProblem: a LEADING apostrophe is refused (as a leading period is), so the display name still starts with a
  letter or number in the boot file; the refusal sentence names every character a name may hold.

## Decided
- Dropped, not folded to a hyphen like the period: it sits inside a word ("taylor-s-coach" names no one).
- Safe from silent collision: every spelling lands on one machine name, so a second spelling is refused as "there is
  already an agent called ...", by name.
- Safe in the boot file: the apostrophe reaches it only as literal markdown prose in "You are **Taylor's Coach**".
  create.test.js's boot-file invariant is widened by exactly the apostrophe; every other character in its dangerous
  alphabet must still be refused.
- `kosmos msg` keeps resolving the session name only (#989's strictness), as for any spaced name; not widened here.
- The create result's `name` is the machine name and `shownAs` the typed name, which is what the iOS app reads
  (it checks `name` with PushBridge.isAgentSession).

## Tests
`engine/create.apostrophe-8784.test.js`: each form's machine name; leading apostrophes refused; create succeeds, the
agent is told its name as typed, `name`/`shownAs` as the app reads them, and no file other than JSON and the agent's
instructions carries the typed name (control: it was written somewhere); a second spelling refused as taken. With
main's create.js all 3 fail. `engine/create.test.js` invariant updated. 50 create and slugFor test files run: only
that invariant needed the change.

Weakest premise: that dropping is better than refusing for a name whose meaning the apostrophe changes; no such pair
exists in practice beyond possessives. What would change my mind: a person who wants "Taylor's" and "Taylors" as two
agents.
Not done here: seeing it on a served build from the board and the iPhone app, messaging it and restarting it.

## Review 1 (Opus)
- No BLOCKER. Measured by the reviewer: no lookup that now drops an apostrophe can reach a different agent (every caller
  of slugFor/nameProblem traced); the typed name reaches no runner call; reserved names stay refused.
- WARNING fixed: the boot-file invariant in create.test.js did not try the curly forms, so it no longer covered what
  the code accepts. Its alphabet now has U+2018 U+2019 U+02BC U+02BB U+FF07 (accepted) and U+2032 U+00B4 (refused).
- WARNING fixed: apostrophes a keyboard types beyond the three were refused with a sentence that says apostrophes are
  allowed. One set, APOSTROPHES, now drops ' U+2018 U+2019 U+02BC (Ukrainian layouts) U+02BB (okina) U+FF07
  (fullwidth); the backtick (shell-active), the prime and the acute stay refused, pinned both ways.
- WARNING fixed: the second-spelling test made its own first agent (it leaned on the test above; it now passes alone).
- NIT fixed: "there is already an agent called X" names the existing agent as the board shows it (spokenName), not the
  spelling typed. The three sibling leftover sentences (a folder, a job, a running session) keep the typed name: those
  leftovers usually have no profile, so there is no other name to give.
- NIT fixed: the slugFor docblock no longer says it strips nothing.
- NITs kept: "'" alone reads "give the agent a name"; a long run of apostrophes is as accepted as a long run of spaces
  already was (create has no display-name cap, rename caps at 80: not new here); the org chart's client-side
  suggestion folds to "taylor-s-coach" (a suggestion the server rules on); the no-shell-file check covers the
  platform the test runs on.
- Ran the 13 test files that pin the "already an agent called" wording, create.test.js included: 452 tests, 0 failed.
