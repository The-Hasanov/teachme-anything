const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

(async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'teachme-it-'));
    fs.writeFileSync(path.join(workspace, 'notes.md'), '# notes\n');
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(workspace, `ref${i}.md`), `ref ${i}\n`);
    fs.mkdirSync(path.join(workspace, 'practice', 'git-branches'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'practice', 'python-lists'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'practice', 'python-lists', 'stats.py'), 'def top_three(nums):\n    pass\n');
    await runTests({
        extensionDevelopmentPath: path.resolve(__dirname, '..', '..'),
        extensionTestsPath: path.resolve(__dirname, 'suite.cjs'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    });
})().catch(err => { console.error(err); process.exit(1); });
