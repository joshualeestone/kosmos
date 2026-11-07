# shots-8140: #8140 item 1 design shot, and the chip gap it found

The design shot of #8143 found the chip reading "1/4 , 3 on hold": .tsk-chip is inline-flex with a 4px gap, and the
visually hidden " subtasks done" split the visible text into two flex items. Fix: the words sit in one inner span in
both plain-span renderers (project card tkcard chip, Tasks row chip); the button form is one string already. Three web
tests pin the new markup and fail on the old. Three design-shot screens added to mobile-shots.js (throwaway projects,
deleted after each shot). Shots: ~/work/design-shots/kosmos-8140, 12 at desktop and iPhone 15, light and dark.
