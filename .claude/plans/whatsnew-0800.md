# whatsnew-0800: What's New for 0.8.00

Pool PR before the 0.8.00 staging cut. Branch from origin/main 1fd2fc2af4.

## Prod check
`prod-check`: the pool records prod 0.7.97 and Mac prod serves 0.7.97. Nothing is marked shown.

## Changes since the last pool items (0.7.98 bump e660c5bbab), by merged PR
0.7.99 had no pool PR of its own (#8247 only rebuilt the list), so this covers both 0.7.99 and 0.8.00.
| PR | build | change | pool |
|---|---|---|---|
| #8266 | 0.8.00 | #8259: a task on hold for the person says when its agent asked, and when the person answered | rank 11.9, all platforms (enters the window) |
| #8241 | 0.7.99 | #8236: kosmos project test on or off | notesOnly 77 |
| #8267 | 0.8.00 | #8258: agent-facing dates show this computer's date first | notesOnly 78 |
| #8263 | 0.8.00 | #8260: kosmos feedback show with no report yet exits 0 | notesOnly 79 |
| #8239 | 0.7.99 | #8227: task files on Windows does not open a path on a mapped network drive (a local link to a share is #8232, still open) | notesOnly 80, windows |
| #8252 | 0.7.99 | #8251: an action's count says the waiting comments before the aim | none: a rewording of one reply |
| #8238 | 0.7.99 | #8235: a file-owner notice says when the owner gets its copy | none: wording only, the throttle is unchanged |
| #8234, #8242 | 0.7.99 | #8230, #8233: a lost turn end is noted | none: internal reliability |
| #8237, #8243, #8257 | both | #8221 slices 1 to 3: iPhone list | none: Debug only |
| #8253 | 0.8.00 | #8246: iPhone haptics | none: the iPhone app is not in this cut |
| #8245, #8248, #8255, #8256, #8264, #8268 | both | CI and tests | none |

## Build
`node tools/whats-new-pool.js build 0.8.00`, output unedited. Window: the Windows folder item, the needs-you words,
the new tasks-on-hold item, the Gemini item (mac), agents you follow. Mac 4, Windows 4.

## Decided
- #8259 goes in the window: the person can see it on the Tasks row, and it outranks items from 0.7.47 and 0.7.54.
  Rejected keeping it below the window as 0.7.98 did for #8215: that item ranked under a full window; this pushes out
  only "Old project summaries say why". Weakest premise: rank is judgement. Change the number and rebuild to overturn.
- The Windows-only folder item (since 0.7.95) is retired by hand once Windows prod serves 0.7.95 or later, the first build whose
  window shows it; Homer's planned promote is 0.7.97. It waits: Windows prod serves 0.7.94 (latest-win.json read 17:50 CST 11-08).
- #8236 and #8227 take since 0.8.00 though both first shipped in 0.7.99, so that the default kosmos whats-new, which prints
  only the newest version's notes, shows them. Rejected since 0.7.99: the 0.7.99 build has no such note, and the newest-only
  view would never show it. Cost: the notes date them one version late.

Commit carries the #1720 Browser-check trailer (data only).
