# Build Notes

This document describes the build pipeline for the web frontend: the bundler
config, the test runner, and the deploy step. It is an ordinary project
instruction file - the kind almost every repo has - and it belongs to nobody.

## Requirements
Node 20 or later, and a Postgres database for the integration tests.

<!-- THE LOAD-BEARING NEGATIVE CONTROL. It has NO "You are ..." line, so discovery
     must NOT offer it. Without at least one must-NOT-find fixture, a discovery that
     offers everything indiscriminately would pass every other fixture here. This
     one failing to be ignored means discovery got too eager. -->
