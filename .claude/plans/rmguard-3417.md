# rmguard-3417: Claude's own safety prompts never reach the person (auto-approve, Josh's ruling)

Card: joshualeestone/kosmos#3417 (Josh 2026-10-22 11:25: "I shouldn't get these warnings"; ruling 11:39: "id rather
it just auto approve stuff like this").

## Done means

An agent Kosmos launches that runs `rm -f "$S"/*.png` gets no "Needs permission" and nothing in chat, proven by the
no-hook vs. allow-hook measurement below (manual, recorded on the card), and a test fails if decide() ever stops
answering it. The in-repo test cannot see whether Claude keeps routing the check through the hook.

## Measured (Claude Code 2.1.308, interactive, --dangerously-skip-permissions, 2026-10-22 11:28)

- No hook (control): the prompt Josh saw ("Dangerous rm operation on possibly-empty variable path ... automatically
  deny in 1:36").
- Kosmos's PermissionRequest allow hook (main today): no prompt, "Allowed by PermissionRequest hook", the rm ran.
- So Kosmos-launched agents already auto-approve this check. Irma saw it because fleet bots launch without Kosmos's
  --settings file (launch-irma-bot.sh has no --settings).

## Decision

Option (a), per Josh's ruling. (b) (deny with the rewrite hint) was built first and measured working, then overruled;
it is not in this branch. No engine change is needed: this branch adds tests that pin the allow for the safety-check
shapes, so a future narrowing of decide() cannot bring the prompt back silently.

## Weakest premise

Measured on one check (dangerous rm) on 2.1.308. Another Claude safety check that does NOT go through the
PermissionRequest hook would still prompt; none is known today, and nothing in this repo runs Claude Code to catch it.

The cost Josh accepted: with the variable empty, an approved `rm -f "$S"/*.png` deletes `/*.png`. The tests lock that
in on purpose and say so, so a later tightening goes back to him rather than reading the red test as a requirement.

Evidence for "Measured": https://github.com/joshualeestone/kosmos/issues/3417#issuecomment-6346077364

The first test's shapes pass because decide() allows Bash generally, not through any rm-specific rule. It catches
any narrowing that would refuse them, rm-specific or not.

## Out of scope, routed

Fleet bots: add `--settings "<Kosmos data>/agent-permission-settings.json"` to their launch (shared launchers:
kosmos#6911, April). The raw dump in chat is #6727.
