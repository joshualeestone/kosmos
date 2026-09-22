# projectcreate-instr-3405 -- tell agents they can create a project (#3405)

## What Josh asked
Josh, 2026-09-22 in #chaoskosmos-design, after talking to an agent in its
direct dialogue: the agent could not make a project itself. "Is that something
we could add into their instructions on how to be able to create projects
(whatever the endpoint is)?"

## Two halves, this is the second
- Engine (Angel, done): the `kosmos project create` CLI verb, PR #3408, merged
  66b043e3. Wraps `POST /api/projects` with the same address+token resolution as
  `kosmos post`; valved 12/hr for agents (#327).
- Instructions (this, mine): the paired line in the default agent-instruction
  block so agents know the capability exists.

## Change
`engine/defaults.js` is the doctrine block Kosmos bakes into every created agent
(and re-offers to the existing fleet via the #539 refresh). It already documents
`kosmos post`/`msg`/`react`/`report`/`reply`.

- Add a new `### Making a project` section documenting
  `kosmos project create "Name" /path/to/folder ["desc"]`: folder holds the
  project's files, description optional, it prints the new id or the reason it
  could not (e.g. the hourly cap).
- A NEW HEADING deliberately: `missingFrom` matches by heading, so the #539
  refresh re-offers the section to agents that already exist (the fleet Josh is
  talking to), not only new ones. Same delivery reason as versions 5/6/7/8 and
  the entry-8 "### Where the files you make go" section.
- The #539 pairing guard ceremony: `DOCTRINE_VERSION` 10 -> 11, a version-log
  entry (11.) in defaults.js, and the new block fingerprint `7264c62fb8605bcc`
  pinned in `engine/defaults.test.js`.

## Verification
- `engine/defaults.test.js` + `engine/doctrine.test.js` + `engine/create.test.js`:
  193 pass, 0 fail (the pairing guard, content matches, and the doctrine em-dash
  guard all hold; block contains the section and the verb; no em/en dash).
- Collision: 6 remote branches touch defaults.js but all are stale (their
  content -- entries 8/9/10, the #539 infra, the various sections -- is already
  in main; none bumps to v11 or adds this section). Branch is off current
  origin/main, so it merges clean.

## Scope guard
Copy-only: one new instruction section documenting a verb Angel already built
and verified, plus the mandatory version/fingerprint ceremony. No behavior
change. Not money-moving, not public under Josh's name. Rides 0.6.89 alongside
#3408.
