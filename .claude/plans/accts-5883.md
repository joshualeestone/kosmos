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
