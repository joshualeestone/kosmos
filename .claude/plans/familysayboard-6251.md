# familysayboard-6251 (board half of kosmos#6251), stacked on familywords-6239

The coordinator half (kosmos-relay familysay-6251) words its refusals by the org's kind, but the board never shows
the coordinator's sentence: engine/orgenroll.js turns each public code into its own SAY sentence. So on its own the
coordinator half changes nothing a family's computer shows. This branch is where the family's words reach the screen.

## What changes
- engine/orgenroll.js: every person-facing sentence is said by the org's kind where this board knows it (its record,
  or the previewed org the screen's ticket carries as orgKind). A family hears "your family", never "your company".
- Where the board cannot know the kind (a code refused at preview names no org to the board): the code sentences are
  worded for both kinds ("ask whoever sent it for a new one"). This changes five company sentences on purpose.
- server.js: the enroll ticket passes orgKind from the preview.
- web/index.html: the joined panel says family for a family (title, Leave, the leave and status sentences); /api/org
  carries the record's kind for it.

## Decided
- The join entry keeps Josh's #5791 copy (the "Join Corporate Account" button, the "Enter your company's code ..."
  hint and the "Company code" placeholder, pinned by web.joincorp-5791.test.js): before a code is checked the kind is
  unknown, and the copy is his. Only the empty-code line is neutral ("the code you were sent"). Weakest premise: a
  parent reads "Corporate" as not for them. Flagged on #6251 for him to swap; each is one line.
- Org policy sentences (orgpolicy.js, policy.js, agentevents' "your company's rules") are not in this branch: they are
  about what a policy allows, a separate surface; named as a follow-up on #6251.
- An unknown or missing kind reads as a company's, as the coordinator does.

## Round 1 (opus) fixes
- preview's already-member refusal is said in the status read's org's words (a failed read: a company's), and its
  incomplete-answer sentence goes through inKind.
- The page's plusOrgIn has the same two rules as the engine's inKind, and the test compares them over a sentence
  for each rule, so a rule added to one copy is seen.
- An unknown join stores its kind for a company too, so a company join on a board holding a family record settles
  in a company's words.
- An org's own name never goes through the rewrite (worded text first, the name joined after).
- server.js says the unseen-words refusal from oe.SAY (one copy).
- render-orgenroll-5531.js: the empty-code line updated, and O15f drives a family's joined view in a real page
  (title, sentence, Leave button) beside the company control O15.

## Not done here
- Family copy keeps "your work Kosmos" in the derived sentences, while FAMILY_SAY's hand-written ones avoid it. A
  wording pass for a family's whole panel is a follow-up on #6251.

## Round 2 (sonnet) fixes
- An undone first join says the used code goes back to "whoever sent it", as the preview's code sentences do (inKind
  had made it "ask your family"). The wrong-domain sentence says what is wrong: "sent for a different email address".
- Out of scope, stated: the company sign-in (plus-signin-company, its lead line) is a company's own single sign-on,
  which a family has none of; the join entry's aria-label and placeholder stay with Josh's #5791 copy (above).

## Round 3 (opus) fixes
- An undone first join takes the call's kind (the request's, else the record's), so one call cannot word its
  sentences two ways; tested with no kind on the request and a family record.
- Every way the kind is found now has a test of the sentence a person reads: an undone join, Review on a family's
  Kosmos, a leave retried from the pending leave alone, and a lost join settled from its marker alone. Each was proven
  red by removing its source of kind. The source-text test of the undo sentence is replaced by a driven one.
- The test's em dash check is written as an escape (my heredoc had turned it into the character).
- Kept (NIT): the page's title and button source pins beside O15f; the two rewrite copies compared over one sentence
  per rule; "your work Kosmos" in family copy (follow-up, #6263).

## Round 4 (sonnet) fixes
- A pending leave keeps the kind it was written with, so an undone family join that could not be confirmed is
  retried in a family's words with no record left (tested; red when the stored kind is not read).
- refresh reads the kind from the record it reads, after the paths that settle or leave first.
- Stated at the site: a join with no known kind is recorded as a company's.
- Kept (NIT): the no-op plusOrgIn on the joined line's first part; the preview's sayFor with no kind (its codes fit both).

## Round 5 (opus) fixes
- A lost join settled as bound elsewhere is undone in the join's kind (its marker's), not a company's; tested through
  refresh for both kinds, red without it.
- Swept every writer of the pending leave and the unknown join for the same gap: undoFirstJoin passes the call's kind,
  the settle undo now passes the marker's, and leave's own rewrites carry the kind already in the file forward
  (pendingKind is read before the write).
- pendingKind falls back to the stored kind when a record from before kinds has none.
- Kept (NIT): "Your family could not undo joining your family" when a family has no name (rare; the follow-up wording
  pass, #6263); inKind's "its company's" rule is lower-case only (no sentence starts with it); a curly apostrophe in
  familywords-6239's lead sentence (that branch's).
