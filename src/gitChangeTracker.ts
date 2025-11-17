import * as vscode from 'vscode';
import { ChatbotPanel } from './chatbotPanel';

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

            // Check if changes were AI-generated
            await this.checkAIGeneratedChanges(differences, document);

        } catch (error) {
            console.error('Error:', error);
        }
    }

    private async checkAIGeneratedChanges(differences: any, document: vscode.TextDocument): Promise<void> {
        const chatbot = ChatbotPanel.getCurrentPanel();
        
        if (!chatbot) {
            console.log('Chatbot not available for AI content detection');
            return;
        }

        let highestSimilarity = 0;
        let bestMatch: any = null;
        let matchType = '';
        let matchedContent = '';

        // Extract code segments from added lines
        if (differences.added.length > 0) {
            const addedContent = differences.added.map((line: any) => line.content).join('\n');
            const codeSegments = this.extractCodeSegmentsFromChanges(addedContent);
            
            // Check each segment individually
            for (const segment of codeSegments) {
                const aiCheck = chatbot.checkAIGeneratedContent(segment);
                
                if (aiCheck.isAIGenerated && aiCheck.matchedMessages.length > 0) {
                    const topMatch = aiCheck.matchedMessages[0];
                    if (topMatch.similarity > highestSimilarity) {
                        highestSimilarity = topMatch.similarity;
                        bestMatch = topMatch;
                        matchType = 'ADDED';
                        matchedContent = segment;
                    }
                }
            }
            
            // If no segments found or low similarity, check the entire added content
            if (highestSimilarity < 0.8) {
                const aiCheck = chatbot.checkAIGeneratedContent(addedContent);
                if (aiCheck.isAIGenerated && aiCheck.matchedMessages.length > 0) {
                    const topMatch = aiCheck.matchedMessages[0];
                    if (topMatch.similarity > highestSimilarity) {
                        highestSimilarity = topMatch.similarity;
                        bestMatch = topMatch;
                        matchType = 'ADDED';
                        matchedContent = addedContent;
                    }
                }
            }
        }

        // Extract code segments from modified lines
        if (differences.modified.length > 0) {
            const modifiedContent = differences.modified.map((line: any) => line.newContent).join('\n');
            const codeSegments = this.extractCodeSegmentsFromChanges(modifiedContent);
            
            // Check each segment individually
            for (const segment of codeSegments) {
                const aiCheck = chatbot.checkAIGeneratedContent(segment);
                
                if (aiCheck.isAIGenerated && aiCheck.matchedMessages.length > 0) {
                    const topMatch = aiCheck.matchedMessages[0];
                    if (topMatch.similarity > highestSimilarity) {
                        highestSimilarity = topMatch.similarity;
                        bestMatch = topMatch;
                        matchType = 'MODIFIED';
                        matchedContent = segment;
                    }
                }
            }
            
            // If no segments found or low similarity, check the entire modified content
            if (highestSimilarity < 0.8) {
                const aiCheck = chatbot.checkAIGeneratedContent(modifiedContent);
                if (aiCheck.isAIGenerated && aiCheck.matchedMessages.length > 0) {
                    const topMatch = aiCheck.matchedMessages[0];
                    if (topMatch.similarity > highestSimilarity) {
                        highestSimilarity = topMatch.similarity;
                        bestMatch = topMatch;
                        matchType = 'MODIFIED';
                        matchedContent = modifiedContent;
                    }
                }
            }
        }

        // Log only if we found a match
        if (bestMatch && highestSimilarity > 0.7) {
            console.log('\n' + '⚠'.repeat(80));
            console.log(`AI-GENERATED CONTENT DETECTED IN ${matchType} LINES`);
            console.log('⚠'.repeat(80));
            console.log(`Maximum Similarity: ${(highestSimilarity * 100).toFixed(2)}%`);
            console.log(`\nChanged Code Segment:`);
            console.log('-'.repeat(80));
            console.log(matchedContent.substring(0, 500)); // Show first 500 chars
            console.log('-'.repeat(80));
            console.log(`\nMatched Content from Chatbot:`);
            console.log('-'.repeat(80));
            console.log(bestMatch.matchedPortion.substring(0, 500)); // Show first 500 chars
            console.log('-'.repeat(80));
            console.log('⚠'.repeat(80) + '\n');

            // Show VS Code notification
            const action = await vscode.window.showWarningMessage(
                `AI-generated content detected (${(highestSimilarity * 100).toFixed(0)}% match)`,
                'View Details',
                'Ignore'
            );

            if (action === 'View Details') {
                await this.showDetailedAIReport(matchedContent, bestMatch, highestSimilarity, matchType, document);
            }
        }
    }

    private extractCodeSegmentsFromChanges(content: string): string[] {
        const segments: string[] = [];
        const lines = content.split('\n');
        
        let currentSegment: string[] = [];
        let inBlock = false;
        let baseIndent = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const currentIndent = line.length - line.trimStart().length;
            
            if (trimmedLine.length === 0 && !inBlock) {
                continue;
            }
            
            // Detect function/class/block definition
            const isBlockStart = 
                trimmedLine.startsWith('def ') || 
                trimmedLine.startsWith('class ') ||
                trimmedLine.startsWith('function ') ||
                trimmedLine.startsWith('const ') && (trimmedLine.includes('= function') || trimmedLine.includes('=> ')) ||
                trimmedLine.startsWith('let ') && (trimmedLine.includes('= function') || trimmedLine.includes('=> ')) ||
                trimmedLine.startsWith('async ') ||
                trimmedLine.startsWith('export ');
            
            if (isBlockStart) {
                if (currentSegment.length > 0) {
                    segments.push(currentSegment.join('\n').trim());
                }
                
                currentSegment = [line];
                inBlock = true;
                baseIndent = currentIndent;
            } else if (inBlock) {
                currentSegment.push(line);
                
                if (trimmedLine.length > 0 && currentIndent <= baseIndent && i > 0) {
                    const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
                    const nextTrimmed = nextLine.trim();
                    
                    if (nextTrimmed.length === 0 || 
                        nextTrimmed.startsWith('def ') ||
                        nextTrimmed.startsWith('class ') ||
                        nextTrimmed.startsWith('function ') ||
                        i === lines.length - 1) {
                        segments.push(currentSegment.join('\n').trim());
                        currentSegment = [];
                        inBlock = false;
                    }
                }
            } else {
                if (trimmedLine.length > 0) {
                    currentSegment.push(line);
                }
            }
        }
        
        if (currentSegment.length > 0) {
            segments.push(currentSegment.join('\n').trim());
        }
        
        return segments.filter(s => s.trim().length > 20);
    }

    private async showDetailedAIReport(
        changedContent: string,
        bestMatch: any, 
        similarity: number, 
        matchType: string, 
        document: vscode.TextDocument
    ): Promise<void> {
        const report = `# AI Content Detection Report

**File:** ${document.fileName}
**Match Type:** ${matchType} Lines
**Similarity:** ${(similarity * 100).toFixed(2)}%

---

## Changed Code in File

\`\`\`${document.languageId}
${changedContent}
\`\`\`

---

## Matched Content from Chatbot

\`\`\`
${bestMatch.matchedPortion}
\`\`\`

---

## Analysis

- **Similarity Score:** ${(similarity * 100).toFixed(2)}%
- **Match Quality:** ${similarity > 0.95 ? 'Exact Match' : similarity > 0.85 ? 'Very High' : 'High'}

${similarity > 0.95 ? '⚠️ **Warning:** This appears to be an exact or near-exact copy from the AI assistant.' : ''}
`;

        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
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