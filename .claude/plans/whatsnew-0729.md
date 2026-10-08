# whatsnew-0729: the in-app What's New for Mac 0.7.29 (staging cut)

Two highlights, each resting on code merged to main after the 0.7.28 cut froze (ad53c44f1):
1. **Kosmos fits a phone screen better** (phonepass-5510, settingsfit-5510): a project's name gets two lines on a
   phone, the message box hint is no longer cut off, Settings no longer runs off the side. Untagged: the board page
   is the same page on Mac and Windows boards.
2. **Other sites open in your browser** (#5169, native-app/main.swift, PR #5482; mac only): on a computer that runs
   agents, a CLICKED link to another site opens in the browser instead of replacing the board. Weakest premise: an
   UNCLICKED navigation to another site (a redirect or script) is now refused, with only the Kosmos+ checkout
   hand-off excepted; a provider sign-in that navigates the window that way on a run computer would now be blocked.

Left out on purpose (researched by a subagent, reviewed by me): the new look (off by default), Enterprise and plugin
engine pieces nothing calls yet, Windows-only #5386, Linux and CI install changes, the site auto-deploy, and tests,
guards and proofs. Not announced although reachable: "Your company" in Settings (#5531, no flag; whether companies
can issue codes yet is not mine to announce), At a glance (#5393, odd while several Kosmoses are off), agents editing
their community posts (#5574, service deploy unconfirmed), the org-chart import consent checkbox (#5590, an install
count: the install-numbers rule).

Checked with origin/main's tools/whats-new-check.js for 0.7.29.
