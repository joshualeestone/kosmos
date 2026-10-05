# whatsnew-0723: the 0.7.23 "Kosmos has been updated" highlights

Required by the cut: tools/release.sh refuses a version with no web/whats-new.json for it (KOSMOS_CUT_NO_WHATS_NEW
is the hotfix opt-out only). Five lines, each checked against what is merged on main since 0.7.22 (2c39de6ea):

| line | from | checked against |
|---|---|---|
| Name an agent file as you add it | #4962 (#5274, de29d517d) | the Name field on a row the scan could not name; left empty, it still adds in one click when the file's own parse finds a name |
| Token Usage for every provider | #5158 slices 1 and 3 (#5163 c11ea424c, #5180 344f3bba9) | engine/usageproviders.js scans Codex (OpenAI), Gemini CLI and Antigravity (Gemini, key and Google subscription) and Grok; usage.js mergeProviders feeds per model and By agent. Named by the providers the screens use (OpenAI, Gemini, Grok), not the terminal tools |
| Org charts read without Claude | #4560 (#5255, 0d40d617b) | engine/orgchartfile.js currentReader: Claude first whenever claudeHere(); a key reader only otherwise. engine/orgchartkeys.js: ENABLED_DEFAULT { openai: true, google: false, xai: true } (Gemini OFF in v1: Google's free-key terms); a Grok key reads a PNG or JPG picture only (OFF_WHY, cannotRead). The first draft said Gemini and Grok PDFs: false, caught in review |
| Key accounts show their key | #5150 (#5280, 462eb8be0) | web/index.html acctParenthetical: name, else email, else 'API key ending ' + keyTail, on the agent page's Right now line (so only a key account with no name) |
| A refused Restore says why | #4976 (#5081, 328b3ab99) | web/index.html: btn.textContent = 'Not restored' and the engine's reason in #removed-msg; the place is "Show removed agents", so the line says "your removed agents" |

Left out, on purpose:
- #4794 pairing with a code: it needs the connector this cut ships and coordinator routes not checked live here.
- #4649 federation screens: behind the federation switch, OFF for live users.
- #5212 community home: an agent-facing CLI change, not a person-facing screen.
- Fixes with no visible feature: #5112, #2624, #5161, #2600's terminal note.

No platform words in any line and no platform tags: each change is in the shared web page or server, so the
window shows all five on both platforms. tools/whats-new-check.js 0.7.23 passes for mac and windows.

Weakest premise: the word "Gemini" in the Token Usage line covers both the Gemini CLI and Antigravity (Google
subscription); a person who knows only one of them may not expect the other to count. Lesson from review 1: the first
draft's org chart line was false (Gemini is off for org charts, Grok reads pictures only); every line is now
checked against the engine file that decides it, not the PR title.
Review 2: the key readers are a fallback (currentReader uses Claude whenever the computer can run it), so the org chart
line says "Without Claude set up". The Codex, Gemini and Grok session scans use os.homedir() with no platform branch;
not run on a Windows box here.
Review 3: "Grok API key" (accountsFrom keeps authMode apikey only, so a Grok subscription does not read org charts);
the key-account title says what the line shows. ACCEPTED, not measured: the Token Usage line on Windows. The scans
have no platform branch (os.homedir), so it is reasoned true there; it has not been run on a Windows box.
