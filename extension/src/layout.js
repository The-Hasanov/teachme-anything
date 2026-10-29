"use strict";
const vscode = require("vscode");

const TERMINAL = 'Teach Me';
const MAX_TUTOR_TABS = 2;
const KEY = 'teachme.layout';

const allTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const textTab = (t, fsPath) => t.input instanceof vscode.TabInputText && same(t.input.uri.fsPath, fsPath);

class LayoutManager {
    constructor(context) {
        this.store = context.workspaceState;
        const saved = this.store.get(KEY) ?? {};
        this.terminalCwd = saved.terminalCwd;
        this.tabs = saved.tabs ?? [];
        this.terminal = vscode.window.terminals.find(t => t.name === TERMINAL);
        this.running = new Set();
        this.panels = new Map();
        context.subscriptions.push(
            vscode.window.onDidCloseTerminal(t => { this.running.delete(t); if (t === this.terminal) this.terminal = undefined; }),
            vscode.window.onDidStartTerminalShellExecution(e => this.running.add(e.terminal)),
            vscode.window.onDidEndTerminalShellExecution(e => this.running.delete(e.terminal)),
            vscode.window.tabGroups.onDidChangeTabs(e => {
                if (!e.closed.length) return;
                const open = allTabs();
                const kept = this.tabs.filter(p => open.some(t => textTab(t, p)));
                if (kept.length !== this.tabs.length) { this.tabs = kept; this.save(); }
            }),
        );
    }

    save() { this.store.update(KEY, { terminalCwd: this.terminalCwd, tabs: this.tabs }); }

    apply(op) {
        if (!op) return;
        if (op.op === 'terminal') return this.terminalAt(op.cwd);
        if (op.op === 'reference') return this.open(op.path, true);
        if (op.op === 'practice') return this.open(op.path, false);
        if (op.op === 'reveal') return this.reveal(op);
    }

    async reveal(op) {
        await vscode.commands.executeCommand('teachme.lesson.focus');
        if (op.cwd) this.terminalAt(op.cwd);
        if (op.path) await this.open(op.path, false);
    }

    panel(viewType, title, options) {
        const open = this.panels.get(viewType);
        if (open) { open.reveal(); return { panel: open, isNew: false }; }
        const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Active, options);
        this.panels.set(viewType, panel);
        panel.onDidDispose(() => this.panels.delete(viewType));
        return { panel, isNew: true };
    }

    terminalAt(cwd) {
        const here = this.terminal && this.terminalCwd && same(this.terminalCwd, cwd);
        if (!here) {
            if (this.terminal && !this.running.has(this.terminal)) this.terminal.dispose();
            this.terminal = vscode.window.createTerminal({ name: TERMINAL, cwd: vscode.Uri.file(cwd) });
            this.terminalCwd = cwd;
            this.save();
        }
        this.terminal.show(true);
    }

    async open(path, isReference) {
        const uri = vscode.Uri.file(path);
        const tab = allTabs().find(t => textTab(t, uri.fsPath));
        if (tab) return vscode.window.showTextDocument(uri, { preview: tab.isPreview, preserveFocus: true, viewColumn: tab.group.viewColumn });
        const active = vscode.window.tabGroups.activeTabGroup;
        const other = vscode.window.tabGroups.all.find(g => g !== active);
        const viewColumn = !isReference ? active.viewColumn : other ? other.viewColumn : vscode.ViewColumn.Beside;
        await vscode.window.showTextDocument(uri, { preview: isReference, preserveFocus: true, viewColumn });
        if (!isReference) return;
        this.tabs.push(uri.fsPath);
        await this.trim();
        this.save();
    }

    async trim() {
        const mine = allTabs().filter(t => this.tabs.some(p => textTab(t, p)));
        for (const t of mine.slice(0, Math.max(0, mine.length - MAX_TUTOR_TABS))) {
            if (t.isDirty) continue;
            await vscode.window.tabGroups.close(t, true);
            this.tabs = this.tabs.filter(p => !same(p, t.input.uri.fsPath));
        }
    }
}

module.exports = { LayoutManager, TERMINAL };
