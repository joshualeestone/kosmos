# whatsnew-0724: the 0.7.24 "Kosmos has been updated" highlights, no API keys (Josh 10-05 ~17:15, Splinter 17:20/17:25)

Josh, on the 0.7.23 popup: "so 40% of the new features are about API keys in the popup" and "we dont want to tell people
they have to use an API key for anything". Splinter: rebuild before any promote; ship it as 0.7.24 (not a second 0.7.23:
two builds under one version, and a Mac already on staging 0.7.23 would never be offered the rebuild).

## Change
web/whats-new.json for 0.7.24: dropped "Org charts read without Claude" and "Key accounts show their key". Added:
- Agents on all your computers (#4812, 453605299): web/index.html "Your other computers" section (#oa-wrap), grouped per
  computer. It appears ONLY on a page served from this computer's Kosmos+ https address (oaEligible), and a computer's
  agents show only once it lets that browser in (oaClassify; otherwise "not let in on X yet"), so the line says both.
- See what a task changed (#5205 / #5153 slice 1): paintTaskReceipt shows the receipt on any closed task, no setting
  (only the undo inside it waits on Settings > Advanced). engine/receipt.js gives Claude, Codex and Gemini CLI agents a
  full receipt; other runners (Grok, Antigravity, Muse) show "not available", which the receipt itself says, so the line
  says "its agents" rather than naming providers. It covers what an agent did WHILE it held the task (the receipt's own
  intro), hence "while they held it".
Kept, unchanged: Name an agent file, Token Usage for every provider, A refused Restore says why. No "API key" anywhere.
tools/whats-new-check.js 0.7.24: 5 highlights, mac 5, windows 5.

## Pin
This branch is 49587aa6a (the 0.7.23 pin) plus only this branch's What's New commits (the copy and its review fixes). It reaches main by a MERGE commit, deliberately: release.sh
cuts only an ancestor of origin/main, and a rebase or squash would re-create the commit on main's tip, carrying everything
merged since the pin (#4649 slice B, #5253, #5277), which Splinter ruled out. The cut pins this branch's head.

## Validation
A copy-only change to one JSON file on a tree that passed the full suite and the full browser gate at the 0.7.23 cut
(16:03). The cut's step 3+3b runs the full suite and page layer on this exact tree again, and aborts before anything
is published on any red.

## Weakest premise
"Token Usage for every provider" names OpenAI, Gemini and Grok. It is about agents, not keys, but it is the remaining
line closest to Josh's concern.
