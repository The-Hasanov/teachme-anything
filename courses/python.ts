import type { Course, Segment } from '../hooks/engine/types'

export const course: Course = {
  "format": "teachme.course/1",
  "id": "python",
  "subject": "Python lists and functions",
  "goal": "write and test small Python functions",
  "intake": [
    { "id": "from", "q": "Which language do you know best?", "options": ["JavaScript", "Java or C#", "Another one", "None yet"] },
    { "id": "know", "q": "How much Python do you know?", "options": ["None", "I can read it", "I write scripts"] },
    { "id": "why", "q": "What do you want Python for?", "options": ["Work", "Data and scripts", "A course or an interview"] }
  ],
  "skills": [
    { "id": "list-basics", "title": "Lists, indexes and slices", "type": "code", "prereqs": [], "misconceptions": [
      { "tag": "slice-end-included", "belief": "a slice includes the item at its end index" }
    ] },
    { "id": "list-sort", "title": "Sorting without surprises", "type": "code", "prereqs": ["list-basics"], "misconceptions": [
      { "tag": "sort-returns-list", "belief": "list.sort() returns the sorted list" },
      { "tag": "sort-copies", "belief": "list.sort() leaves the caller's list as it was" }
    ] },
    { "id": "functions", "title": "Functions that return values", "type": "code", "prereqs": [], "misconceptions": [
      { "tag": "mutable-default", "belief": "a default list argument is a new list on every call" }
    ] }
  ],
  "phases": [
    { "id": "lists", "title": "Lists and functions", "skills": ["list-basics", "list-sort", "functions"], "segments": ["lists-1"] }
  ],
  "setup": [
    { "id": "python", "title": "Python 3", "adapter": "python", "where": "local", "why": "the language you are learning" },
    { "id": "practice", "title": "Practice folder practice/python-lists, with tests", "adapter": "practice", "where": "local" },
    { "id": "verify", "title": "Examples and exercises checked on your machine", "adapter": "verify", "where": "local" }
  ]
}

const TESTS = `import unittest
from stats import top_three, dedupe

class TopThree(unittest.TestCase):
    def test_largest_first(self):
        self.assertEqual(top_three([5, 1, 9, 3]), [9, 5, 3])

    def test_short_list(self):
        self.assertEqual(top_three([2, 7]), [7, 2])

    def test_input_unchanged(self):
        nums = [5, 1, 9, 3]
        try:
            top_three(nums)
        except Exception:
            pass
        self.assertEqual(nums, [5, 1, 9, 3])

class Dedupe(unittest.TestCase):
    def test_keeps_first_order(self):
        self.assertEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2])

    def test_empty(self):
        self.assertEqual(dedupe([]), [])

    def test_words(self):
        self.assertEqual(dedupe(["a", "b", "a"]), ["a", "b"])
`

const STARTER = `def top_three(nums):
    """The three largest numbers in nums, largest first. nums stays unchanged."""
    raise NotImplementedError

def dedupe(items):
    """items without repeats, in the order each one first appears."""
    raise NotImplementedError
`

const TOP_THREE = `def top_three(nums):
    return sorted(nums, reverse=True)[:3]
`

const DEDUPE = `

def dedupe(items):
    seen = []
    for x in items:
        if x not in seen:
            seen.append(x)
    return seen
`

const STARTER_DEDUPE = `

def dedupe(items):
    raise NotImplementedError
`

export const lists1: Segment = {
  "format": "teachme.script/1",
  "id": "lists-1",
  "title": "Lists and functions",
  "skills": ["list-basics", "list-sort", "functions"],
  "practice": {
    "adapter": "python",
    "dir": "practice/python-lists",
    "scaffold": [
      ["@write", "stats.py", STARTER],
      ["@write", "test_stats.py", TESTS]
    ]
  },
  "steps": [
    {
      "id": "p1", "kind": "compare", "skill": "list-basics", "difficulty": 1,
      "title": "A list, by position",
      "body": "A Python **list** keeps items in order: `nums = [10, 20, 30]`. `nums[0]` is the first item and `nums[-1]` the last. `nums[0:2]` is a **slice**: a new list from index 0 up to, but not including, 2.",
      "compare": { "with": "JavaScript", "text": "Like a JavaScript array: ordered, indexed from 0, and `append` adds to the end like `push`.", "stops": "JavaScript has no negative indexes: `arr[-1]` is undefined there. In Python it is the last item." }
    },
    {
      "id": "p2", "kind": "predict", "skill": "list-basics", "difficulty": 1,
      "title": "Where a slice stops",
      "body": "What does this print?",
      "code": { "lang": "python", "source": "nums = [10, 20, 30, 40]\nprint(nums[1:3])", "run": { "file": "p2.py", "argv": ["python", "p2.py"], "out": "[20, 30]" } },
      "choices": [
        { "text": "[20, 30]", "why": "Right: from index 1 up to, not including, index 3." },
        { "text": "[20, 30, 40]", "why": "The end index is not included: index 3 holds 40, so 40 stays out." },
        { "text": "[10, 20, 30]", "why": "Indexes start at 0, so index 1 is 20, not 10." },
        { "text": "[30, 40]", "why": "The slice starts at index 1, which is 20." }
      ],
      "key": [0],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "slice-end-included", "feedback": "A slice stops before its end index. nums[1:3] takes indexes 1 and 2: two items." }
      ]
    },
    {
      "id": "p3", "kind": "predict", "skill": "list-sort", "difficulty": 1,
      "title": "What sort() gives back",
      "body": "What does this print?",
      "code": { "lang": "python", "source": "nums = [3, 1, 2]\nresult = nums.sort()\nprint(result)", "run": { "file": "p3.py", "argv": ["python", "p3.py"], "out": "None" } },
      "choices": [
        { "text": "[1, 2, 3]", "why": "That is what nums holds now. sort() itself gives back nothing." },
        { "text": "None", "why": "Right: sort() sorts the list in place and returns None." },
        { "text": "[3, 1, 2]", "why": "nums did change: sort() works in place. And result is not nums." },
        { "text": "An error", "why": "No error: sort() runs fine. It just returns None." }
      ],
      "key": [1],
      "wrong": [
        { "match": { "choice": 0 }, "class": "misconception", "tag": "sort-returns-list", "feedback": "sort() changes the list itself and returns None, so result is None.", "branch": "p3d" }
      ]
    },
    {
      "id": "p3d", "kind": "predict", "skill": "list-sort", "difficulty": 1, "drill": true, "remedy": "sort-returns-list",
      "title": "Sorted in place",
      "body": "sort() changes the list it is called on and returns None. Here nothing keeps its return value. What does this print?",
      "code": { "lang": "python", "source": "nums = [3, 1, 2]\nnums.sort()\nprint(nums)", "run": { "file": "p3d.py", "argv": ["python", "p3d.py"], "out": "[1, 2, 3]" } },
      "choices": [
        { "text": "[1, 2, 3]", "why": "Right: the list itself is now sorted." },
        { "text": "None", "why": "None is what sort() returns. nums is the list, and it is sorted now." },
        { "text": "[3, 1, 2]", "why": "sort() works in place: nums changed." }
      ],
      "key": [0]
    },
    {
      "id": "p3e", "kind": "mcq", "skill": "list-sort", "difficulty": 1, "drill": true, "remedy": "sort-copies",
      "title": "A sorted copy",
      "body": "You need the numbers sorted, and `nums` must stay as it was. Which line does that?",
      "choices": [
        { "text": "ordered = sorted(nums)", "code": "ordered = sorted(nums)", "why": "Right: sorted() builds a new list and leaves nums alone." },
        { "text": "ordered = nums.sort()", "code": "ordered = nums.sort()", "why": "This sorts nums itself, and ordered becomes None." },
        { "text": "ordered = nums; ordered.sort()", "code": "ordered = nums\nordered.sort()", "why": "ordered is a second name for the same list, so sorting it sorts nums too." }
      ],
      "key": [0]
    },
    {
      "id": "p4", "kind": "worked", "skill": "list-sort", "difficulty": 1,
      "title": "sorted() makes a new list",
      "body": "`sorted()` returns a new list and leaves the original alone. `reverse=True` sorts from high to low, and a slice then takes the first items.",
      "code": { "lang": "python", "source": "prices = [5, 1, 9, 3]\nprint(sorted(prices))\nprint(prices)\nprint(sorted(prices, reverse=True)[:2])", "run": { "file": "p4.py", "argv": ["python", "p4.py"], "out": "[1, 3, 5, 9]\n[5, 1, 9, 3]\n[9, 5]" } }
    },
    {
      "id": "p5", "kind": "reorder", "skill": "functions", "difficulty": 2,
      "title": "Build a function",
      "body": "Press the lines in order to build `total(prices)`, which returns the sum of the prices.",
      "choices": [
        { "text": "    return result", "code": "    return result", "why": "return ends the function, so it comes last, after the loop." },
        { "text": "def total(prices):", "code": "def total(prices):", "why": "The def line comes first: it names the function and its parameter." },
        { "text": "        result += p", "code": "        result += p", "why": "This adds each price, so it sits inside the loop." },
        { "text": "    result = 0", "code": "    result = 0", "why": "The running sum starts at 0 before the loop." },
        { "text": "    for p in prices:", "code": "    for p in prices:", "why": "The loop visits each price; the adding goes inside it." }
      ],
      "key": [1, 3, 4, 2, 0],
      "hints": ["Start with the line that names the function.", "The sum needs a starting value before the loop.", "Indentation shows the order: 4 spaces in the function, 8 inside the loop."]
    },
    {
      "id": "p6", "kind": "spot-bug", "skill": "functions", "difficulty": 2,
      "title": "Spot the bug",
      "body": "Every call should start with an empty basket. But this prints `['tea', 'milk']`. Which line causes it?",
      "code": { "lang": "python", "source": "def add(item, basket=[]):\n    basket.append(item)\n    return basket\n\nadd('tea')\nprint(add('milk'))", "run": { "file": "p6.py", "argv": ["python", "p6.py"], "out": "['tea', 'milk']" } },
      "choices": [
        { "text": "def add(item, basket=[]):", "code": "def add(item, basket=[]):", "why": "Right: the default list is made once, when def runs, and every call shares it." },
        { "text": "    basket.append(item)", "code": "    basket.append(item)", "why": "append is fine. The question is which list it appends to: the shared default one." },
        { "text": "    return basket", "code": "    return basket", "why": "Returning the list is fine. The list was shared before this line." }
      ],
      "key": [0],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "mutable-default", "feedback": "append works on the list it is given. Without a basket, that is the one default list, made once and kept between calls." }
      ],
      "more": "The usual fix: `basket=None`, then `if basket is None: basket = []` inside the function."
    },
    {
      "id": "p7", "kind": "code", "open": "stats.py", "skill": "list-sort", "difficulty": 2,
      "title": "Your turn: top three",
      "body": "In **stats.py**, finish `top_three(nums)`: return the three largest numbers, largest first. `nums` must not change.\n\nRun the tests with `python -m unittest test_stats`, or press Check.",
      "check": {
        "probes": [
          { "id": "unchanged", "argv": ["python", "-m", "unittest", "-q", "test_stats.TopThree.test_input_unchanged"], "expect": { "exitCode": 0 } },
          { "id": "tests", "argv": ["python", "-m", "unittest", "-q", "test_stats.TopThree"], "expect": { "exitCode": 0 } }
        ],
        "reference": [["@write", "stats.py", TOP_THREE + STARTER_DEDUPE]]
      },
      "wrong": [
        { "match": { "probe": "unchanged", "got": "AssertionError" }, "class": "misconception", "tag": "sort-copies", "feedback": "Your function sorts nums itself, so the caller's list changed. sorted(nums) gives you a new list and leaves nums alone.", "branch": "p3e" }
      ],
      "hints": ["Sort a copy from high to low, then keep the first three.", "sorted() takes reverse=True.", "A slice [:3] keeps the first three items."]
    },
    {
      "id": "p8", "kind": "code", "open": "stats.py", "skill": "functions", "difficulty": 3, "unseen": true,
      "title": "On your own: no repeats",
      "body": "In **stats.py**, finish `dedupe(items)`: return the items without repeats, each in the order it first appears. `dedupe([3, 1, 3, 2, 1])` is `[3, 1, 2]`.\n\nThis one proves the skill: try it before asking.",
      "check": {
        "probes": [
          { "id": "tests", "argv": ["python", "-m", "unittest", "-q", "test_stats.Dedupe"], "expect": { "exitCode": 0 } }
        ],
        "reference": [["@write", "stats.py", TOP_THREE + DEDUPE]]
      },
      "hints": ["Keep a list of what you have seen so far.", "Loop over items; add one only if it is not seen yet.", "`if x not in seen:` then append it."]
    }
  ]
}

export const segments: Segment[] = [lists1]
