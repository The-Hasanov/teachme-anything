import type { Course, Segment } from '../../hooks/engine/types'

export const course: Course = {
  "format": "teachme.course/1",
  "id": "bigo",
  "subject": "Big-O: how code grows",
  "goal": "tell how fast a piece of code grows with its input",
  "intake": [
    { "id": "know", "q": "Have you met Big-O before?", "options": ["Never", "I know the words", "I use it sometimes"] },
    { "id": "code", "q": "How much do you code?", "options": ["Every day", "Sometimes", "I am learning"] },
    { "id": "why", "q": "What is it for?", "options": ["Write faster code", "Job interviews", "A course"] }
  ],
  "skills": [
    { "id": "count-steps", "title": "Count how the steps grow", "type": "concept", "prereqs": [], "misconceptions": [
      { "tag": "constants-matter", "belief": "3n steps and n steps are different Big-O" }
    ] },
    { "id": "nested-loops", "title": "Loops inside loops", "type": "concept", "prereqs": ["count-steps"], "misconceptions": [
      { "tag": "nested-is-double", "belief": "a loop inside a loop of n is 2n steps", "prereq": "count-steps" },
      { "tag": "membership-free", "belief": "x in a_list is one step" }
    ] },
    { "id": "log-growth", "title": "Halving: log n", "type": "concept", "prereqs": ["count-steps"], "misconceptions": [
      { "tag": "halving-is-linear", "belief": "halving n until 1 takes about n/2 steps" }
    ] },
    { "id": "growth-order", "title": "Which grows faster", "type": "concept", "prereqs": ["nested-loops", "log-growth"], "misconceptions": [] }
  ],
  "phases": [
    { "id": "basics", "title": "Counting steps", "skills": ["count-steps", "nested-loops", "log-growth", "growth-order"], "segments": ["bigo-1"] }
  ],
  "setup": [
    { "id": "python", "title": "Python 3 (runs the examples)", "adapter": "python", "where": "local", "why": "every example is run on your machine before you see it" },
    { "id": "verify", "title": "Examples checked on your machine", "adapter": "verify", "where": "local" }
  ]
}

const py = (file: string, out: string) => ({ "file": file, "argv": ["python", file], "out": out })

export const bigo1: Segment = {
  "format": "teachme.script/1",
  "id": "bigo-1",
  "title": "Counting steps",
  "skills": ["count-steps", "nested-loops", "log-growth", "growth-order"],
  "steps": [
    {
      "id": "o1", "kind": "concept", "skill": "count-steps", "difficulty": 1,
      "title": "Big-O counts growth",
      "body": "Big-O says how the work grows when the input grows. Count the steps for n items. If doubling n doubles the steps, the code is **O(n)**. If doubling n makes four times the steps, it is **O(n²)**.\n\nFixed factors drop out: 3n steps is still O(n).",
      "more": "Big-O is about large n. For 5 items anything is fast; for a million, O(n) and O(n²) are seconds against days."
    },
    {
      "id": "o2", "kind": "stepper", "skill": "count-steps", "difficulty": 1,
      "title": "Linear search, step by step",
      "body": "Looking for 23 by checking each item in turn.",
      "code": { "lang": "python", "source": "def find(items, target):\n    steps = 0\n    for x in items:\n        steps += 1\n        if x == target:\n            return steps\n\nprint(find([4, 8, 15, 16, 23, 42], 23))", "run": py("o2.py", "5") },
      "frames": [
        { "note": "Start at the first item. Is 4 the target?", "state": "[4]  8  15  16  23  42    steps: 1" },
        { "note": "No: move on to 8.", "state": " 4 [8] 15  16  23  42    steps: 2" },
        { "note": "No: move on to 15.", "state": " 4  8 [15] 16  23  42    steps: 3" },
        { "note": "No: move on to 16.", "state": " 4  8  15 [16] 23  42    steps: 4" },
        { "note": "23: found it, after 5 steps.", "state": " 4  8  15  16 [23] 42    steps: 5" },
        { "note": "At worst the target is last or missing: n steps for n items. Twice the items, twice the steps: O(n)." }
      ]
    },
    {
      "id": "o2b", "kind": "predict", "skill": "count-steps", "difficulty": 1,
      "title": "The worst case",
      "body": "The same search on 1,000 items, for a number that is not there. What does it print?",
      "code": { "lang": "python", "source": "def find(items, target):\n    steps = 0\n    for x in items:\n        steps += 1\n        if x == target:\n            break\n    return steps\n\nprint(find(list(range(1000)), -1))", "run": py("o2b.py", "1000") },
      "choices": [
        { "text": "1000", "why": "Right: a missing target means checking every item. n items, n steps: O(n)." },
        { "text": "500", "why": "That is the average when the target is there. Missing, every item gets checked." },
        { "text": "1", "why": "Only if the target were first. Here it is not in the list at all." },
        { "text": "10", "why": "That would be halving, as in a sorted search. This search checks items one by one." }
      ],
      "key": [0]
    },
    {
      "id": "o3", "kind": "trace", "skill": "nested-loops", "difficulty": 2,
      "title": "Trace a loop in a loop",
      "body": "For each n, how many times does `count += 1` run? Fill in the count column.",
      "code": { "lang": "python", "source": "for n in [1, 2, 3, 4]:\n    count = 0\n    for i in range(n):\n        for j in range(n):\n            count += 1\n    print(count)", "run": py("o3.py", "1\n4\n9\n16") },
      "trace": { "columns": ["n", "count"], "rows": [["1", "?"], ["2", "?"], ["3", "?"], ["4", "?"]] },
      "choices": [
        { "text": "1", "why": "n = 1: one outer run, one inner run." },
        { "text": "2", "why": "That would be one loop of 2n. Here the inner loop runs n times for each outer run." },
        { "text": "4", "why": "n = 2: 2 outer runs × 2 inner runs." },
        { "text": "6", "why": "That is 2 × 3. The loops multiply: 3 × 3." },
        { "text": "8", "why": "That is 2 × 4. The loops multiply: 4 × 4." },
        { "text": "9", "why": "n = 3: 3 × 3." },
        { "text": "12", "why": "That is 3 × 4. Both loops run n times." },
        { "text": "16", "why": "n = 4: 4 × 4." }
      ],
      "key": [0, 2, 5, 7],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "nested-is-double", "feedback": "The inner loop runs n times for every run of the outer loop: n × n, not n + n.", "branch": "o3d" },
        { "match": { "choice": 3 }, "class": "misconception", "tag": "nested-is-double", "feedback": "The inner loop runs n times for every run of the outer loop: n × n, not n + n.", "branch": "o3d" },
        { "match": { "choice": 4 }, "class": "misconception", "tag": "nested-is-double", "feedback": "The inner loop runs n times for every run of the outer loop: n × n, not n + n.", "branch": "o3d" }
      ]
    },
    {
      "id": "o3d", "kind": "predict", "skill": "nested-loops", "difficulty": 1, "drill": true, "remedy": "nested-is-double",
      "title": "Ten by ten",
      "body": "The outer loop runs 10 times. Each time, the inner loop runs 10 times. What does this print?",
      "code": { "lang": "python", "source": "n = 10\ncount = 0\nfor i in range(n):\n    for j in range(n):\n        count += 1\nprint(count)", "run": py("o3d.py", "100") },
      "choices": [
        { "text": "100", "why": "Right: 10 outer runs × 10 inner runs. That is n², so O(n²)." },
        { "text": "20", "why": "20 is 10 + 10, as if the loops ran one after the other. Nested, they multiply." },
        { "text": "10", "why": "That is one loop. The inner one runs again for every outer run." }
      ],
      "key": [0]
    },
    {
      "id": "o4", "kind": "predict", "skill": "log-growth", "difficulty": 2,
      "title": "Halving",
      "body": "What does this print?",
      "code": { "lang": "python", "source": "n = 64\nsteps = 0\nwhile n > 1:\n    n = n // 2\n    steps += 1\nprint(steps)", "run": py("o4.py", "6") },
      "choices": [
        { "text": "6", "why": "Right: 64, 32, 16, 8, 4, 2, 1: six halvings. 2⁶ = 64, so steps = log₂ n." },
        { "text": "32", "why": "32 is n / 2. But each step halves what is left, not removes one." },
        { "text": "64", "why": "That would be one step per item. Halving gets to 1 much faster." },
        { "text": "7", "why": "Count the halvings, not the numbers: 64 → 32 is the first." }
      ],
      "key": [0],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "halving-is-linear", "feedback": "Each step halves what is left, so the count grows by one only when n doubles.", "branch": "o4d" }
      ]
    },
    {
      "id": "o4d", "kind": "predict", "skill": "log-growth", "difficulty": 1, "drill": true, "remedy": "halving-is-linear",
      "title": "From 1024",
      "body": "16 times more than 64. How many halvings now?",
      "code": { "lang": "python", "source": "n = 1024\nsteps = 0\nwhile n > 1:\n    n = n // 2\n    steps += 1\nprint(steps)", "run": py("o4d.py", "10") },
      "choices": [
        { "text": "10", "why": "Right: 2¹⁰ = 1024. 16 times the input added only 4 steps. That is O(log n)." },
        { "text": "512", "why": "512 is n / 2, but each step halves what is left." },
        { "text": "96", "why": "That is 16 × 6, as if the steps grew with n. They grow by one each time n doubles." }
      ],
      "key": [0]
    },
    {
      "id": "o5", "kind": "reorder", "skill": "growth-order", "difficulty": 2,
      "title": "Slowest to fastest",
      "body": "Press them in order of growth for large n, slowest first.",
      "choices": [
        { "text": "O(n²)", "why": "n² passes n log n once n is large: a loop in a loop." },
        { "text": "O(1)", "why": "Constant: the same work for any n. Slowest growth of all." },
        { "text": "O(n log n)", "why": "A bit more than n: good sorting algorithms are here." },
        { "text": "O(log n)", "why": "Grows by one step each time n doubles: just above constant." },
        { "text": "O(2ⁿ)", "why": "Doubles with every extra item: the fastest growth here." },
        { "text": "O(n)", "why": "One step per item: after log n." }
      ],
      "key": [1, 3, 5, 2, 0, 4]
    },
    {
      "id": "o6", "kind": "spot-bug", "skill": "nested-loops", "difficulty": 2,
      "title": "The hidden loop",
      "body": "This looks like one loop, but it is O(n²). Which line does up to n steps of work each time it runs?",
      "code": { "lang": "python", "source": "def has_dup(xs):\n    seen = []\n    for x in xs:\n        if x in seen:\n            return True\n        seen.append(x)\n    return False\n\nprint(has_dup([3, 1, 3]))", "run": py("o6.py", "True") },
      "choices": [
        { "text": "for x in xs:", "code": "    for x in xs:", "why": "The loop runs n times, but this line itself is one step each time." },
        { "text": "if x in seen:", "code": "        if x in seen:", "why": "Right: `in` on a list checks item by item, up to n steps, inside a loop of n. A set would make it one step." },
        { "text": "seen.append(x)", "code": "        seen.append(x)", "why": "Adding to the end of a list is one step." }
      ],
      "key": [1],
      "wrong": [
        { "match": { "choice": 0 }, "class": "misconception", "tag": "membership-free", "feedback": "The loop is n steps. The cost hides inside it: x in seen walks the list each time." },
        { "match": { "choice": 2 }, "class": "misconception", "tag": "membership-free", "feedback": "append is one step. The cost hides in x in seen, which walks the list each time." }
      ]
    },
    {
      "id": "o7", "kind": "mcq", "skill": "growth-order", "difficulty": 3, "unseen": true,
      "title": "On your own",
      "body": "What is the Big-O of this function? This one proves the skill: try it before asking.",
      "code": { "lang": "python", "source": "def f(n):\n    total = 0\n    for i in range(n):\n        j = n\n        while j > 1:\n            j //= 2\n            total += 1\n    return total\n\nprint(f(16))", "run": py("o7.py", "64") },
      "choices": [
        { "text": "O(n log n)", "why": "Right: the outer loop runs n times, and each run halves j: log n steps. n × log n." },
        { "text": "O(n²)", "why": "The inner loop halves j instead of counting it down, so it is log n, not n." },
        { "text": "O(log n)", "why": "The halving loop runs again for each of the n outer runs." },
        { "text": "O(n)", "why": "Each outer run does log n inner steps, not one." }
      ],
      "key": [0]
    }
  ]
}

export const segments: Segment[] = [bigo1]
