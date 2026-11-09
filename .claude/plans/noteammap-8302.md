# noteammap-8302: remove the Team map (kosmos#8302)

Josh, 11-09 10:18: "let's get rid of this team map thing. This makes no sense. We need to take it off"

## Done when
Served on PROD: neither the project page's Members card nor the consolidated layout's Agents rail has a Team map button or box.

## Change
web/index.html: the two buttons and boxes, their painters and listeners, pjTeamMap, PJ_TEAMMAP_OPEN, and the styles only they used. Removed the checks that existed only for it (render-teammap-6103, render-teammap-rail-6324, web.teammap-*), the rail-cap step of render-projects, and the mobile-shots entry. The rail's notice cap is back to its own 40vh rule.

## Left alone
The data underneath: orgTreeOf and the org chart still use it.

## Weakest premise
That nothing outside the two surfaces relied on the map: a sweep of docs, tests, engine, ios and tools finds no reference left.
