# #4629: the app calls it Kosmos+, the product's name

Card: joshualeestone/kosmos#4629. Splinter's call (19:55Z, Josh can override): the Settings entry becomes Kosmos+, matching the product name everywhere else; keep `data-go="plus"`.

## What changed
Every string a person sees or hears that said "Kosmos Plus" now says "Kosmos+": the Settings nav pill, the section and logo accessible names, the switch label, the gate modal title and its three sentences, the external-invite tip, "Lost your phone?" and Disconnect sentences (web/index.html); the webhook internet-link reasons (server.js); the shared-project room sentence that points at "Settings, Kosmos+" (engine/fedseats.js); the repair sentence that names the switch (engine/remote.js); the Mac app's could-not-reach alert and its title (native-app/main.swift). Keys and ids unchanged. Comments left alone, except continuation lines the rename touched, where the new name is now accurate; a quotation of Josh keeps his words.

## Not here
The relay's needs-you email ("then Kosmos Plus") is kosmos-relay; handed to Ice Cream Kitty with #4628, per Splinter. The sign-in page step 2 (the card's original ask) already says Kosmos+, which now matches the app.

## Tests
Updated pins: server.webhooks-1307, web.remote-unreadable-4308, web.allow-card, and browser checks render-plus-gate-1615 (fails on main's page: 4), render-plus-panel-3829, render-fed-plus-gate. Also run clean: render-settings-nav, render-user-menu-3051, render-waiting-phone-718, and the unit files that mention the name (340 tests).
