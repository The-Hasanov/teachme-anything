---
name: install-vscode
description: >
  Builds and installs (or reinstalls) the Teach Me VS Code extension, which adds the lesson view in the secondary
  side bar. Use when the learner asks to "install the VS Code extension", "reinstall the extension", "update the
  lesson view", "set up VS Code for Teach Me", or the lesson view is missing or out of date after a plugin update.
---

# Install the VS Code extension

The extension source ships with this plugin, in the `extension` folder two levels up from this skill's base
directory (`<base>/../../extension`). Building it needs Node.js with npm. Installing it needs the `code` command.

1. Check the tools: `node --version`, `npm --version` and `code --version`. If `code` is missing, look for
   `code-insiders` or `cursor` and use that instead. If none is there, tell the learner to open VS Code and run
   **Shell Command: Install 'code' command in PATH** from the Command Palette. Stop there.
2. In the extension folder, run `npm install` only if `node_modules` is missing, then `npm run package`. This
   writes `teachme-anything-<version>.vsix`, where `<version>` is the `version` in the folder's `package.json`.
3. Run `code --install-extension teachme-anything-<version>.vsix --force` in that folder. `--force` replaces an
   installed copy, so the same command works for a first install and for a reinstall.
4. Check that `code --list-extensions --show-versions` contains `the-hasanov.teachme-anything@<version>`.
5. Tell the learner in one line which version is installed, and that VS Code must reload to use it: run
   **Developer: Reload Window** from the Command Palette. The lesson view is in the secondary side bar.

If a step fails, show its first error line and stop. Do not change the extension's source to make it build.
