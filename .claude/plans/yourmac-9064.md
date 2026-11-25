# yourmac-9064: the iPhone says "your computer", not "your Mac" (kosmos#9064, Splinter 08:39)

Finished means: no line a person can read in the iPhone app says Mac when it means their computer (Kosmos runs on
Windows too), the tests that pin those sentences say the new words, and it ships in the build AFTER the #7352
submission build (stacked on #9063, which changed the "no computer yet" line; merge after the submission cut).

## Built (my wording call; Josh can overrule)
- AgentsView: the waiting screen ("Your computer is showing a code. Check it matches", "Your computer is asking
  whether to let this iPhone in.", the orb "Waiting for your computer"), the connecting screen ("just after your
  computer starts"), and "No computer to connect to."
- SignInView: "Allow this iPhone on your computer", "Your computer is asking...", "Waiting for your computer" (twice),
  "Your computer said no", "Your computer did not let this iPhone in..." (twice), "ended before your computer answered".
- ShellLogic: "Your computer isn't answering", and "your computer" / "the computer called <name>".
- Where a screen already names the computer ("Allow this iPhone on Studio Mac."), the name stays and the lines around
  it say "your computer".
- Tests updated: LogicTests main and sweep, SignInUITests and CentredWaitsUITests (the orb's accessibility name).
- Left alone: sample data ("Studio Mac", "Safari on a Mac"), log lines, code comments, and the web board's own words.

## Checked
Every iOS logic suite passes; every ios/Kosmos source typechecks at iOS 16.
