import * as vscode from 'vscode';
import { ChatbotPanel } from './chatbotPanel';

interface LineMatch {
    fileLineNumber: number;
    chatbotLine: string;
    fileLineContent: string;
    userPrompt: string;
    timestamp: string;
}

export class GitChangeTracker {
    private context: vscode.ExtensionContext;
    private documentMatches: Map<string, LineMatch[]> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public activate(): void {
        this.setupFileSaveListener();
    }

    private setupFileSaveListener(): void {
        const disposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            await this.checkChangesAgainstGit(document);
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

            // Check for exact line-by-line matches with AI-generated content
            await this.checkExactLineMatches(differences, document);

        } catch (error) {
            console.error('Error:', error);
        }
    }

    private async checkExactLineMatches(differences: any, document: vscode.TextDocument): Promise<void> {
        const chatbot = ChatbotPanel.getCurrentPanel();
        
        if (!chatbot) {
            console.log('Chatbot not available for AI content detection');
            return;
        }

        // Get conversation history with timestamps
        const conversationHistory = chatbot.getConversationHistory();
        
        console.log('\n🔍 Starting exact line-by-line matching...');
        console.log(`Total conversation messages: ${conversationHistory.length}`);
        console.log(`Added lines to check: ${differences.added.length}`);
        console.log(`Modified lines to check: ${differences.modified.length}`);

        const matches: LineMatch[] = [];
        const author = await this.getGitAuthor();

        // Check added lines for exact matches
        if (differences.added.length > 0) {
            console.log('\n📝 Checking ADDED lines for exact matches:');
            
            for (const addedLine of differences.added) {
                const trimmedFileLine = addedLine.content.trim();
                
                // Skip empty lines
                if (trimmedFileLine.length === 0) {
                    continue;
                }

                console.log(`  Checking line ${addedLine.lineNumber}: "${trimmedFileLine}"`);

                // Check against each assistant message in conversation history
                for (let msgIndex = 0; msgIndex < conversationHistory.length; msgIndex++) {
                    const msg = conversationHistory[msgIndex];
                    
                    if (msg.role === 'assistant') {
                        const chatbotLines = msg.content.split('\n');
                        
                        for (const chatbotLine of chatbotLines) {
                            const trimmedChatbotLine = chatbotLine.trim();
                            
                            // Exact match check
                            if (trimmedFileLine === trimmedChatbotLine && trimmedChatbotLine.length > 0) {
                                // Find the user prompt that led to this response
                                const userPrompt = this.findUserPromptForResponse(conversationHistory, msgIndex);
                                
                                console.log(`    ✅ EXACT MATCH FOUND!`);
                                console.log(`       Chatbot line: "${trimmedChatbotLine}"`);
                                console.log(`       User prompt: "${userPrompt.substring(0, 50)}..."`);
                                
                                matches.push({
                                    fileLineNumber: addedLine.lineNumber,
                                    chatbotLine: trimmedChatbotLine,
                                    fileLineContent: trimmedFileLine,
                                    userPrompt: userPrompt,
                                    timestamp: msg.timestamp.toISOString()
                                });
                                
                                // Break after finding first match for this line
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Check modified lines for exact matches
        if (differences.modified.length > 0) {
            console.log('\n📝 Checking MODIFIED lines for exact matches:');
            
            for (const modifiedLine of differences.modified) {
                const trimmedFileLine = modifiedLine.newContent.trim();
                
                // Skip empty lines
                if (trimmedFileLine.length === 0) {
                    continue;
                }

                console.log(`  Checking line ${modifiedLine.lineNumber}: "${trimmedFileLine}"`);

                // Check against each assistant message in conversation history
                for (let msgIndex = 0; msgIndex < conversationHistory.length; msgIndex++) {
                    const msg = conversationHistory[msgIndex];
                    
                    if (msg.role === 'assistant') {
                        const chatbotLines = msg.content.split('\n');
                        
                        for (const chatbotLine of chatbotLines) {
                            const trimmedChatbotLine = chatbotLine.trim();
                            
                            // Exact match check
                            if (trimmedFileLine === trimmedChatbotLine && trimmedChatbotLine.length > 0) {
                                // Find the user prompt that led to this response
                                const userPrompt = this.findUserPromptForResponse(conversationHistory, msgIndex);
                                
                                console.log(`    ✅ EXACT MATCH FOUND!`);
                                console.log(`       Chatbot line: "${trimmedChatbotLine}"`);
                                console.log(`       User prompt: "${userPrompt.substring(0, 50)}..."`);
                                
                                matches.push({
                                    fileLineNumber: modifiedLine.lineNumber,
                                    chatbotLine: trimmedChatbotLine,
                                    fileLineContent: trimmedFileLine,
                                    userPrompt: userPrompt,
                                    timestamp: msg.timestamp.toISOString()
                                });
                                
                                // Break after finding first match for this line
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Remove duplicates (same line number)
        const uniqueMatches = this.removeDuplicateMatches(matches);

        console.log(`\n✅ Total exact matches found: ${uniqueMatches.length}`);

        // Store matches for this document
        this.documentMatches.set(document.uri.toString(), uniqueMatches);

        // Display results
        if (uniqueMatches.length > 0) {
            this.displayMatchResults(uniqueMatches, author, document);
        } else {
            console.log('\n✓ No exact line matches found with chatbot code.');
        }
    }

    private findUserPromptForResponse(conversationHistory: any[], assistantIndex: number): string {
        // Look backward from the assistant message to find the most recent user message
        for (let i = assistantIndex - 1; i >= 0; i--) {
            if (conversationHistory[i].role === 'user') {
                // Remove file context info if present
                let content = conversationHistory[i].content;
                const userQuestionMatch = content.match(/User Question: (.+)/s);
                if (userQuestionMatch) {
                    return userQuestionMatch[1].trim();
                }
                return content;
            }
        }
        return 'No user prompt found';
    }

    private removeDuplicateMatches(matches: LineMatch[]): LineMatch[] {
        const seen = new Set<number>();
        return matches.filter(match => {
            if (seen.has(match.fileLineNumber)) {
                return false;
            }
            seen.add(match.fileLineNumber);
            return true;
        });
    }

    private displayMatchResults(matches: LineMatch[], author: string, document: vscode.TextDocument): void {
        console.log('\n' + '⚠'.repeat(80));
        console.log(`🤖 EXACT LINE MATCHES DETECTED: ${matches.length} line(s)`);
        console.log('⚠'.repeat(80));

        // Sort by line number
        matches.sort((a, b) => a.fileLineNumber - b.fileLineNumber);

        console.log('\n📍 MATCHED LINES:');
        matches.forEach(match => {
            console.log(`\n  Line ${match.fileLineNumber} - 100% EXACT MATCH`);
            console.log(`    Content: "${match.fileLineContent}"`);
            console.log(`    Author: ${author}`);
            console.log(`    Timestamp: ${new Date(match.timestamp).toLocaleString()}`);
            console.log(`    Purpose: ${match.userPrompt.substring(0, 100)}${match.userPrompt.length > 100 ? '...' : ''}`);
        });

        console.log('\n' + '-'.repeat(80));

        // Summary
        const lineNumbers = matches.map(m => m.fileLineNumber).join(', ');
        console.log(`\n✅ SUMMARY: Line(s) ${lineNumbers} are 100% exact matches from AI chatbot`);
        console.log('⚠'.repeat(80) + '\n');

        // Show VS Code notification
        vscode.window.showWarningMessage(
            `🤖 AI-generated: ${matches.length} line(s) matched exactly (Lines: ${lineNumbers})`,
            'View Details'
        ).then(selection => {
            if (selection === 'View Details') {
                vscode.commands.executeCommand('workbench.action.terminal.focus');
            }
        });
    }

    private async getGitAuthor(): Promise<string> {
        try {
            const git = await this.getGitExtension();
            if (!git) {
                return 'Unknown';
            }

            const repo = this.getGitRepository(git);
            if (!repo) {
                return 'Unknown';
            }

            const config = await repo.getConfig('user.name');
            return config || 'Unknown';
        } catch (error) {
            return 'Unknown';
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