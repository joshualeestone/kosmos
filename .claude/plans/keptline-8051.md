# keptline-8051: a kept Create form says why it is back (#8051 item 1)

Call (Mona Lisa, design): keep the 30-minute window and SAY it on the form, with a way out.
- Rejected: ending the keep on a tab switch away from Settings. A person fixing their account often goes Settings,
  their email or browser for a sign-in, then back; that is the case the keep exists for, and it would lose their form.
- Rejected: shortening it. Any window still brings the form back unexplained to someone who gave up.
- Weakest premise: that a person who gave up reads one line under the title before retyping. If they do not, the old
  name and instructions are still in front of them, which is the cue the line names.

Finished looks like: a New agent inside the window shows "This is where you left off before going to Settings. Start
over" under the title; Start over empties the form onto the three-way choice and the line goes; a plain New agent never
shows it. Checked in docs/browser-checks/render-nomodel-8040.js (both arms: passes here, fails on main's page).
