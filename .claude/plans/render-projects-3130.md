# render-projects-3130: fix the stale youNamed assertion after #3130 dropped the operator name

## Problem

The 0.6.72 release cut went red at step 3b (the headless page layer) on `render-projects`:

```
TypeError: Cannot read properties of null (reading 'textContent')
  at docs/browser-checks/render-projects.js:553
```

Root cause is a stale browser-check, not a product regression. PR #3130 (msg-dialog
redesign, "no user name") changed the message-header render to drop the operator's own
name. The shipping render is:

```js
'<div class="msg-h">' + (isOp ? '' : '<b>' + esc(name) + '</b>') + ... + '</div>'
```

So an operator (`.msg.you`) post has no `.msg-h b`, while an agent post still does.
`render-projects.js` still read `you.querySelector('.msg-h b').textContent` (line 553) and
asserted `youNamed === 'You'` (line 585) — the pre-#3130 behaviour — so it crashed on the
now-absent `<b>`. #3130's PR updated the sibling `agentRole` assertion in this same check
but missed this one.

## Fix

Replace the stale assertion with a RED-CAPABLE pair that matches the new render and cannot
degrade to a vacuous always-pass:

- Collect `youBold` = the operator post's `.msg-h b` ELEMENT presence
  (`!!(you && you.querySelector('.msg-h b'))`), and `agentNamed` = an agent post's `.msg-h b`
  text (null-safe). Reading the operator side by element presence (not textContent) means an
  empty `<b></b>` cannot false-pass as absent; reading the agent side by text means the
  agent's name must genuinely be there.
- Assert the AGENT post IS named (`!seen.agentNamed` throws) so the operator-name-absence
  is measured against a working name mechanism, not vacuously true.
- Assert the OPERATOR post carries NO name `<b>` (`seen.youBold` throws).

This mirrors the absent-assertion pattern the check already uses for `agentRole`.

## Verification

- **Green:** ran the check against the shipping post-#3130 `web/index.html` (sandboxed
  server + fleet fixture + Playwright), 3/3 PASS.
- **Red-capable:** surgically re-added the operator name to `web/index.html` and re-ran; the
  check reds on the `youBold` assertion ("the operator post still carries a name <b>, but the
  user name is removed from the dialog"). So it is not a vacuous pass.

## Scope

Only `docs/browser-checks/render-projects.js` (+16/-2). No product code. After merge, re-cut
0.6.72 from current origin/main (which also carries #3196 strip-diag, per release-owner review).
