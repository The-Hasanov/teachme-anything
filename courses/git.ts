import type { Course, Segment } from '../hooks/engine/types'

export const course: Course = {
  "format": "teachme.course/1",
  "id": "git",
  "subject": "Git for teamwork",
  "goal": "work on a team repo with branches",
  "intake": [
    { "id": "goal", "q": "What do you want Git for?", "options": ["Work on a team repo", "My own projects", "A job interview"] },
    { "id": "know", "q": "What do you know already?", "options": ["Nothing yet", "add, commit, push", "Branches too", "Rebase and more"] },
    { "id": "far", "q": "How far are you from your goal?", "options": ["Just starting", "Some practice", "Close"] }
  ],
  "skills": [
    { "id": "branch-model", "title": "What a branch is", "type": "concept", "prereqs": [], "misconceptions": [
      { "tag": "branch-copies-files", "belief": "a branch is a copy of the files" },
      { "tag": "head-stays", "belief": "creating a branch does not change where you are, whatever the command" },
      { "tag": "branch-shares-commits", "belief": "a commit on one branch also shows on the others" }
    ] },
    { "id": "branch-switch", "title": "Create and switch", "type": "tool", "prereqs": ["branch-model"], "misconceptions": [
      { "tag": "branch-not-switch", "belief": "git branch <name> also moves you onto the new branch", "prereq": "branch-model" }
    ] },
    { "id": "branch-commit", "title": "Commit on a branch", "type": "tool", "prereqs": ["branch-switch"], "misconceptions": [
      { "tag": "commit-on-main", "belief": "commits go to main whatever branch you are on" }
    ] },
    { "id": "branch-from", "title": "Branch from a chosen commit", "type": "tool", "prereqs": ["branch-switch"], "misconceptions": [
      { "tag": "branch-from-current", "belief": "a new branch always starts from main" }
    ] }
  ],
  "phases": [
    { "id": "branches", "title": "Branches", "skills": ["branch-model", "branch-switch", "branch-commit", "branch-from"], "segments": ["branches-1"] },
    { "id": "merging", "title": "Merging", "skills": [], "segments": ["merge-1"] }
  ],
  "setup": [
    { "id": "git", "title": "Git", "adapter": "git", "where": "local", "why": "the tool you are learning" },
    { "id": "practice", "title": "Practice repo in practice/git-branches (local, safe)", "adapter": "practice", "where": "local" },
    { "id": "verify", "title": "Exercises checked on your machine", "adapter": "verify", "where": "local" }
  ]
}

export const branches1: Segment = {
  "format": "teachme.script/1",
  "id": "branches-1",
  "title": "Branches",
  "skills": ["branch-model", "branch-switch", "branch-commit", "branch-from"],
  "practice": {
    "adapter": "git",
    "dir": "practice/git-branches",
    "scaffold": [
      ["git", "init", "-q", "-b", "main"],
      ["git", "config", "user.name", "Learner"],
      ["git", "config", "user.email", "learner@teachme.local"],
      ["@write", "README.md", "# Shop\n"],
      ["git", "add", "README.md"],
      ["git", "commit", "-q", "-m", "Add README"],
      ["@write", "app.py", "print('shop')\n"],
      ["git", "add", "app.py"],
      ["git", "commit", "-q", "-m", "Add app"]
    ]
  },
  "steps": [
    {
      "id": "b1", "kind": "compare", "skill": "branch-model", "difficulty": 1,
      "title": "A branch is a label",
      "body": "A branch is a name that points at one commit. When you commit, Git moves the current branch's name to the new commit. **HEAD** says which branch you are on.",
      "compare": { "with": "Python", "text": "Like a Python name bound to an object: `feature = main` makes a second name for the same object, not a copy.", "stops": "Git moves the current branch's name forward for you on every commit. A Python name never moves by itself." },
      "more": "Your practice repo has two commits on main: \"Add README\" and \"Add app\". The name main points at \"Add app\"."
    },
    {
      "id": "b2", "kind": "predict", "skill": "branch-model", "difficulty": 1,
      "title": "Where is HEAD?",
      "body": "You are on main. You run:",
      "code": { "lang": "sh", "source": "git switch -c feature" },
      "choices": [
        { "text": "Still on main", "why": "switch -c creates the branch and moves you onto it." },
        { "text": "On feature", "why": "Right: -c creates feature at the current commit, then switch moves HEAD to it." },
        { "text": "Detached at the last commit", "why": "Detached means HEAD names a commit, not a branch. Here it names the new branch." },
        { "text": "In a new folder with a copy of the files", "why": "A branch copies no files. It is only a name for a commit." }
      ],
      "key": [1],
      "wrong": [
        { "match": { "choice": 0 }, "class": "misconception", "tag": "head-stays", "feedback": "switch -c does two things: it creates feature, then moves HEAD onto it.", "branch": "b2d" },
        { "match": { "choice": 3 }, "class": "misconception", "tag": "branch-copies-files", "feedback": "No copy is made. feature is a second name for the same commit, like a second Python name for one object." }
      ]
    },
    {
      "id": "b2d", "kind": "predict", "skill": "branch-model", "difficulty": 1, "drill": true, "remedy": "head-stays",
      "title": "Ask Git where you are",
      "body": "You are on main and run git switch -c fix. What does the first line of git status say now?",
      "choices": [
        { "text": "On branch fix", "why": "Right: switch moved HEAD to the new branch, and status reports where HEAD is." },
        { "text": "On branch main", "why": "That was before. switch -c ends by moving HEAD to fix." },
        { "text": "HEAD detached at …", "why": "Detached means HEAD names a commit. After switch -c it names the branch fix." }
      ],
      "key": [0]
    },
    {
      "id": "b3", "kind": "terminal", "skill": "branch-switch", "difficulty": 1,
      "title": "Your turn",
      "body": "Create a branch named **feature/login** and switch to it, in your practice repo.",
      "check": {
        "probes": [
          { "id": "exists", "argv": ["git", "rev-parse", "--verify", "--quiet", "refs/heads/feature/login"], "expect": { "exitCode": 0 } },
          { "id": "on-branch", "argv": ["git", "branch", "--show-current"], "expect": { "equals": "feature/login" } }
        ],
        "reference": [["git", "switch", "-q", "-c", "feature/login"]]
      },
      "wrong": [
        { "match": { "probe": "exists" }, "class": "misread", "feedback": "There is no branch named feature/login yet. git branch lists the branches: check the exact name." },
        { "match": { "probe": "on-branch", "got": "^main$" }, "class": "misconception", "tag": "branch-not-switch", "feedback": "feature/login exists, but you are still on main. git branch only makes the label. It does not move you.", "branch": "b3d" }
      ],
      "hints": [
        "One command can create a branch and move you onto it.",
        "It is git switch with an option that means \"create\".",
        "git switch -c <name>"
      ]
    },
    {
      "id": "b3d", "kind": "mcq", "skill": "branch-switch", "difficulty": 1, "drill": true, "remedy": "branch-not-switch",
      "title": "Make the label, or make it and move",
      "body": "Which command leaves you on main?",
      "choices": [
        { "text": "git branch topic", "why": "Right: it creates topic and stays where you are." },
        { "text": "git switch -c topic", "why": "This one creates topic and moves you onto it." },
        { "text": "git switch topic (topic exists)", "why": "This moves you onto the existing topic." }
      ],
      "key": [0]
    },
    {
      "id": "b3e", "kind": "predict", "skill": "branch-switch", "difficulty": 1, "drill": true, "remedy": "branch-not-switch",
      "title": "Follow the next commit",
      "body": "You are on main. You run these two commands. Which branch gets the new commit?",
      "code": { "lang": "sh", "source": "git branch topic\ngit commit -m \"Fix typo\"" },
      "choices": [
        { "text": "main", "why": "Right: git branch made the label topic, but HEAD stayed on main, so main moved." },
        { "text": "topic", "why": "topic would move only if HEAD were on it. git branch does not move HEAD." },
        { "text": "Both", "why": "A commit moves only the branch HEAD is on." }
      ],
      "key": [0]
    },
    {
      "id": "b4", "kind": "terminal", "skill": "branch-commit", "difficulty": 2,
      "title": "Commit on your branch",
      "body": "On feature/login, add a file **login.py** with any content and commit it.\n\nmain must stay as it is.",
      "check": {
        "probes": [
          { "id": "on-branch", "argv": ["git", "branch", "--show-current"], "expect": { "equals": "feature/login" } },
          { "id": "main-same", "argv": ["git", "rev-list", "--count", "main"], "expect": { "equals": "2" } },
          { "id": "ahead", "argv": ["git", "rev-list", "--count", "main..feature/login"], "expect": { "equals": "1" } },
          { "id": "has-file", "argv": ["git", "cat-file", "-e", "feature/login:login.py"], "expect": { "exitCode": 0 } }
        ],
        "reference": [["@write", "login.py", "def login():\n    return True\n"], ["git", "add", "login.py"], ["git", "commit", "-q", "-m", "Add login"]]
      },
      "wrong": [
        { "match": { "probe": "on-branch", "got": "^main$" }, "class": "misconception", "tag": "commit-on-main", "feedback": "You are on main. Switch back to feature/login first: commits go to the branch you are on.", "branch": "b4d" },
        { "match": { "probe": "main-same" }, "class": "misconception", "tag": "commit-on-main", "feedback": "main got a new commit. Commits go to the branch HEAD is on. Switch to feature/login before you commit.", "branch": "b4d" },
        { "match": { "probe": "ahead", "got": "^0$" }, "class": "misread", "feedback": "No commit on feature/login yet. git add login.py, then git commit -m \"Add login\"." },
        { "match": { "probe": "has-file" }, "class": "misread", "feedback": "The commit is there, but it has no login.py. Check the file name." }
      ],
      "hints": [
        "Two steps: stage the file, then commit it.",
        "git add stages a file. git commit records what is staged.",
        "git add login.py, then git commit -m \"<message>\""
      ]
    },
    {
      "id": "b4d", "kind": "predict", "skill": "branch-commit", "difficulty": 1, "drill": true, "remedy": "commit-on-main",
      "title": "Where did the commit go?",
      "body": "git status says \"On branch main\". You commit login.py. Which branch now has login.py?",
      "choices": [
        { "text": "main", "why": "Right: a commit goes to the branch HEAD is on, and status said main." },
        { "text": "feature/login", "why": "feature/login gets a commit only while HEAD is on it." },
        { "text": "Both", "why": "Only the current branch moves to the new commit." }
      ],
      "key": [0]
    },
    {
      "id": "b5", "kind": "predict", "skill": "branch-model", "difficulty": 2,
      "title": "What does main show?",
      "body": "You committed login.py on feature/login. Now you run:",
      "code": { "lang": "sh", "source": "git log --oneline main" },
      "choices": [
        { "text": "Add app, Add README", "why": "Right: main still points at \"Add app\". Your commit moved only feature/login." },
        { "text": "Add login, Add app, Add README", "why": "The new commit moved only the current branch's name: feature/login." },
        { "text": "Nothing: main is empty now", "why": "main keeps pointing at its commit. Nothing was removed." }
      ],
      "key": [0],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "branch-shares-commits", "feedback": "A commit belongs to the branch you were on. main did not move, so it does not show \"Add login\"." }
      ]
    },
    {
      "id": "b6", "kind": "terminal", "skill": "branch-from", "difficulty": 3, "unseen": true,
      "title": "A bug report comes in",
      "body": "Start a branch named **hotfix** from main, not from feature/login, and switch to it. No hints for this one until you have tried.",
      "check": {
        "probes": [
          { "id": "on-branch", "argv": ["git", "branch", "--show-current"], "expect": { "equals": "hotfix" } },
          { "id": "from-main", "argv": ["git", "log", "-1", "--format=%s", "hotfix"], "expect": { "equals": "Add app" } }
        ],
        "reference": [["git", "switch", "-q", "-c", "hotfix", "main"]]
      },
      "wrong": [
        { "match": { "probe": "from-main", "got": "^Add login$" }, "class": "misconception", "tag": "branch-from-current", "feedback": "hotfix starts at \"Add login\": a new branch starts where HEAD is, and you were on feature/login. Give the start point: git switch -c <name> main." }
      ],
      "hints": [
        "A new branch starts at the commit HEAD is on, unless you name another.",
        "git switch -c takes a second argument: where to start.",
        "git switch -c hotfix <start point>"
      ]
    }
  ]
}

export const segments: Segment[] = [branches1]
