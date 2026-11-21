# kosmos#8862: the usage mover judges each agent by its own model's weekly limit

## Finished looks like
1. The usage reader keeps every `weekly_scoped` entry of the endpoint's `limits` list as { model, usedPct, resetsAt }, through a failed read, aged out like the other figures; an answer with no `limits` list reads as before.
2. An agent is at risk when its OWN model's limit there is at AT_RISK_PCT or more (not resetting within RESET_SOON_MS), or the account is at risk overall.
3. A target must have room for the agent's model (its limit there under TARGET_MAX_PCT); an agent whose model is unknown is kept off any account with a model limit at TARGET_MAX_PCT or more.
4. Settings, the sweep and the mover decide the same way (one decide(), one modelOfFrom()).
5. The reason says which limit ("its Fable limit is at 100% of the week, which resets in 41 h").

## Evidence
Splinter's probe of account c, 11-21 04:45 UTC: `limits` = weekly_all 55%, weekly_scoped Fable 100% (shape in the card). Agent1s transcripts hold 60 scoped entries, all "Fable"; the board names that model "Fable 5.2", so models are matched by their first word, case-blind.

## Calls
- Per agent, not per account: two agents on one account can go two ways, or one be held.
- Unknown model: never at risk by a model limit (nothing says which it draws on), but kept off a full one as a target.

## Rejected
- Reading `is_active` or `severity`: percent and reset are what the overall rule uses; the two flags are the endpoint's own summary of the same numbers.

## Weakest premise
- First-word matching is measured on one family only ("Fable"). A future scoped limit named differently from the board's model name (e.g. by id with no display name) is skipped, which fails toward the old behaviour.
