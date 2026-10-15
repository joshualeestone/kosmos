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
