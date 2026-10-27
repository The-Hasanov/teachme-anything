---
name: strengths-weaknesses
description: >
  Tells the learner what they are strong at and what to work on in a Teach Me course, from their answers: the
  skills they get right most, the misconceptions still open, and the skills with low accuracy. Use when the
  learner asks "what am I good at", "my weaknesses", "my strengths", "what should I practise", "where do I go
  wrong" or "what am I bad at" in a folder with a Teach Me course.
---

# Strengths and weaknesses

1. Call `mcp__teachme-anything__progress` (no arguments). It opens the **Progress** screen in the VS Code lesson
   view and the terminal pane, and returns `Strengths:` and `Weaknesses:` lines.
2. Reply in at most 4 short lines:
   - **Strong:** up to 2 skills from `Strengths:`, with their share right.
   - **To work on:** up to 2 items from `Weaknesses:`, each in plain words.
   - **Next:** one action. For an open weakness: "Keep going: the lesson brings it back in a warm-up." For a skill
     with low accuracy: the curriculum phase that holds it.
3. If both lists are empty, say there is not enough to tell yet (a strength needs a few right answers on a skill).

Rules:
- Name a weakness as the idea to fix, never as a judgement of the learner ("the idea that X", not "you are bad at X").
- Never explain the answer to a step the learner has not solved yet; the lesson gives drills for that.
- Weaknesses are re-checked by the engine on a schedule; do not start a drill in chat.
