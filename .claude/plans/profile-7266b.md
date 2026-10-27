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

## Design review (Mona Lisa)
- No picture: the person's letter on the avatar cream (Palette.avatarFill / avatarLetter), as an agent with none, in the
  tab and on the profile page. Josh asked for the picture "instead of a settings cog", so a gear for everyone without a
  photo would bring the cog back. The gear (tab) and person symbol (page) show only while the name is not known yet.
- The screenshot stand-in for a photo is drawn in the cream too (Debug only).

## Review 1 (blind)
- Fixed: a stop or restart with the read in the air no longer holds the next read off for 5 minutes (stop drops it as
  not done); only the newest read clears its handle.
- Fixed: the name keeps what was shown on an answer that is not the record (the gate's page at 200, the board's
  "unknown" mid-write); only "absent" or a saved blank name clears it, as the picture read does.
- Fixed: the tab's picture circle is drawn once per picture, not on every 5 s redraw (a picture can be 5 MB).
- Fixed: the picture is read on the first list and then every 30 minutes (the name every 5): it is served no-store with
  no version, so every 5 minutes was about 60 MB an hour on a big picture. A changed picture shows within 30 minutes,
  or at once on a switch, a sign-in or a new launch.
- Tests: the name's three states, the two cadences, sign-out forgetting the person; controls (the old name rule, no
  picture gate) each fail one. Not tested: a read in the air across stop() (the fake answers at once).
