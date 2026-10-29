"use strict";
const vscode = require("vscode");
const crypto = require("crypto");
const { startChannel } = require("./channel");
const { LayoutManager } = require("./layout");
const { registerDashboard } = require("./dashboard");

function registerLessonView(context) {
    const layout = new LayoutManager(context);
    let view;
    let last;
    const watchers = new Set();
    const folders = () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const post = (m) => view?.webview.postMessage(m);
    const channel = startChannel({
        folders: folders(),
        onView: (screen, op, data) => {
            last = screen;
            dashboard.update(screen, data);
            watchers.forEach(fn => fn(screen));
            post({ type: 'screen', screen });
            try { layout.apply(op); } catch (e) { console.error('[teachme] layout', e); }
        },
    });
    const dashboard = registerDashboard(context, layout, channel);
    channel.ready.catch(e => vscode.window.showErrorMessage(`Teach Me: the lesson view cannot listen: ${e.message}`));
    context.subscriptions.push({ dispose: () => channel.close() }, vscode.workspace.onDidChangeWorkspaceFolders(() => channel.setFolders(folders())));

    let up;
    const timer = setInterval(() => {
        const now = channel.isConnected();
        if (now !== up) { up = now; post({ type: 'connection', up }); dashboard.connection(up); }
    }, 2000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });

    const provider = {
        resolveWebviewView(v) {
            view = v;
            const media = vscode.Uri.joinPath(context.extensionUri, 'media');
            const codicons = vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist');
            v.webview.options = { enableScripts: true, localResourceRoots: [media, codicons] };
            const nonce = crypto.randomBytes(16).toString('hex');
            const src = (base, f) => v.webview.asWebviewUri(vscode.Uri.joinPath(base, f));
            v.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${v.webview.cspSource}; font-src ${v.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${src(codicons, 'codicon.css')}"><link rel="stylesheet" href="${src(media, 'lesson.css')}">
</head><body><div id="root" aria-live="off"></div><script nonce="${nonce}" src="${src(media, 'lesson.js')}"></script></body></html>`;
            v.webview.onDidReceiveMessage(m => {
                if (m.type === 'press') channel.push({ type: 'press', press: m.press, t: m.t });
                if (m.type === 'ready') {
                    if (last) post({ type: 'screen', screen: last });
                    up = undefined;
                    channel.push({ type: 'ready' });
                }
            });
            v.onDidChangeVisibility(() => { if (v.visible && last) post({ type: 'screen', screen: last }); });
        },
    };
    context.subscriptions.push(vscode.commands.registerCommand('teachme.progress', async () => {
        await vscode.commands.executeCommand('teachme.lesson.focus');
        channel.push({ type: 'press', press: { action: 'progress' }, t: Date.now() });
    }));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('teachme.lesson', provider, { webviewOptions: { retainContextWhenHidden: true } }));
    return { channel, layout, onScreen: (fn) => { watchers.add(fn); return () => watchers.delete(fn); } };
}

module.exports = { registerLessonView };
