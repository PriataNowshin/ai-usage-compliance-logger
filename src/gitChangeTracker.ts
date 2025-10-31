import * as vscode from 'vscode';

export class GitChangeTracker {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public activate(): void {
        this.setupFileSaveListener();
    }

    private setupFileSaveListener(): void {
        const disposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId === 'python') {
                await this.checkChangesAgainstGit(document);
            }
        });

        this.context.subscriptions.push(disposable);
    }

    private async checkChangesAgainstGit(document: vscode.TextDocument): Promise<void> {
        try {
            const git = await this.getGitExtension();
            if (!git) {
                return;
            }

            const repo = this.getGitRepository(git);
            if (!repo) {
                return;
            }

            const oldContent = await this.getLastCommittedVersion(repo, document);
            if (!oldContent) {
                return;
            }

            const newContent = document.getText();
            const differences = this.calculateDetailedDifferences(oldContent, newContent);

            this.printDifferencesToConsole(differences, document);

        } catch (error) {
            console.error('Error:', error);
        }
    }

    private async getGitExtension(): Promise<any> {
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

    private getGitRepository(git: any): any {
        if (git.repositories.length === 0) {
            vscode.window.showErrorMessage('No Git Repository Found');
            return null;
        }

        return git.repositories[0];
    }

    private async getLastCommittedVersion(repo: any, document: vscode.TextDocument): Promise<string | null> {
        try {
            const relativePath = vscode.workspace.asRelativePath(document.uri, false);
            const headContent = await repo.show('HEAD', relativePath);
            return headContent;
        } catch (error) {
            vscode.window.showWarningMessage('File Not Found in Git History');
            return null;
        }
    }

    private calculateDetailedDifferences(oldContent: string, newContent: string) {
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

    private printDifferencesToConsole(differences: any, document: vscode.TextDocument): void {
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
}