# help-flag-1674: asking a verb for help SENT the flag as a message

kosmos#1674.

## Problem

`kosmos reply --help` did not print help. It **sent `--help` as a message** and answered *"Answered. It is in their conversation with you."*

`cmd_reply` takes `text="$*"`, so every argument is the message and no verb in the CLI handled `-h` or `--help` at all. `report --help` likewise reached the state parser and answered *"that is not a state we know"*.

**`msg` and `post` were safe only by accident.** They need two arguments, so a lone flag lands in their usage branch. `kosmos msg <agent> --help` sent it just the same.

I found this by doing it, while probing whether the verb existed, and **I did it twice** before the guard existed.

## Why it deserves a fix rather than a note

`--help` is what you type when you do **not** know what a command does, which is exactly when it must not act. It is also the first thing an agent discovering the CLI would try, and the doctrine and the message envelope both name CLI verbs.

## Change

**One guard before the dispatch**, not a flag per verb, so a verb added later is covered without anybody remembering. Same reasoning as the trap-not-15-call-sites choice in the gate logging PR.

For an argument-taking verb it re-dispatches with **no** arguments, because those verbs already print their own usage in that case. **Reusing that string is deliberate**: a second copy in the guard would be two renderings of one sentence, free to disagree the day somebody edits either.

A bare `-h` / `--help` prints the verb list and **exits 0**, because asking for help is not an error.

## Decisions I made, and what would change my mind

- **`-h` and `--help` are reserved in ANY argument position**, not just the first. That is what most CLIs do and it covers `msg <agent> --help`, which is the case a reader assumes is already safe. **The cost: an agent can no longer send the literal string `--help` as a message.** I judged that far less likely than someone typing it to learn the command. If anyone needs to send it, that is the thing to reconsider.
- **`help` as a bare word is NOT intercepted.** It is a plausible message body ("help with the deploy"), and the flags cover the reported defect.
- **Exit 0 for the bare form; the per-verb form keeps its existing exit.** Changing the usage path's exit code is a wider change than this card.

## Verification

Every arm proven able to fail, with the perturbation asserted applied **and** the script asserted to still parse:

```
guard neutered so it never fires   ->  4 of 5 arms RED, script still parses
restored                           ->  5 of 5 pass
```

⚠️ **My first perturbation was VOID and I am recording it:** deleting the block left a dangling `fi`, so the arms failed on a syntax error rather than on the absent guard. Asserting the guard was gone was not enough; a perturbation must leave a valid program.

**Every test arm pins `KOSMOS_PORT` at a dead port.** Without that, a regression in the guard would make this suite send real messages to whatever board is running on the developer's machine, which is the defect under test.

**The control is load-bearing:** a guard that intercepted everything would pass the other four, so the last arm proves the send path is still reachable. It stays green under the perturbation, which is correct.
