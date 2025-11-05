import * as vscode from 'vscode';

// Store all text insertions (potential Copilot or manual)
interface TextInsertion {
    timestamp: Date;
    fileName: string;
    text: string;
    lineNumber: number;
}

const recentInsertions: TextInsertion[] = [];
const INSERTION_WINDOW_MS = 60000; // Track insertions within last 60 seconds

export function activate(context: vscode.ExtensionContext) {
    setupFileSaveListener(context);
    setupInsertionTracking(context);
}

function setupFileSaveListener(context: vscode.ExtensionContext) {
    const disposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'python') {
            await checkChangesAgainstGit(document);
            await checkChangesAgainstCopilot(document);
        }
    });

    context.subscriptions.push(disposable);
}

function setupInsertionTracking(context: vscode.ExtensionContext) {
    const changeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'python') {
            trackTextInsertion(event);
        }
    });

    context.subscriptions.push(changeDisposable);
}

function trackTextInsertion(event: vscode.TextDocumentChangeEvent) {
    const fileName = event.document.fileName.split('/').pop() || event.document.fileName;
    
    event.contentChanges.forEach((change) => {
        const insertedText = change.text;
        const isInsertion = change.rangeLength === 0 && insertedText.length > 0;
        
        // Track ANY insertion (could be Copilot, paste, or typing)
        // We'll determine the source later by matching with Git changes
        if (isInsertion && insertedText.length > 5) {
            const insertion: TextInsertion = {
                timestamp: new Date(),
                fileName: fileName,
                text: insertedText,
                lineNumber: change.range.start.line + 1
            };
            
            recentInsertions.push(insertion);
            
            console.log(`[Tracked Insertion] ${fileName} at line ${insertion.lineNumber}: ${insertedText.length} chars`);
            
            // Clean old insertions (older than 60 seconds)
            const now = new Date().getTime();
            const filtered = recentInsertions.filter(i => 
                (now - i.timestamp.getTime()) < INSERTION_WINDOW_MS
            );
            recentInsertions.length = 0;
            recentInsertions.push(...filtered);
        }
    });
}

async function checkChangesAgainstCopilot(document: vscode.TextDocument) {
    const fileName = document.fileName.split('/').pop() || document.fileName;
    
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

        analyzeCopilotUsage(differences, document, fileName);

    } catch (error) {
        console.error('Error checking Copilot usage:', error);
    }
}

function analyzeCopilotUsage(differences: any, document: vscode.TextDocument, fileName: string) {
    console.log('\n' + '='.repeat(80));
    console.log('COPILOT USAGE ANALYSIS');
    console.log('='.repeat(80));
    console.log(`File: ${fileName}`);
    
    // Filter insertions for this file
    const fileInsertions = recentInsertions.filter(i => i.fileName === fileName);
    console.log(`Recent insertions tracked: ${fileInsertions.length}`);
    
    if (fileInsertions.length > 0) {
        console.log('\nRecent insertions:');
        fileInsertions.forEach((ins, idx) => {
            const age = Math.round((new Date().getTime() - ins.timestamp.getTime()) / 1000);
            console.log(`  ${idx + 1}. ${age}s ago, Line ${ins.lineNumber}, ${ins.text.length} chars`);
            console.log(`     Preview: "${ins.text.substring(0, 80).replace(/\n/g, '\\n')}"`);
        });
    }
    
    let copilotUsedCount = 0;
    let manualChangesCount = 0;
    const matchedChanges: string[] = [];

    // Collect all changed lines
    const allChangedLines: Array<{lineNumber: number, content: string}> = [];
    
    differences.added.forEach((line: any) => {
        allChangedLines.push({ lineNumber: line.lineNumber, content: line.content });
    });
    
    differences.modified.forEach((line: any) => {
        allChangedLines.push({ lineNumber: line.lineNumber, content: line.newContent });
    });

    console.log(`\nAnalyzing ${allChangedLines.length} changed lines...`);
    
    if (allChangedLines.length > 0) {
        console.log('\nChanged lines from Git:');
        allChangedLines.forEach(line => {
            console.log(`  Line ${line.lineNumber}: "${line.content}"`);
        });
    }

    // STRATEGY: Match changed lines against recent insertions
    if (fileInsertions.length > 0 && allChangedLines.length > 0) {
        console.log('\n=== MATCHING CHANGES AGAINST INSERTIONS ===');
        
        // Track which insertion matched which lines (allow multiple matches per insertion)
        const insertionMatches = new Map<number, number>(); // insertion index -> match count
        
        allChangedLines.forEach(changedLine => {
            const lineContent = changedLine.content.trim();
            
            if (lineContent.length === 0) {
                return;
            }
            
            let foundMatch = false;
            
            // Check if this line appears in any recent insertion
            fileInsertions.forEach((insertion, idx) => {
                // DON'T skip already used insertions - one insertion can match multiple lines!
                
                const insertionLines = insertion.text.split('\n').map(l => l.trim());
                
                // Check if line matches any part of the insertion
                const isMatch = insertionLines.some(insLine => {
                    // Exact match
                    if (insLine === lineContent) {
                        return true;
                    }
                    
                    // Case-insensitive match
                    if (insLine.toLowerCase() === lineContent.toLowerCase() && lineContent.length > 5) {
                        return true;
                    }
                    
                    // Partial match (for long lines)
                    if (lineContent.length > 15 && insLine.length > 15) {
                        if (insLine.includes(lineContent) || lineContent.includes(insLine)) {
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                if (isMatch) {
                    foundMatch = true;
                    
                    // Track that this insertion matched this line
                    const currentCount = insertionMatches.get(idx) || 0;
                    insertionMatches.set(idx, currentCount + 1);
                    
                    copilotUsedCount++;
                    matchedChanges.push(
                        `Line ${changedLine.lineNumber}: "${lineContent.substring(0, 60)}${lineContent.length > 60 ? '...' : ''}"`
                    );
                    console.log(`  Line ${changedLine.lineNumber} MATCHED to insertion ${idx + 1}`);
                }
            });
            
            if (!foundMatch) {
                manualChangesCount++;
                console.log(`  Line ${changedLine.lineNumber} - No match (manual or old change)`);
            }
        });
        
        console.log(`\nInsertion usage summary:`);
        insertionMatches.forEach((count, idx) => {
            console.log(`  Insertion ${idx + 1} matched ${count} line(s)`);
        });
        console.log(`Total: ${insertionMatches.size} insertions used for ${copilotUsedCount} lines`);
    } else {
        // No insertions tracked = all manual
        manualChangesCount = allChangedLines.filter(l => l.content.trim().length > 0).length;
        console.log('\nNo recent insertions found - all changes counted as manual');
    }

    // Print results
    console.log('\n' + '-'.repeat(80));
    console.log('RESULTS:');
    console.log('-'.repeat(80));
    console.log(`Changes from Copilot: ${copilotUsedCount}`);
    console.log(`Manual changes: ${manualChangesCount}`);
    
    if (copilotUsedCount > 0) {
        console.log('\nCopilot-assisted changes detected:');
        matchedChanges.forEach(match => {
            console.log(`  ${match}`);
        });
    } else {
        console.log('\nNo Copilot-assisted changes detected in these changes.');
        if (fileInsertions.length > 0) {
            console.log('\nNote: Insertions were tracked but did not match Git changes.');
            console.log('This could mean:');
            console.log('  - Changes were committed before tracking started');
            console.log('  - Insertions were undone or modified');
            console.log('  - Matching algorithm needs adjustment');
        }
    }

    const totalChanges = copilotUsedCount + manualChangesCount;
    const copilotPercentage = totalChanges > 0 
        ? Math.round((copilotUsedCount / totalChanges) * 100) 
        : 0;

    console.log(`\nCopilot usage: ${copilotPercentage}% of changes (${copilotUsedCount}/${totalChanges} lines)`);
    console.log('='.repeat(80) + '\n');

    const message = copilotUsedCount > 0
        ? `Copilot: ${copilotUsedCount} of ${totalChanges} changes (${copilotPercentage}%)`
        : `No Copilot-assisted changes detected`;
    
    vscode.window.showInformationMessage(message);
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
