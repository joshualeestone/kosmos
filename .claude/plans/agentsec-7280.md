# agentsec-7280: an agent deep link can open a named section (kosmos#7280)

## Finished looks like
`?tab=detail&agent=<session>&sec=model` opens that agent's AI Settings (and `profile`, or any other section in
DETAIL_SECTIONS except talk and swarm), scrolled to the top on a phone, instead of the conversation. A missing,
unknown, talk or swarm `sec` lands on the conversation as today. `sec` on `?tab=settings` stays Settings' own.

## Shape
- web/index.html: WANT_AGENT_SEC read once at boot beside BOOT_TAB; settleWantAgent passes it to openDetail (which
  already takes a section) and, when set, scrolls that section into view on a phone instead of revealing Talk.
- render-waiting-phone-718.js arm (e): the link with &sec=model and with an unknown sec, on a phone. Control: the same
  check against origin/main's page must fail the sec=model arm.

## Decided
- The phone half (the agent page's "Open on your computer's board" row passing sec=model) is not in this change: that
  row is #7267, Mona Lisa's, not merged. Rejected: building on her unmerged branch. She is told; the board accepts the
  parameter from now on, and an older board ignores it (lands on the conversation), so the row can pass it at once.
- Swarm excluded: its box exists only on a swarm's page, and detailGo would fall back to Talk without the reveal.
- Weakest premise: that scrolling the section to the top is right on a phone. The stacked layout puts the pills above
  the section, so the person sees AI Settings first; on a wide window nothing scrolls, as for Talk.

## Review 1
- Fixed: the landing uses the same hold as the conversation (detailRevealTalkOnPhone takes the section), because the
  Files list paints late above every section. Arm: a late 8-row Files list; control: the hold replaced by a one-shot
  scroll must fail it.
- Fixed: a link opens only model, memory, profile, instr, skills or files; term and remove (a destructive control) land
  on the conversation, as talk and swarm do. Arm for each.
- Known, not changed: on a wide window a folded name opens its group at the top, as its pill does.
