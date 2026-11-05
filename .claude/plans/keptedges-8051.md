# keptedges-8051: two low edges left by #8040 (kosmos#8051 items 2 and 3)

Built on main after #8040 merged (#8059, 16:03 CST). PigeonPete, 12:50: not folded into #8040 (its loop was finished).
Item 1 (a kept form coming back unexplained) stays Mona Lisa's design call and is not built here.

## Item 2: a provider picked by hand during a slow saved-provider read skips the kept restore
web/index.html loadCreateExtras: after `await agyAsk()` (a saved Gemini-by-subscription pick) and `await museCreateAsk()`
(a saved Meta Muse pick), `if (gen !== EXTRAS_GEN || CREATE_PROVIDER_TOUCHED) return;` left the async block before its
`if (kept) createKeptRestore(kept);`. Now a stale gen still returns, and a hand-picked provider skips only the saved
pick: `if (CREATE_PROVIDER_TOUCHED) { if (kept) createKeptRestore(kept); return; }`. createKeptRestore never sets the
provider (it reads the one now selected and puts the account and model back where that provider offers them), so the
provider they picked still wins, as the card says it should.

## Item 3: a refused key that lands after the person left the key step says nothing
The Claude key path's catch: when the answer lands in the same visit, the flow still open, the key step hidden and the
picker showing (they went away and back), #acct-claude-msg (at the flow's level since #8040 item 2) now says
"The API key you entered was not added. " + the route's reason (asSentence). It names no key and asks for no box. Every
other place stays silent, as #8040 designed: the dialog closed (a new visit), another provider showing, the subscription
step. No Claude Code at the picker keeps its own line.

## Decided
- Item 3 takes the card's own option (a line at the picker naming the failure, not the key), and only where it is true:
  same visit, flow open, back at the picker. Rejected: a line in a closed dialog or under another provider (nowhere true
  to say it), and a toast (a new surface for one edge).
- #8040's browser check pinned the old silence at "away and back"; that assertion now expects the new line (the change
  this card asks for). Its "landing on another provider" and "closed and reopened" cases stay silent and are the controls.

## Weakest premise
Item 3: that a person back at the picker wants to hear about a key they may have given up on. The line is one sentence
and goes with the next provider switch, so the cost of being wrong is small.

## Tests
docs/browser-checks/render-nomodel-8040.js (a real page on a sandboxed board): the "away and back" late answer now
expects "The API key you entered was not added. That key was refused." with no key in it; a new item-2 case (two Claude
accounts, the second picked, the form kept, a saved `antigravity` pick whose read is held, the provider picked by hand
during it) expects the provider they picked and the kept account back.
