const fs = require('fs');
const path = require('path');
const assert = require('assert');

const LAYOUT_CALLS = /\b(showTextDocument|createTerminal|createWebviewPanel|tabGroups\.close|vscode\.diff|\.reveal\(|workbench\.action\.\w*[Ff]ocus)/;
const src = path.join(__dirname, '..', 'src');
const offenders = [];
for (const f of fs.readdirSync(src)) {
    if (f === 'layout.js') continue;
    fs.readFileSync(path.join(src, f), 'utf8').split('\n').forEach((line, i) => { if (LAYOUT_CALLS.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`); });
}
assert.deepStrictEqual(offenders, [], 'layout calls outside the LayoutManager');
console.log('PASS layout lint');
