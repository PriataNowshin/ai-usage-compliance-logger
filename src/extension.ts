import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('ai-policy.aiPolicy', () => {
		vscode.window.showInformationMessage('New AI Policy command executed!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
