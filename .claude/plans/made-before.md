# made-before: #149 + #150, an agent with no launch file says so instead of "Unknown Model"

## The defect, in one sentence

For an agent Kosmos has no launch file for (made before the registration flow,
or the dev fleet's hand-started agents), the board says "Unknown Model" and the
memory panel says "we cannot find a transcript for it", which collapses "there
was never anywhere to look" into "we looked and the field was empty", and
nothing anywhere says how to fix it or that waiting will not.

## What finished looks like (from the two cards' done-when)

1. An agent with no launch file says so in words: the model line reads
   "Made before Kosmos recorded this" (wording ruled on card #150) instead of
   "Unknown Model". #149: "an agent with no registry entry says so, in words".
2. The migration path is stated on the screen (#149: "a way to migrate one in,
   or a stated reason there is not"): the detail panel explains that the state
   is permanent while it runs, and that stopping it and adding it from Found
   agents brings it in. That path EXISTS today (discover.connect installs a
   job for a stopped agent and refuses a running one per #362); nothing tells
   the person.
3. The memory panel gets the same treatment (#149 "ideally"): the no-transcript
   admission for a no-plist agent becomes the never-recorded sentence, not
   "we cannot find a transcript for it".

## The discriminator, and why it is honest

The plist gate `fs.existsSync(create.plistPath(name))` is the exact gate
`notYetStarted` already trusts (status.js), and it is a fact about OUR
bookkeeping, not a threshold. Three states, three sentences:

- plist exists, transcript readable: normal (unchanged).
- plist exists, no transcript: "we cannot find a transcript for it" (a fault;
  unchanged) or notYet (unchanged).
- no plist, pane tied to the name (isNamedOurs): never recorded. New sentence.
- pane NOT tied: unchanged refusal (we do not answer for strangers).

Nuance stated rather than hidden: the dev fleet's -discord agents were not
"made by Kosmos" at all, and they will wear this sentence when stopped. The
operative claim ("no record exists, none will appear by waiting, here is the
way in") is true of them too, and the card ruled the wording.

## Changes

engine/status.js:
- readContext's no-transcript admission branch: when the tied agent has no
  plist, return because "made before Kosmos recorded this, so there is no
  record to read" and neverRecorded: true on the context object.
- Roster rows carry neverRecorded: true only when tied AND no plist (computed
  beside the existing tied gate; never for untied panes).

server.js:
- Running rows and stopped known rows both pass neverRecorded through.

web/index.html:
- modelLine: the !name branch splits on a.neverRecorded.
- runsOnLine: third state keeps no lead for both, wording split the same way.
- Detail panel: under the runs-on line, for neverRecorded, one explainer with
  the migration path (stop it, then add it from Found agents; Kosmos will not
  write a launch file while it runs some other way).

## Tests

- engine/status test: fixture tied agent, no plist: never-recorded because +
  flag; WITH plist, no transcript: the old admission (the pair proves the
  discriminator, not the wording alone).
- server.test.js: row field present for tied, absent/false for a stranger pane.
- web pin: modelLine wording both ways.

## Review bound

Two rounds maximum (cross-layer change, three files). Declared before starting.
