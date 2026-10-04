# #4649: Members says `shared`, so "could not check" is not read as "never shared" (Pete's review of slice B)

Stacked on fedmembers-4649 (#5266); opened after it merges.

## Problem
An invite made on the create screen is never in the board's invite record, so its joiners are listed only from the
coordinator's connections. When the coordinator cannot be asked, an owner's Members answers `invites: []` and
`checked_at: null`, the same shape as a project never shared, so the page cannot say "could not check".

## Call
The owner's answer carries `shared: !!ownerLink`: true once the project has an owner link (anything was ever invited
or joined). The page reads `shared && checked_at === null && invites.length === 0` as "could not check just now".
Absent (older board) means false.

## Rejected
Recording create-screen invites: the project has no id yet when they are made (slice 1's stated limit).

## Tests
engine/fedmembers.test.js: shared:true with the coordinator unreachable; CONTROL: a never-shared project says false;
a mutation making it always true reds the control. 33/33 with the server route file.
