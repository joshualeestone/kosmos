# #1940: first-run Accessibility step copy + gold button

**Branch:** `a11y-tmux-deeplink` · **Card:** kosmos#1940 · Design owner: Mona Lisa (fr-pane-5).

Splinter routed me the "Accessibility step deep-link" related task and asked me to land Mona Lisa's
3 fr-pane-5 markup edits + the deep-link fix as one browser-verified change (she has no Playwright
in her design session; I do — committed headless checks). I investigated the deep-link first.

## The measure-before-building finding (Splinter endorsed)

The "Open Accessibility settings" deep-link **already opens the Accessibility pane correctly**
(`engine/machine.js` opens `x-apple.systempreferences:<id>?Privacy_Accessibility`). The hard part
Josh named — "surface the Tmux ENTRY" in that list — has **no clean fix**: macOS gives no URL
parameter to select/highlight a specific app, and making Tmux *appear* requires triggering tmux's
own accessibility TCC request (a native/shell mechanism needing a real-Mac test). That is a genuine
macOS limitation and a #1940-class native piece, **not markup-bundleable** — so it is scoped as a
follow-up (filed on #1940 with these findings), and the new copy is the interim (it guides the user
to do manually what we cannot yet auto-surface).

## What this branch ships (Mona Lisa's 3 fr-pane-5 edits, verified)

- **Copy** (Josh's verbatim): "Allow Kosmos agents to work in applications on this computer. Turn on
  'Tmux' in Accessibility to enable this." (names the exact action, replaces the reassuring copy).
- **Button style**: `#fr-a11y-open` gets `class="btn fr-sleepbtn"` — the gold-outline style the
  sleep-settings button uses, for consistency (Josh's ask).
- **Deleted the "This one is optional ... or later in Settings, under Keeping agents running" line**:
  Continue already lets a skipper move on. The offer-not-require MECHANISM is unchanged (step 5's
  Continue proceeds to frGo(6) unconditionally); the out is now Continue, not an in-pane sentence.

## A real interaction, flagged — and resolved

Deleting that line also removed the #1214 **"later in Settings" pointer** (which had its own
LOCATION-pin test + Josh's #1214 ruling that the offer names the box where you turn it on later). I
flagged this to Mona Lisa rather than silently deleting a #1214-tested out. **Her decision: keep the
pointer, reworded** to drop only the pushy "optional / now-or-later" framing. Final copy (Josh
voice): "You can turn this on anytime in Settings, under Keeping agents running." — drops "optional",
keeps the out ("anytime") and names the Settings box, so the #1214 location pin holds. The
LOCATION-pin test asserts the pointer PRESENT; the browser check asserts the reworded line renders.
The catch is the value of the flag: without it, the markup edit would have silently reverted #1214.

## Verification

- New committed headless check `docs/browser-checks/render-a11y-copy-1940.js` drives first-run to
  fr-pane-5 (via `stepForAnchor` + `?fr-step=N`) and asserts the copy, the gold `fr-sleepbtn`
  COMPUTED style (a phantom class would pass a source grep and fail here), and the deleted line —
  **5/5 green here, 4/4 RED against origin/main's pre-#1940 markup** (the control). Wired into
  `tools/browser-checks.sh` + the README index.
- Source test `web.firstrun-a11y-1214.test.js` updated: the copy, the offer-not-require mechanism
  (Continue unconditional), and the intentional pointer removal.

## Weakest premise

That deleting the whole optional line (removing the "later in Settings" pointer, not just the
"optional" word) is what Josh intends. Mitigation: it is Josh's verbatim copy per Mona Lisa/Splinter
(locked), the mechanism is preserved, and I flagged the pointer consequence so it's a choice. What
would change it: Josh wanting a pointer kept — a one-line add.
