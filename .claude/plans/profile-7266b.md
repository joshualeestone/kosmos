# profile-7266b: #7266 slice B, the profile picture

Card: kosmos#7266 (plan comment 6429906013, slice B). Stacked on switcher-7266c (slice C) on fourtabs-7266 (slice A).

## Finished looks like
The Settings tab item shows the person's picture (the board's own "You" picture, GET /api/you/avatar) as a small
circle, the gear when there is none. The Settings page opens as a profile: the picture and the person's name on top,
every setting under it, and a line saying both are changed in the board's Settings (Your Profile).

## Decided
- Read with the agents' pictures, on the first list and then every 5 minutes, never on each 5-second read. A failed or
  sign-in-page read keeps what was shown; 204 or an older board's 404 means no picture.
- Forgotten with a computer switch, a sign-out or another account: they are that computer's own.
- Not editable on the phone. Rejected: an upload flow here (the board owns the record; a later card if wanted).
- Weakest premise: that one picture per computer is right. With two computers the person may have saved different
  pictures; the tab shows the shown computer's, which is consistent with the switcher.

## Checks
LogicTests (parsers, client: read, 5-minute cadence, kept on a bad read, forgotten on a switch, none shown when none),
two mutation controls, the other six runners, the repo iOS route tests, a full iOS typecheck, sim shots.
