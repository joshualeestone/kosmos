# whatsnew-0728c: entry 4 of the 0.7.28 highlights (#5456)

Follow-up to whatsnew-0728 (PR #5503) and whatsnew-0728b (PR #5505). The full plan, entries, exclusions and wording history are in .claude/plans/whatsnew-0728.md (section "Follow-up").

## Entry 4
- Feature: #5456, PR #5458, merged 16:56 CDT 10-07 as f9abdf421 (on main, after the 0.7.27 pin f443ad947, before the 22:00 freeze).
- Platforms: both (a Tasks view and project-room change in the board's web UI; nothing platform-specific).
- icon tasks; title "Scheduled tasks no longer read as unassigned" (44/48); line 133/140 (Mona's wording, 16:59).
- What the person sees, from the PR: a new Tasks group "On a schedule" with its own tile; Unassigned leaves these tasks out; the project room card says "On a schedule" instead of "Nobody yet" (unless held).
- Not claimed: the assigner change (it no longer hands such a task to an idle agent) is real but invisible on a screen, so the line does not mention it.
- Copy: Mona, 16:59. My draft said "because your own scheduler runs it"; Kosmos does not know that, and the app itself says it as an if (web/index.html, the On a schedule group: "If a scheduler of yours runs them, nothing is needed; if an agent should, give one to an agent."). Her line carries the app's own way out, with its verb.

## Check
node tools/whats-new-check.js 0.7.28: 4 highlights, mac 4, windows 4.
