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
