---
name: teach-codebase
description: >
  Starts a Teach Me course on the project in this folder: its architecture, conventions and tests, with exercises
  on a clone of it checked by its own tests. Use when the learner says "teach me this codebase", "teach me this
  repo", "help me understand this project", "onboard me to this code", "how does this codebase work, teach me", or
  asks to learn the code they are in rather than a general subject.
---

# Teach me this codebase

The engine writes and runs the course: the author agent reads the project, and every exercise runs on a clone of
it in `practice/`, so the learner's own working tree is never touched. Your part is the start.

1. Find the project's main language or stack in one look: the build files at the root (`package.json`,
   `pyproject.toml`, `composer.json`, `go.mod`, `Cargo.toml`, `*.csproj`, `pom.xml`). Do not read further: the
   author reads the code.
2. Call `mcp__teachme-anything__start_course` with `codebase: true`, `subject` set to that language or stack (e.g.
   "Laravel", "Node"), and `background` set to what the learner said they already know, in their words, if they
   said it.
3. Say one short line, e.g. "Answer the 3 questions in the lesson view while I read the project (about 3 minutes)."
   Nothing else to do: the lesson view takes it from there.

If the tool answers `resumed`, a course is already in this folder: say so in one line and point to the lesson view.
If the folder has no code (an empty or new folder), say so, and suggest "teach me <subject>" instead.
Never explain the codebase in chat yourself. The course does that, with exercises that are checked.
