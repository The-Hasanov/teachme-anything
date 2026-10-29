---
name: next-lesson-arrives
description: A generated course is written by the author subagent, then a second author run (a build-with-me project) is answered too. Catches #12 and #13.
tags: [release, e2e]
runs: 1
max_turns: 90
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill]
---

teach me JavaScript on Node.js. I already know Python well.

The course is written in the background and takes a few minutes. Do not write or submit it yourself.

Then say "build with me" with this idea: a command-line todo list that saves to a JSON file. While it answers that
the course is still being written, try again, up to 40 times. Once it says the project is being planned, call the
Teach Me snapshot tool, up to 40 times, until the snapshot names the project.
