# codefield-8783: the Claude code field on a phone (kosmos#8783 item 1)

Found live 11-19 with a new customer on the iPhone app (TestFlight build 65) and a cloud machine: at first-run's Claude
sign-in the paste field sat below the scrolling wizard body, under the pinned Cancel footer, with no cue.

## Finished means
On a phone the sign-in link, the field and Use code are on screen when the step appears and after the link arrives,
clear of a bottom fade that shows while more sits below (Mona Lisa's design, approved 20:42 CST). The field is never
focused (the keyboard would cover the link the person must open first).

## Decided
- No focus (Splinter relayed "focus it"; rejected for the keyboard reason). What would change it: iOS measured keeping
  the link visible above the keyboard at the smallest supported phone.
- Mona Lisa's fade: a mask (as #s-nav, #5303), no top fade, no words or chevron.

## Not measured
The mask on a scrolling element in the real iOS WKWebView: the shots are Playwright Chromium. Check on the next
TestFlight build.

## Item 2 (setup only via Settings): separate, in the iOS app; plan on the card.
