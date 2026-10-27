# cloudwords-4903: seam H page strings on a cloud machine (kosmos#4903)

Owner: Angel (split with Baron m653, Splinter 06:26 10-27). Source: Mona Lisa's seam H table on #4903
(comment at 09:36Z) and her sweep at ~/work/design-shots/kosmos-4903-h/sweep-cloud-strings.md.

## Finished looks like
On a board whose served meta says it is a cloud machine (`onCloudMachine()`), every page string in Mona Lisa's
table says "your cloud machine" instead of "this computer" / "the computer running Kosmos", and everything that asks
for a path on the machine, a login to it, a terminal on it, or turning it on is hidden. A Mac, Windows or plain Linux
board shows exactly what it shows today.

## Rule (Mona Lisa, decided)
"your cloud machine"; hide (not reword) anything the person cannot do from a browser.

## Mechanism
- `thisMachine()` / `ThisMachine()` beside `hostMachine()`: "your cloud machine" on a cloud machine, else "this computer".
- `hostMachine()` / `hostMachineCap()`: a cloud arm first, only when no explicit platform is passed (an explicit
  platform describes another computer's payload).
- `data-cloud-hide`: CSS on `html[data-kosmos-cloud]`, stamped by applyPlatformCopy when onCloudMachine().
- `data-cloud-copy` for static markup (the rename hint).
- The "will not come back after a restart" / Start at login notices (and their Show again list in Settings) are hidden
  behind one flag, `CLOUD_HIDES_RESTART`, pending Baron's confirmation that the box brings every agent back by itself;
  turning it off restores them. The reboot note is reworded ("Your cloud machine restarted ..."), not hidden, as Mona's
  table says.

## Blind review 1 (06:43), taken
- Seam G: every hidden provider's confirm, pick, flow and status boxes carry data-cloud-hide too, not only its row
  (their painters run on entering the step and could show a "connected" box with no row).
- The age line naming OpenAI or Grok is hidden on a cloud machine; a cloud-only line says Claude's rule alone
  (`data-cloud-only`). Wording is Mona Lisa's to change.
- The found list stays hidden (Mona Lisa's table says Hidden), and its disk scan is not run there.
- Two nearby "this computer" sentences (a keyed account gone, Kosmos cannot find X running) go through thisMachine.
  Not taken: pane 5's "Your agents run on your own subscription, on this computer." (pane 5 was outside Mona Lisa's
  sweep by instruction, and #6521 pins it): a follow-up for her.
- The Show again list of restart notices stays empty on a cloud machine.
- Tests: a shown Claude row is asserted present; the browser check's cloud arm is Linux plus cloud.

## Out of scope
Engine strings (Baron's sweep); seam G handled in the same branch only if small (Claude only on the cloud Connect
list); Settings and header strings Mona listed as "outside this path, later".

## Verification
Node test lifting the helpers (cloud arm, Mac/Linux controls) plus source checks of each string's cloud arm; one
real-browser check rendering the empty state, signed-out panel, not-answering note, restart note and survival notices
with the meta set, each with a non-cloud control.
