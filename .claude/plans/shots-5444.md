# shots-5444: three shot screens for 0.7.26 surfaces (kosmos#5444 item 3)

Finished means: `docs/browser-checks/mobile-shots.js --screens usage-loading,task-missed,project-shared` produces
a correct picture of each surface at phone and desktop, light and dark, and each verify hook deletes a wrong one.

- usage-loading: /api/usage held open; verify the reading line is up with its spinner.
- task-missed: task 1 given a daily 9am rule set 3 days ago with no run; fields from engine taskrepeat.fieldsOf;
  verify #tk-repeat-line leads with "Missed".
- project-shared: seed project given p.shared {owner, description}; verify "Shared by <owner>.kosmosplus.com."
- Only reads are faked (page.route); the board store is untouched, so no `after`.

Evidence: 12 shots, 0 overflow, 0 errors (~/work/design-shots/kosmos-5444-shots). Tests that reference the tool:
mobile-shots-desktop 12/12, leak-718 8/8, control-arms 10/10, reason-grep 7/7, fixture-discipline 20/20.
