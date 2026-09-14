# #2941: account removal disclosures omit codex-session loss for LABELLED accounts

## Problem
Two account-removal disclosures in server.js gate the "you lose your codex history" clause on
`wasDefault`, so they warn about it for the DEFAULT OpenAI account only:
- DELETE (irreversible, whole-dir rmSync), server.js ~6259: a labelled delete said only "Its
  sign-in file is gone."
- FORGET/disconnect (reversible, rename aside), server.js ~6300: the "Kosmos stops looking inside
  it, history will not appear any more" clause was gated on `out.wasDefault`.

That gate was written on the premise that `status.readCodexSession` read the DEFAULT codex home
alone. Since #2906 (its read-fix is on origin/main; the issue stays needs-release), the reader reads
EVERY account's own home (`job.configDir || defaultAgentCodexHome()`, engine/status.js:4620), so a
labelled account's codex sessions are now visible in the Memory panel -- and a labelled removal loses
that visible history with no disclosure. Verified the premise on origin/main before building.

## Fix
Drop the `wasDefault` gate on the history clause at both sites (the clause is now unconditional for
OpenAI removals), and correct the two stale invariant comments to state the new premise (the reader
reads every home since #2906). The DEFAULT copy is unchanged. `wasDefault` is retained as an engine
return -- the Claude default-recovery path still keys on its own account's `wasDefault` -- it is only
no longer used to gate the OpenAI history sentence.

## Tests
- server.forget-openai-1689.test.js: flipped the labelled-forget CONTROL from
  `doesNotMatch(/stops looking inside it/)` to `match(...)` -- a labelled disconnect now discloses
  the history loss.
- server.remove-2264.test.js: added an assertion that a labelled OpenAI DELETE's copy now includes
  the codex-session-loss clause (was a loose "deleted from this computer" match that passed both ways).
- engine/openaiaccounts.wasdefault-1659.test.js: assertions unchanged (the `wasDefault` FLAG is still
  correct -- a labelled account is genuinely not the default); corrected the now-stale prose that said
  the flag gates the OpenAI history sentence (it no longer does).
- All four mutation-verified: reverting either server.js site to the old gated form reds the
  forget-1689 labelled test and the remove-2264 codex assertion respectively.
- accounts/openaiaccounts.delete-primary-2684.test.js: unchanged -- they assert the engine `wasDefault`
  flag, not the disclosure copy.

## Rejected alternatives
- Fold into #2906: rejected per the card -- #2906 is the status READ fix (status.js); this is
  user-facing removal COPY (server.js) that requires flipping tests encoding the old premise.
- Keep the default-only copy and add a labelled-only variant: pointless -- removeAccount rmSyncs the
  whole home and the reader now reads every home, so the consequence is identical for both; one
  unconditional clause is correct and simpler.

## Weakest premise
That #2906's read-fix is truly on origin/main (not just planned). Verified directly:
engine/status.js:4620 reads `job.configDir || create.defaultAgentCodexHome()`, and the #2906 issue's
own body describes exactly this. If that fix were reverted, this disclosure would over-warn for
labelled accounts -- but it is present, and over-warning about a real deletion is the safe direction
anyway (the more destructive door must not disclose less).
