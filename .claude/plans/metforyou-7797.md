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

## Item 2, the project task card (2026-11-02 14:1x)

The project page's task card says "On hold until you answer: <reason>" for an agent's hold for the person (and
"On hold until you answer" with no reason), as the Tasks row does; a plain hold keeps "On hold: <reason>". Checked in
render-onhold-4771 in both viewports. The project page's needs-you COUNT is still roster-only: next piece.

## Item 2, the project's count and card word (2026-11-02 14:2x)

Call: the project summary carries heldForYou (open tasks an agent held for the person; no roster needed). The project
card reads the calm Question for it (as an agent's own question does), below a member's Issue and above Paused; the
Projects "need you" tile counts a project holding one, also when the agents cannot be read. The iPhone app's
projectWord mirrors it. Rejected: adding these tasks to summary.needsYou, which counts MEMBERS and names each in the
Issue list; a task is not a member. Weakest premise: that Question (calm) is the right weight for a hold; it is the
weight of the agent question it stands for.

## Item 6, unmarking from the CLI (2026-11-02 15:0x)

`kosmos task hold <p> <n> --not-for-you` sends forPerson false: the task stays on hold and leaves the person's list.
Both switches together are refused (exit 2); as the value of --because it is words. An older board that keeps the mark
gets an honest sentence and exit 1, as --for-you does. Mac and Windows, help lines on both.
