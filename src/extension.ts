import * as vscode from 'vscode';
import { GitChangeTracker } from './gitChangeTracker';

export function activate(context: vscode.ExtensionContext) {
    const gitChangeTracker = new GitChangeTracker(context);
    gitChangeTracker.activate();
}

export function deactivate() {}
