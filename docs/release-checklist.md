# Release checklist

About 15 minutes. Do it on macOS, with VS Code opened from the Dock (not from a terminal), so the PATH is the one a
learner gets. Every issue up to 0.6.2 would have shown up in one of these steps.

## 1. Automated

- [ ] `sh scripts/check.sh` passes, with no test skipped.

## 2. A generated subject on a machine that is missing its toolchain

Pick a subject that is not built in and whose tool is not installed (Rust without rustup, for example).

- [ ] In an empty folder: **teach me &lt;subject&gt;**. Answer the intake, typing your own words in the third question.
- [ ] Setup reports the missing tool. **Fix it for me** installs it, or install it yourself; **Set up** then turns green
      without restarting Claude Code. (#6, #12)
- [ ] The VS Code lesson view and the terminal pane show the same screen at every point. (#10)

## 3. Lesson 1, every kind of button

- [ ] Every step teaches its idea before a question tests it. (#3)
- [ ] On each question: **I don't know**, then a right answer, then **Next**. Nothing stays stuck. (#4, #15)
- [ ] **Ask** on a step: the explanation shows up in the chat and in the lesson view. (#2, #14)
- [ ] Ask in the chat "can you see the question?": the tutor quotes it. (#2)
- [ ] On a code task: a wrong check, a hint, then a right check.

## 4. The next lesson is written in the background

- [ ] Finish lesson 1. Both views show that the next lesson is being written, with a timer. (#11)
- [ ] It arrives without your help, and **Continue** opens it, not the last step again. (#5, #13)
- [ ] If it fails, the view says why and offers a retry. (#12)

## 5. Ship

- [ ] Bump the version in `.claude-plugin/plugin.json`, `extension/package.json` and the README install line.
- [ ] Any problem found above is an issue with a test that reproduces it, before it is fixed.
