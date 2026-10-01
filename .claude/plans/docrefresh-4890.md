# docrefresh-4890: a change to the working rules reaches agents that already exist

Card: joshualeestone/kosmos#4890 (Josh's five-family diagnostic, items H9 and N7). Agents described CLI and display
behaviour that had changed (#4627 links, #4582 `reply --stdin`) because their instructions held the old words.

## Cause (measured on main)
- `create.js` wrote the working rules at birth with `defaults.appendTo`: plain text, no managed-span markers.
  `discover.js` did the same for an imported agent.
- `doctrine.planFor` keeps a section current only inside a managed span. Without one it offers only the headings a
  file lacks (`defaults.missingFrom`), by design.
- So a change under an existing heading reached new agents only. Measured on this Mac: 3 of 3 instruction files
  holding the rules were plain; none had a span.

## Change
1. Birth and import write the rules inside the managed span (`doctrine.atBirth`), with a birth version of the dated
   first line. A newborn agent is `current`, and every later version is offered through the existing consented
   refresh. Text that already has the rules is unchanged; text that already holds a doctrine marker gets the plain
   block (no span spliced among markers it did not write).
2. An older agent whose plain copy byte-matches an EARLIER block (fingerprints in `engine/doctrine-past.js`,
   generated from git history by `tools/doctrine-past.js`) is offered the current rules in the same consented
   dialog. The click replaces that copy where it stands, inside the span. The dialog says so (`replacing`).
   A copy the person edited fails the byte match and keeps today's rule (missing headings only).
3. "Send readable messages" said a `[label](address)` link drops the address; since #4627 it shows "label
   (address)". Fixed, doctrine v21.

## Decided, not missed
- Nothing is rewritten without the person's click: the ownership rule stands. Birth needs no click because nothing
  of theirs is replaced.
- Rejected: matching whole-section text to update edited copies (would rewrite a person's edits); generating the CLI
  section from `--help` (card's other suggestion; a larger change, and this fix makes any future wording change reach
  agents anyway).
- The fingerprint table includes today's block, and a test reds if it does not, so the next version bump must
  regenerate it.

## Weakest premise
That most existing agents carry an unedited copy. 3 of 3 here did (v15 twice, v18 once), a small sample. A person
who edited theirs is offered only missing headings, as before; birth in the span is the lasting fix.

## Tests
engine/doctrine-4890.test.js (7): birth span and current-at-birth; the card's case (a same-heading change reaches an
agent born before it); replace in place with a control; an edited, a one-character-edited and today's copy are not
replaced; marker fallback; the shipped table's pairing guard; server flag and dialog copy. Mutations: dropping the
past-block match, the today's-copy skip, or the line-start check each red a test. create.test.js: the verbatim test
reads the span; #1672 stubs `doctrine.atBirth` (throwing it reds 8 of 214).
