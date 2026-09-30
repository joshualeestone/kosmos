# #4570: the agent page's Files "View All" is the project page's small link

## Finished looks like
- On the agent page, the Files box's View All has the same computed size and weight as the project
  page's Files View All (11px / 600 via --consolidated-link-size), in light and dark, desktop and phone.

## Cause
`.dfiles-head .pj-viewall` set only display and width, so the link inherited the body size (14px) and read
as a second heading. The project page's tab-layout rule sets `font-size: var(--consolidated-link-size)`;
the consolidated layout already did for both.

## Decided
- Casing stays "View All": the project page's link, which Josh asked to match, reads "View All" too (his
  message typed it lowercase). Weakest premise: that he wants the lowercase on both; that is one string each.

## Verification
- render-agent-files-3614.js compares the two links' computed size and weight on the same page at all five
  arms (94 pass); against origin/main's page it fails (14px vs 11px).
