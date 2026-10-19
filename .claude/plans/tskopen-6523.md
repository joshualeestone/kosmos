# tskopen-6523: one way back on a project's Tasks view

Card: #6523 (PigeonPete's 0.7.57 noise read). Mona Lisa agreed on two conditions.

## Plan
1. Remove "· Open project" from the Tasks crumb (tskPaint). The title's chevron (#4586, Josh's ask) is the one way back. The crumb keeps "All tasks › <path>" (#3029).
2. The chevron names the project in its aria-label AND its title, and clears the title when no project is picked (condition 1). Its 44px touch hit area stays (condition 2).
3. Retire, not skip, the #5072 crumb CSS and its four render-subback-4586 arms. Add one arm at 390 on a touch context measuring the chevron's name and hit area.
4. Move render-alltasks' way-back arm to the chevron. Sweep every check that reads the crumb by content (render-subprojects-1994's door arm matched the removed dot).
5. web.tskopen-6523.test.js, red on main. Shots for Mona, blind review to convergence, validation, proof, PR.
