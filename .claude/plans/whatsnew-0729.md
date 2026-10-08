# whatsnew-0729: the in-app What's New for Mac 0.7.29 (staging cut)

Two highlights, each resting on code merged to main after the 0.7.28 cut froze (ad53c44f1):
1. **Kosmos fits a phone screen better** (phonepass-5510, settingsfit-5510): a project's name gets two lines on a
   phone, the PROJECT ROOM's message box hint is no longer cut off (the room's emoji button is hidden on a phone
   touchscreen; the keyboard's covers it), and Settings' Community section (the business-kind select) fits. Review
   round 1: at 320 px in WebKit the Settings panel still scrolls 10 px sideways from its section strip, so the text
   names the Community section rather than all of Settings. Untagged: the board page
   is the same page on Mac and Windows boards.
2. **Your board stays in its window** (#5169, native-app/main.swift, PR #5482; mac only): on a computer that runs
   agents, another site can no longer replace the board in the Kosmos window (a redirect or a script is refused; a
   clicked link opens in the browser). Review round 1: board links already opened in the browser before (target
   _blank), so the change is the protection, and the text now says that rather than implying clicks used to
   replace the board.
   **Also shipping, not announced:** on a CONNECT computer, an unclicked navigation to another https site used to open
   in the browser and is now refused (the same #5169 rule), except the Kosmos+ site's own checkout hand-off
   (isKosmosPlusSiteURL). Recorded here so a "nothing happened after sign-in / checkout" report from a connect Mac
   can be triaged. Weakest premise: an
   UNCLICKED navigation to another site (a redirect or script) is now refused, with only the Kosmos+ checkout
   hand-off excepted; a provider sign-in that navigates the window that way on a run computer would now be blocked.

Left out on purpose (researched by a subagent, reviewed by me): the new look (off by default), Enterprise and plugin
engine pieces nothing calls yet, Windows-only #5386, Linux and CI install changes, the site auto-deploy, and tests,
guards and proofs. Not announced although reachable: "Your company" in Settings (#5531, no flag; whether companies
can issue codes yet is not mine to announce), At a glance (#5393, odd while several Kosmoses are off), agents editing
their community posts (#5574, service deploy unconfirmed), the org-chart import consent checkbox (#5590, an install
count: the install-numbers rule).

Checked with origin/main's tools/whats-new-check.js for 0.7.29.

## Review round 2 (sonnet): fixed
- "Clicked links to other sites": a click on a Kosmos+ url or this computer's own board stays in the window.
- "fits most phone screens": the Community section's fix holds at about 360 px; at 320 px WebKit still scrolls 10 px.
