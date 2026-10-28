---
name: build-with-me
description: >
  Starts a project the learner and Teach Me build together, milestone by milestone, as the next phase of their
  course. Use when the learner says "build with me", "let's build something", "I want to make a project", "give me
  a project", "practice on a real project", or names an app they want to build while learning.
---

# Build with me

The engine runs the project: the learner picks it in the lesson view, a background author plans the milestones,
and each milestone adds the boilerplate and tests to their folder before they write the core. Your part is the
start.

1. If the learner named a project (here or in the skill's arguments), call `mcp__teachme-anything__build_with_me`
   with `idea` set to their words. If there is no course in this folder, also set `subject` to the language or stack
   it needs.
2. Otherwise, call `mcp__teachme-anything__snapshot`, then call `mcp__teachme-anything__build_with_me` with 3
   `suggestions`, each `{ title, pitch, subject }`:
   - **title:** 2 to 4 words;
   - **pitch:** one sentence on what it does and which course skills it practises;
   - Fit them to the snapshot's **Level** line. Build them from the **Can use** skills, with at most one skill from
     **Not started** as the stretch. The engine rejects a project that needs more than one.
     - new or beginner: a tiny tool with one clear output (a word counter, a unit converter);
     - developing: a small tool with input, logic and a saved result;
     - confident: something with a few parts that work together and a design choice to make.
   - Use the "They said" intake answers for what the learner wants it for. Keep them real and small: a CLI tool, a
     small service, a data script. Not a game clone, and not a copy of an existing product.
   - Make the 3 different from each other: one practical, one about data, one with a visible result.
   - No course in this folder: base the suggestions on what they said they want to learn.
3. Say one short line, e.g. "Pick a project in the lesson view, or type your own." Nothing else to do: the lesson
   view takes it from there.

If the tool answers that the course is still being written, say so and suggest trying again in a minute.
Never write the learner's code for the project. Their part is the core of each milestone.
