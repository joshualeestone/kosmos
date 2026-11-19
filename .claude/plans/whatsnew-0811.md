# whatsnew-0811: What's New for 0.8.11

Pool PR before the 0.8.11 staging cut (11-19, #1050). Data only: `release/whats-new-pool.json`, the built `web/whats-new.json`, and this plan. Prod serves 0.8.10 (promoted 11-19 09:01 CST, frozen at 6eb496f45c, pinned at 7f0cbf8571).

## Pool bookkeeping first (its own commit)
`shown 0.8.10 --promoted --from-history --ref=6eb496f45c`: 5 marked shown, lastProd 0.8.10. `prod-check` agrees ("the pool records prod 0.8.10; prod serves 0.8.10"), and so does `build`.

## The window (5; mac 5, windows 4)
1. A room post that names you can reach your phone (#8699, c3f26fb2d4; rank 9.0)
2. A window Kosmos cannot confirm says so (#8719 part 1, 0232a837d6; rank 9.2)
3. A refused download asks where to save (#5167, 1fdd9c9c04; mac only; rank 9.4)
4. Starring an agent shines (#8705, abe5e0742d; rank 9.6)
5. A long conversation keeps your place (already pending since 0.8.08, rank 10.12)

## Notes only (kosmos whats-new)
| merge | change | rank |
|---|---|---|
| 51c966ef14 | #8721: kosmos claim --status | 131 |
| 7567e9f388 | #8698: kosmos feedback list --mine | 132 |
| aa60d96b26 | #8722: a community read asks once more after a lost answer | 133 |

## No line
- #8700 (the invite sheet shows a remote session's sign-in-again refusal): it is the federation invite path, which is built but hidden (#4649), so a person cannot reach the sheet it fixes.
- #7586 board half (backupline-7586: the member's board says when it misses the company's backup requirement): company backup is off in production (#8528), so no member can see it yet.
- #8706, #8708 (iPhone star): iPhone app, not in this build.
- #8714 (a closed reader exits quietly), #8718 (crash-safe stores), #8322 (the Windows second trust key), #8508 (Windows test arms), dlperm's bundle-build pin, plan and proof commits: internal, nothing a person or an agent's command shows differently.

## Decided
- #5167 is tagged mac: it is the Mac app's own download handling (native-app/main.swift). The cut builds and signs the whole Kosmos.app (#5935), so the change ships in this build.
- The phone line says "can get the notice a reply to you gets": #8699 reuses that notice (postedMention), and whether it reaches the phone depends on the person's switch (on by default), so "can".
- The #8719 line uses the board's own words: the label is "Not linked to Kosmos" and the reason is that Kosmos "cannot confirm it started" the window (#8719 reworded away from where a window came from in its own review).
- The star line says "an agent's star", as #8705's plan names the agent grid and the agents list.
- Every line is checked against the commit's own words, and each is 140 characters or fewer (the build refuses longer ones).

## Weakest premise
Rank is judgement. #8719's line compresses "its tile and list row, its pill's hover and its page" into "on the board".

## Would change my mind
A person-facing merge since 7f0cbf8571 missing from these tables, or a reviewer showing that a line claims more than its change does.

## Review log
- Iteration 1 (opus): BLOCKER, the #8719 line quoted a label the board does not show (it is "Not linked to Kosmos"); WARNING, it said where the window came from, where the product only says Kosmos cannot confirm it; NIT, "can get" for the phone. All three fixed.
