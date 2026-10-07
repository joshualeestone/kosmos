# usagecut-5367: one cut for every Token Usage scan (kosmos#5367)

#5370 (#5363) made Claude's transcript scan skip files last written before the window, with a one-hour margin (windowCutMs in engine/usage.js). The other providers' scans (Codex, Gemini, Grok in touchedSince; Antigravity's conversation skip) already cut by mtime since #5158, but at midnight exactly. This exports windowCutMs and points both at it, so every scan cuts at the same instant. A day that is not a real date is now a full read (the old comparison was with NaN and read nothing).

Tests: engine/usageproviders-5158.test.js and engine/usageagy-5158.test.js each gain a case 30 minutes inside the margin (read) and 90 minutes outside (not read); both fail on main's usageproviders.js.
