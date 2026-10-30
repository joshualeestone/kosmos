# bubbles-7342: TestFlight build 12 (Josh's 10-28 09:34-09:41 notes on build 11)

## Finished looks like

- #7342: each agent's unread notifications are a red numbered bubble at the right of its row, after the Working or Issue pill (6 pt), or alone. The full number shows to 99, then "99+". The avatar's corner count is gone, and so is the Waiting pill. The Agents tab number is the sum of the row bubbles, so it always explains itself. A Mentions-only or Muted project's bubble is grey, and the project bubble sits at the right end, as on Agents.
- #7486: a working project shows the Agents list's animated Working pill.
- #7487: Settings has no title; the profile picture is first.
- #7489: + on Projects opens a native New project form at once and sends one request on Create.
- #7266: the tab bar minimises on scroll (iOS 26).

## Decided

- **The Agents tab is the sum of its rows.** Measured on this Mac's board: counts.waiting was 292 = needs-you 0 + DMs 0 + project unread 292, so the old badge was all project-room posts, which no agent row can show. Mona Lisa's rule: every tab's number is the sum of what its own list shows. The Projects tab keeps projectsUnread (already the sum of its active, non-muted rows). The Dock and Today keep the full total.
- **Waiting is off on the phone** even though the Mac's tone for a blocked agent is needs-you (Waiting is in its NEEDS_YOU_WORDS). The Mac's needsPerson does not count it, so a blocked agent that does not need Josh has no pill, is quiet in sorting and Today, and is never spoken as "Waiting". The desktop board still treats Waiting as needs-you; Josh's ruling was about the phone list.
- **New project posts to the computer the phone is connected to** (macURL), and opens the new room there. When there is no connected computer yet, + falls back to the board page, as before.
- Weakest premise: "Needs you first" still ranks blocked second (needsRank copies the desktop), so a quiet blocked agent sorts above working ones there.

## Not verified

- Not run on a device. Shown through simulator shots with Debug sample hooks; the New project form has not been sent against a real board.
- The slow board page: measured as 6.3 MB sent uncompressed (#7490 filed); the relay leg was not measured.

## Reviews

1. [BLOCKER] a current Mac's needs-you tone drew a red "Waiting" pill: fixed (no pill from that tone; quiet tone). [WARNING] a stale list's tab badge summed rows with no bubbles: 0 while stale. Dead avatar code removed.
2. No blocker. VoiceOver and the grey stale pill still said Waiting; Cancel was live mid-send; the room opened on the switcher's host: all fixed. Done creates.
3. No blocker; nits only. Converged.
Then Mona Lisa's review: the project bubble at the right end; the Projects tab number in shots (a sample gap).
