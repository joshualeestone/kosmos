# accts-5883: every named account of the agent's provider (kosmos#5883 slice 4)

Stacked on agy-5883. Closes the residual "a move between two NAMED accounts leaves the first account's sessions unread".

## What
engine/backuptick.js inputsHere: for a Codex, Gemini or Grok agent, every NAMED account its provider's module lists
(openaiaccounts, geminiaccounts, grokaccounts) is added as a further home, each filtered to this agent's own files
(backupsessions) and named for its folder (acctTag), so names are stable; sessionsFor reads one folder once, so the
current account is not read twice. Only the agent's OWN provider's accounts.

## Measured
This Mac: 1 OpenAI account, 0 Gemini, 1 Grok; ~/.codex holds 25 rollouts. The extra reads cost nothing here; on a large
install the Codex first-line reads are cached by codexsession.metaOf.

## Still not covered (said in the header)
A SIGNED-OUT account (the account modules list only folders with an identity); an agent that changed PROVIDER; Grok
worktree sessions; conversations started in a subfolder of the agent's folder.

## Tests
backuptick-inputs.test.js: an agent that moved between two named accounts keeps both accounts' conversations, each
under its own name; control, another provider's accounts are never read.
Mutants (21:30 CDT from `date`): F1 no other accounts: red. F2 another provider's accounts: red.

## Review 1 (opus, blind, on 5798acf2): three must-fix, two nits; all taken
1. MUST-FIX: with the current account's sessions folder a LINK, the current account was added twice under one name
   (a refused root has no path, so the one-folder rule cannot catch it), and a repeated root name fails EVERY backup.
   FIXED twice over: inputsHere skips a home whose tag is already there; sessionsFor never adds a second root of one
   name. Test with a linked sessions folder. Mutants: H1 both guards removed: red; H2 only the tick's guard removed:
   passes, as designed (sessionsFor's guard holds).
2. MUST-FIX: the "another provider" control could not fail. Rewritten: the Gemini list names a real folder holding
   this agent's rollout, which must never be read for a Codex agent (H4 red).
3. MUST-FIX: a stale comment still said account moves are not covered. Removed.
4. NIT, FIXED: each provider's account list read once per call, not once per agent.
5. NIT, FIXED: the test's default row is a real folder with a rollout, so skipping isDefault rows is tested (H3 red).
Measured 21:32 CDT from `date`.

## Review 2 (sonnet, blind, on 66bd0287): NO NEW ISSUES. Converged at 2.
