# emptysetup-8783: the iPhone Agents empty state offers Make an agent (kosmos#8783 item 2)

A cloud-only customer (11-19) saw "No agents yet / Make your first one on your computer." with no button and reached
setup only through Settings. Mona Lisa's design (m5012, m5015, approved m5064): heading kept; line "It takes a few
steps, and you can stop at any point."; one button, "Make an agent", opening the BOARD's New agent form (never the native
sheet), so a person not set up meets first-run on the board and one set up lands on the form. One tap, no auto-jump.
Built: createOnBoard closure in AgentsView (declared before create), ContentView passes openCreate(.agent).
Tests: ios.agents-empty-setup-8783.test.js (3; perturbed). Simulator build clean (iPhone 17 / iOS 27), shots in
~/work/design-shots/kosmos-8783-ios. Not shown: a signed-in landing (the sample board has no real sign-in).
