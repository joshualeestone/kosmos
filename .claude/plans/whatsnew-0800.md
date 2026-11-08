# whatsnew-0800: What's New for 0.8.00

Pool PR before the 0.8.00 staging cut. Branch from origin/main 1fd2fc2af4.

## Prod check
`prod-check`: the pool records prod 0.7.97 and Mac prod serves 0.7.97. Nothing is marked shown.

## Changes since the 0.7.99 freeze 434a752fb5 (by merged PR)
| PR | change | pool |
|---|---|---|
| #8266 | #8259: a held-for-you task says when its agent asked, and when the person answered | rank 11.9, all platforms (enters the window) |
| #8267 | #8258: agent-facing dates show this computer's date first | notesOnly 78 |
| #8263 | #8260: kosmos feedback show with no report yet exits 0 | notesOnly 79 |
| (0.7.99) | #8236: kosmos project test on or off; deferred from 0.7.99, which had no pool PR | notesOnly 77, since 0.7.99 |
| #8257 | #8221 slice 3: iPhone list | none: Debug only |
| #8253 | #8246: iPhone haptics | none: the iPhone app is not in this cut |
| #8255, #8264, #8268 | test and CI only | none |

## Build
`node tools/whats-new-pool.js build 0.8.00`, output unedited. Window: the Windows folder item, the needs-you words,
the new held-question item, the Gemini item (mac), agents you follow. Mac 4, Windows 4.

## Decided
- #8259 goes in the window: the person can see it on the Tasks row, and it outranks items from 0.7.47 and 0.7.54.
  Rejected keeping it below the window as 0.7.98 did for #8215: that item ranked under a full window; this pushes out
  only "Old project summaries say why". Weakest premise: rank is judgement. Change the number and rebuild to overturn.
- The retire of the Windows-only folder item waits: Windows prod still serves 0.7.94, below its 0.7.95 window.
- #8236 keeps since 0.7.99, the build it first shipped in, though it is first announced now.

Commit carries the #1720 Browser-check trailer (data only).
