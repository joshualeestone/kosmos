# kosmos#7797 item 3: the met-condition line for a hold for you

Branch metforyou-7797, stacked on waitingonyou-7788 (kosmos#7788). Rebase onto main once #7788 merges.

## Finished looks like

When a hold for the person (`--for-you`) also waits for a task or a time and that is met, the one line its owner gets
says the hold also waits on the person and to take it off hold only once they have answered. A plain hold's met line
is unchanged.

## Call (Mona Lisa, 2026-11-02)

Reword, do not skip: the owner chose the condition and should hear it was met. Rejected: skipping the met line for a
hold for you (the agent would never learn its own condition happened).

Weakest premise: that an agent reads "only once they have answered" as a condition and does not lift at once.

## Steps

1. holdstale owed() carries forPerson; metText words it. Test in engine/holdcond-7180.test.js with a plain-hold control.
2. The other #7797 items (slice B, the project page, Save, the "?" tile, CLI unmark) are separate pieces.
