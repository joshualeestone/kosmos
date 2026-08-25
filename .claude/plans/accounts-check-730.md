# accounts-check-730: the accounts browser check follows #730's provider picker

## Finished looks like
docs/browser-checks/render-accounts-openai.js passes against a board on main: it opens
Settings > Accounts, finds the OpenAI provider picker (data-pick="openai"), proves it has
size and is on top, clicks it, and walks the key form as before. The page gate (release.sh
step 3b) is green again, so a cut can ship.

## Why
#730 (Settings > Accounts, one provider at a time) replaced the always-visible
#acct-add-openai button with a provider picker that reveals the OpenAI form. The check still
asked for the old id, getBoundingClientRect threw on null, the check failed twice, and the
0.5.24 cut stopped at step 3b at 21:41 with nothing served, on the cut made so installs
can create agents again (#731).

## Not in this change
The harness's fake runner (it already carries its shebang; a shebang-less copy in my own
sandbox refused every key and cost fifteen minutes of misdirection). The page gate not
running in yarn test, which is why #730 merged green: a separate card.
