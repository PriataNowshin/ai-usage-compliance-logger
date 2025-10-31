import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    setupManualCommand(context);
    setupFileSaveListener(context);
}

export function deactivate() {}

function setupManualCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('ai-policy.aiPolicy', async () => {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            vscode.window.showWarningMessage('No file is currently open! Please open a Python file first.');
            return;
        }

        const document = editor.document;

        if (document.languageId !== 'python') {
            vscode.window.showWarningMessage(
                `Current file is not a Python file!\n` +
                `File type: ${document.languageId}\n` +
                `Please open a Python (.py) file to check changes.`
            );
            return;
        }

        if (document.isDirty) {
            vscode.window.showWarningMessage(
                'File has unsaved changes!\n' +
                'Please save the file first (Ctrl+S) before checking changes.'
            );
            return;
        }

        await checkChangesAgainstGit(document);
    });

    context.subscriptions.push(disposable);
}

function setupFileSaveListener(context: vscode.ExtensionContext) {
    const disposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'python') {
            await checkChangesAgainstGit(document);
        }
    });

    context.subscriptions.push(disposable);
}

async function checkChangesAgainstGit(document: vscode.TextDocument) {
    try {
        const git = await getGitExtension();
        if (!git) {
            return;
        }

        const repo = getGitRepository(git);
        if (!repo) {
            return;
        }

        const oldContent = await getLastCommittedVersion(repo, document);
        if (!oldContent) {
            return;
        }

        const newContent = document.getText();
        const differences = calculateDetailedDifferences(oldContent, newContent);

        printDifferencesToConsole(differences, document);
        await displayChanges(document, differences);

    } catch (error) {
        console.error('Error:', error);
    }
}

async function getGitExtension() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    
    if (!gitExtension) {
        vscode.window.showErrorMessage('Git Extension Not Available');
        return null;
    }

    const gitApi = gitExtension.isActive 
        ? gitExtension.exports 
        : await gitExtension.activate();
    
    return gitApi.getAPI(1);
}

function getGitRepository(git: any) {
    if (git.repositories.length === 0) {
        vscode.window.showErrorMessage('No Git Repository Found');
        return null;
    }

    return git.repositories[0];
}

async function getLastCommittedVersion(repo: any, document: vscode.TextDocument): Promise<string | null> {
    try {
        const relativePath = vscode.workspace.asRelativePath(document.uri, false);
        const headContent = await repo.show('HEAD', relativePath);
        return headContent;
    } catch (error) {
        vscode.window.showWarningMessage('File Not Found in Git History');
        return null;
    }
}

function calculateDetailedDifferences(oldContent: string, newContent: string) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const addedLines: Array<{lineNumber: number, content: string}> = [];
    const removedLines: Array<{lineNumber: number, content: string}> = [];
    const modifiedLines: Array<{lineNumber: number, oldContent: string, newContent: string}> = [];

    const maxLines = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === undefined && newLine !== undefined) {
            addedLines.push({ lineNumber: i + 1, content: newLine });
        } else if (oldLine !== undefined && newLine === undefined) {
            removedLines.push({ lineNumber: i + 1, content: oldLine });
        } else if (oldLine !== newLine) {
            modifiedLines.push({
                lineNumber: i + 1,
                oldContent: oldLine,
                newContent: newLine
            });
        }
    }

    const statistics = {
        totalOldLines: oldLines.length,
        totalNewLines: newLines.length,
        linesAdded: addedLines.length,
        linesRemoved: removedLines.length,
        linesModified: modifiedLines.length,
        linesUnchanged: Math.min(oldLines.length, newLines.length) - modifiedLines.length,
        netLineChange: newLines.length - oldLines.length,
        charDifference: newContent.length - oldContent.length
    };

    return {
        statistics: statistics,
        added: addedLines,
        removed: removedLines,
        modified: modifiedLines,
        oldContent: oldContent,
        newContent: newContent
    };
}

function printDifferencesToConsole(differences: any, document: vscode.TextDocument) {
    const fileName = document.fileName.split('/').pop() || document.fileName;
    
    console.log('\n' + '='.repeat(80));
    console.log(`CHANGES IN: ${fileName}`);
    console.log('='.repeat(80));
    
    console.log(`\nLines: ${differences.statistics.totalOldLines} -> ${differences.statistics.totalNewLines} (${differences.statistics.netLineChange >= 0 ? '+' : ''}${differences.statistics.netLineChange})`);
    console.log(`Added: ${differences.statistics.linesAdded} | Removed: ${differences.statistics.linesRemoved} | Modified: ${differences.statistics.linesModified}`);

    if (differences.added.length > 0) {
        console.log('\nADDED LINES:');
        differences.added.forEach((line: any) => {
            console.log(`  [${line.lineNumber}] + ${line.content}`);
        });
    }

    if (differences.removed.length > 0) {
        console.log('\nREMOVED LINES:');
        differences.removed.forEach((line: any) => {
            console.log(`  [${line.lineNumber}] - ${line.content}`);
        });
    }

    if (differences.modified.length > 0) {
        console.log('\nMODIFIED LINES:');
        differences.modified.forEach((line: any) => {
            console.log(`  [${line.lineNumber}]`);
            console.log(`    - ${line.oldContent}`);
            console.log(`    + ${line.newContent}`);
        });
    }

    console.log('\n' + '='.repeat(80) + '\n');
}

async function displayChanges(document: vscode.TextDocument, differences: any) {
    const fileName = document.fileName.split('/').pop() || document.fileName;
    const stats = differences.statistics;

    const summaryMessage = 
        `Changes in "${fileName}"\n` +
        `+${stats.linesAdded} -${stats.linesRemoved} ~${stats.linesModified}`;

    vscode.window.showInformationMessage(summaryMessage);
}
