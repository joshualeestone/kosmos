# suggest-inapp-3842: kosmos#3842 in-app half

The wizard address chooser (#plus-si-name, only when the account has no address) and the enrol flow field (#plus-name) start with a private 8-character suggestion (lowercase + digits, no 0 o 1 l i, crypto with rejection sampling), with a one-line note tied by aria-describedby. Typing replaces it; Start over clears it. The coordinator stays the authority on availability.
