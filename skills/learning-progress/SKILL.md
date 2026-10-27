---
name: learning-progress
description: >
  Shows the learner how they are doing in a Teach Me course: accuracy, right at the first try, hints, time per
  answer, days active and the learning curve. Use when the learner asks "how am I doing", "my progress", "show my
  stats", "accuracy", "learning curve", "how much have I learned" or "progress" in a folder with a Teach Me course.
---

# Learning progress

The numbers come from the learner's own answers, which the engine already logs. Never estimate or invent them.

1. Call `mcp__teachme-anything__progress` (no arguments). It opens the **Progress** screen in the VS Code lesson
   view and the terminal pane, and returns the same numbers as text.
2. Reply in at most 3 short sentences:
   - the headline: share right and number of answers;
   - the direction of the curve: first value versus now (better, steady or lower);
   - one next step, taken from the weaknesses line if there is one.
3. Point to the screen for the rest: "The Progress screen shows the curve and every skill."

Rules:
- If the tool says there are no answers yet, say the screen fills in after the first questions, and stop.
- Never list every number in chat; the screen holds them.
- Do not grade, praise or compare the learner with others; describe the trend in their own numbers.
- The learner returns to the lesson with **Back** (key `b`). Their place is kept.
