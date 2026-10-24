# avatarcheck-6722: render-avatar-4038 presses Save in the picture editor

Done when: render-avatar-4038 passes on main's page again (it chooses a picture, the #6722 editor opens, Save is
pressed, "Saved." is written), with a check that fails if the editor does not open, and a control run showing main's
unchanged check fails on that page.

Why it broke unseen: #6722 (PR #6828) made every picture chosen for an agent or for the person open the editor first.
#6828's own CI did not run render-avatar-4038 (it was not in that PR's selected subset: "SKIP render-avatar-4038 (not
in KOSMOS_BC_CI_ALLOWLIST)"), and the surface checks I ran for #6722 did not include it. PR #6869's CI did select it,
and it timed out there. The product is right (the editor by design); the check was out of date.

Rejected: changing the page so the agent picker skips the editor (the editor is #6722's point).
Weakest premise: that no other check chooses a picture the editor now catches. Swept: only render-avatar-4038 and
render-orgchart-file-4559 call setFiles/setInputFiles, and the org chart's #orgchart-file does not go through
cropPicture (whose callers are #d-file, the person's picture, and one more 'Use picture' path).
