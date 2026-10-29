---
name: doctor
description: >
  Finds why Teach Me is not working and fixes it. Use when the learner says the lesson view is empty or
  says "not connected", buttons do nothing, a press moves two steps, the next lesson never arrives, the course does
  not load, or asks to "check Teach Me", "fix Teach Me", "diagnose", "teachme doctor" or "why is the lesson broken".
---

# Teach Me doctor

Run the checks in order and stop at the first failure. Then fix it: say in one line what you will run, run it, and
run the failed check again. Installing software or changing PATH or a shell profile needs the learner's yes, so
ask first. A fix only the learner can do (reload a window, press a button) is named in one line. A fix that
changes a file in `.teachme/` goes to the `teachme-anything:doctor` agent: start it with the failed check and what
you found. Only that agent may write there, and it backs each file up first. Never edit `practice/`. Run all
checks only if the learner asked for a full check, then report each as ✓ or ✗ in one line.

1. **Course in this folder.** Check that `.teachme/course.json` exists and parses as JSON.
   ✗ no file: there is no course here. Say "teach me <subject>" in this folder, or open the folder that has one.
   ✗ does not parse: name the file and the parse error.
2. **Lessons load.** Every file in `.teachme/scripts/*.json` parses as JSON with `"format": "teachme.script/1"`.
   ✗ name the file. A lesson that fails validation is skipped without notice, so the course looks shorter than it is.
   Hand the file to the doctor agent: it repairs broken JSON, or sets an invalid lesson aside to be written again.
3. **Setup tools.** Call `mcp__teachme-anything__recheck_setup`: it runs the setup checks in the engine.
   ✗ a tool: install it, or if your shell finds it but the engine does not, it is missing from the PATH Claude
   Code started with: link it into a folder on that PATH (`~/.local/bin`) or restart Claude Code from a new
   terminal. Call `recheck_setup` again to confirm. The lesson view's **Fix it for me** runs the same repair.
4. **The engine sees the course.** Call `mcp__teachme-anything__snapshot`.
   ✗ "No Teach Me course in this folder" while step 1 passed: run `/reload-plugins`, then call the snapshot again.
5. **Extension installed and current.** Run `code --list-extensions --show-versions` (or `code-insiders` or
   `cursor`) and find `the-hasanov.teachme-anything@<version>`. Compare it with `version` in this plugin's
   `.claude-plugin/plugin.json`, two levels up from this skill's base directory.
   ✗ missing or older: run the `install-vscode` skill, then **Developer: Reload Window**.
   (Only needed for the VS Code lesson view. The terminal pane works without it: `/tutor`.)
6. **The lesson view is reachable.** Each VS Code window writes `~/.teachme/vscode/<pid>.json` with
   `port`, `token`, `folders` and `pid`. Find the newest one whose `folders` contains this folder (compare
   case-insensitively, `\` as `/`). Send `GET http://127.0.0.1:<port>/lesson/events?after=0&wait=0` with the header
   `x-teachme-token: <token>`. It should answer 200 with `boot` and `events`.
   ✗ no file lists this folder: open this folder as a workspace folder in VS Code (not a parent folder or a single file).
   ✗ the request fails: that window is closed or its process is gone. Reload the VS Code window. Files of
   processes that no longer run are stale and safe to ignore.
7. **The next lesson.** If the snapshot says the stage is `recap` or the lesson view says "not written yet", read
   the last `prepare`, `prepare-failed` and `segment` lines of `.teachme/metrics.jsonl`.
   ✗ `prepare-failed` or a `prepare` with no matching `segment`: press **Write it now** in the lesson view.
8. **Each press counted once.** In `.teachme/metrics.jsonl`, look for two `"kind":"press"` lines with the same
   press under 10 ms apart.
   ✗ found: the plugin is older than 0.6.1. Update it with `/plugin update teachme-anything`, then run `/reload-plugins`.
