---
name: explain-step
description: >
  Explains the idea behind the learner's current Teach Me step without giving away the answer. Use when the
  learner asks about the step in front of them: "I don't get this", "explain this step", "what does this question
  mean", "why is B wrong", "why was my answer wrong", "can you see the question", "help with this one" in a
  folder with a Teach Me course.
---

# Explain the current step

The learner is looking at a step in the lesson view. Its text, code and numbered choices are in
`<teachme-position>` on their message. If that block is missing, call `mcp__teachme-anything__snapshot`.

1. Read the "What they see", "Code" and "Choices" lines, and whether they answered ("They answered N: right" or
   "wrong") or said they do not know.
2. Answer by case, in at most 3 short sentences, plain words, no headings or lists:
   - **Not answered yet:** explain the idea the step tests, using a different, smaller example than the step's
     own. Never say which choice is right, never rule choices out one by one, and never give the command or code
     that solves a task.
   - **Answered:** the answer is no longer secret. Say why the choice they asked about is right or wrong, and what
     idea it shows.
   - **A task with a check:** explain what the check looks for and which idea gets there, not the command.
   - **The meaning of a word or symbol:** define it plainly with a one-line example.
3. Connect it to something they already know when you can: the snapshot lists their skills and what they said in
   the intake.
4. End by pointing back to the lesson view: "Try it in the lesson view," or "Press Next when you are ready."

Name steps by their title, never by an id. Do not edit `.teachme/` or `practice/`.
