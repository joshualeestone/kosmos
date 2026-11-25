# whatsnew-0824: the What's New list for 0.8.24

0.8.23 reached staging and was held from prod (fleetbuilders m6672): its create check refused every agent on the
default Claude account (#9031, fixed by createdead-9031). 0.8.24 carries that fix, so this is 0.8.24's list.

Built with `node tools/whats-new-pool.js build 0.8.24` (online) on origin/main fdac85902d.

## What the build did
- Prod still serves 0.8.22 on the Mac and Windows, and the pool already records both, so nothing was marked shown.
- The window is unchanged from 0.8.23's: its five pending highlights (ranks 8 to 11) still lead. Only the version
  moves to 0.8.24.

## Pool additions
Read from each PR's description of what changes for the person, or from its code where that was unclear.
- **A closed question says who closed it** (#9011 part 1, PR #9044, rank 12, since 0.8.23). For 12 hours, the hover
  and screen reader text of the status pill say when and how an agent's own question was closed. It is user-facing,
  but it ranks below the five already pending, so it waits for the next window.
- **An expired Claude login is said** (#9031, PR #9051, rank 12.5, since 0.8.23). In Renet Tilley's words for what
  #9031 still does once createdead-9031 lands (m6678): the card shows a sign-in issue, kosmos accounts says the login
  has expired, and agents are not moved onto it. It no longer changes creating an agent or Check now.
- **An old sign-in message no longer misleads** (#9038, PR #9061, rank 13, mac, since 0.8.23), in Renet's words.
- Both rank below the five pending, so they wait for the next window. If Renet's review of #9031 and #9038 finds the
  same trap in either, its line comes out before the cut.
- notesOnly: **A wait outlives a /clear** (#9049 PR #9059, #9057 PR #9066, #9058 PR #9073, #9048 PR #9056). An agent
  is reminded of its own wait after a /clear or a late resume, twice; a reopened Grok or Gemini session keeps it
  (#9056, review 1).
- notesOnly: **kosmos community following** (#9017 slice 1, PR #9071).

## Not added
- #9070 (PR #9072): a small correction to what a refusal says.
- #9016 phone half (PR #9052) and #8959 B2 (PR #9047): the iPhone app, which ships through TestFlight.
- #9026 (PR #9055), #9018 (PR #9046), mobile-shots (PR #9062): release and test tooling.

## Checks
- `whats-new-check.js 0.8.24 --platform=mac` and `--platform=windows`: exit 0 (mac 5, windows 3). The check takes no
  `--platform=linux` (exit 2); Linux shows the untagged highlights.
- New lines are within the window's limits (title up to 48 characters, line up to 140), with no em dash.

## Weakest premise
That #9044's wording ("whether the agent or something else closed it") matches every case the pill names. It is
read from the PR's list of cases, not seen on a card.
