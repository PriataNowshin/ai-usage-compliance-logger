import * as vscode from 'vscode';
import { ChatbotPanel } from './chatbotPanel';
import OpenAI from 'openai';

interface LineMatch {
    fileLineNumber: number;
    chatbotLine: string;
    fileLineContent: string;
    userPrompt: string;
    timestamp: string;
    modelName: string;
}

interface FunctionGroup {
    functionStartLine: number;
    purposeGroups: Map<string, number[]>; // purpose -> line numbers
    author: string;
    timestamp: string;
    modelName: string;
}

export class GitChangeTracker {
    private context: vscode.ExtensionContext;
    private documentMatches: Map<string, LineMatch[]> = new Map();
    private taggedFunctions: Map<string, Set<number>> = new Map(); // Track which functions already have tags
    private openai: OpenAI;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: "",
        });
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

        const conversationHistory = chatbot.getConversationHistory();
        const selectedModel = this.getSelectedModelName(chatbot);
        
        console.log('\n🔍 Starting exact line-by-line matching...');
        console.log(`Total conversation messages: ${conversationHistory.length}`);
        console.log(`Added lines to check: ${differences.added.length}`);
        console.log(`Modified lines to check: ${differences.modified.length}`);

        const matches: LineMatch[] = [];
        const author = await this.getGitAuthor();

        // CRITICAL: Get the MOST RECENT assistant response (last one in conversation)
        const recentResponses = conversationHistory
            .filter((msg: any) => msg.role === 'assistant')
            .slice(-3); // Only check last 3 assistant responses (most recent edits)

        console.log(`\n🎯 Checking only against ${recentResponses.length} most recent assistant response(s)`);

        // Check ONLY added lines (new code written in this save)
        if (differences.added.length > 0) {
            console.log('\n📝 Checking ADDED lines for exact matches:');
            
            for (const addedLine of differences.added) {
                const trimmedFileLine = addedLine.content.trim();
                
                // Skip empty lines and LLM_Generated tags
                if (trimmedFileLine.length === 0 || trimmedFileLine.includes('@LLM_Generated')) {
                    continue;
                }

                console.log(`  Checking line ${addedLine.lineNumber}: "${trimmedFileLine}"`);

                // Check ONLY against recent responses
                for (let msgIndex = 0; msgIndex < recentResponses.length; msgIndex++) {
                    const msg = recentResponses[msgIndex];
                    const chatbotLines = msg.content.split('\n');
                    
                    for (const chatbotLine of chatbotLines) {
                        const trimmedChatbotLine = chatbotLine.trim();
                        
                        if (trimmedFileLine === trimmedChatbotLine && trimmedChatbotLine.length > 0) {
                            // Find the actual message index in full history
                            const actualMsgIndex = conversationHistory.indexOf(msg);
                            const userPrompt = this.findUserPromptForResponse(conversationHistory, actualMsgIndex);
                            
                            console.log(`    ✅ EXACT MATCH FOUND in recent response!`);
                            console.log(`       Chatbot line: "${trimmedChatbotLine}"`);
                            console.log(`       User prompt: "${userPrompt.substring(0, 50)}..."`);
                            
                            matches.push({
                                fileLineNumber: addedLine.lineNumber,
                                chatbotLine: trimmedChatbotLine,
                                fileLineContent: trimmedFileLine,
                                userPrompt: userPrompt,
                                timestamp: msg.timestamp.toISOString(),
                                modelName: selectedModel
                            });
                            
                            break;
                        }
                    }
                }
            }
        }

        // DON'T check modified lines - they might be human code that was modified
        // Only check if the NEW content in modified lines is AI-generated
        if (differences.modified.length > 0) {
            console.log('\n📝 Checking MODIFIED lines (new content only):');
            
            for (const modifiedLine of differences.modified) {
                const trimmedNewContent = modifiedLine.newContent.trim();
                const trimmedOldContent = modifiedLine.oldContent.trim();
                
                // Skip if the line already existed (might be human code)
                if (trimmedOldContent.length > 0) {
                    console.log(`  Skipping line ${modifiedLine.lineNumber}: was modified, not new`);
                    continue;
                }
                
                // Skip empty lines and LLM_Generated tags
                if (trimmedNewContent.length === 0 || trimmedNewContent.includes('@LLM_Generated')) {
                    continue;
                }

                console.log(`  Checking line ${modifiedLine.lineNumber}: "${trimmedNewContent}"`);

                // Check ONLY against recent responses
                for (let msgIndex = 0; msgIndex < recentResponses.length; msgIndex++) {
                    const msg = recentResponses[msgIndex];
                    const chatbotLines = msg.content.split('\n');
                    
                    for (const chatbotLine of chatbotLines) {
                        const trimmedChatbotLine = chatbotLine.trim();
                        
                        if (trimmedNewContent === trimmedChatbotLine && trimmedChatbotLine.length > 0) {
                            const actualMsgIndex = conversationHistory.indexOf(msg);
                            const userPrompt = this.findUserPromptForResponse(conversationHistory, actualMsgIndex);
                            
                            console.log(`    ✅ EXACT MATCH FOUND in recent response!`);
                            
                            matches.push({
                                fileLineNumber: modifiedLine.lineNumber,
                                chatbotLine: trimmedChatbotLine,
                                fileLineContent: trimmedNewContent,
                                userPrompt: userPrompt,
                                timestamp: msg.timestamp.toISOString(),
                                modelName: selectedModel
                            });
                            
                            break;
                        }
                    }
                }
            }
        }

        const uniqueMatches = this.removeDuplicateMatches(matches);

        console.log(`\n✅ Total exact matches found: ${uniqueMatches.length}`);

        this.documentMatches.set(document.uri.toString(), uniqueMatches);

        if (uniqueMatches.length > 0) {
            await this.displayMatchResults(uniqueMatches, author, document);
            
            // NEW: Separate matches into two groups:
            // 1. Matches belonging to functions that already have tags (for updating)
            // 2. Matches belonging to functions WITHOUT tags (for adding new tags)
            
            const docContent = document.getText();
            const docLines = docContent.split('\n');
            
            // Find which functions already have tags
            const functionsWithTags = new Set<number>();
            for (let i = 0; i < docLines.length; i++) {
                if (docLines[i].includes('@LLM_Generated')) {
                    // The function is on the next line
                    functionsWithTags.add(i + 1);
                    console.log(`  📌 Found existing tag at line ${i + 1}, function at line ${i + 2}`);
                }
            }
            
            console.log(`\n📋 Functions with existing tags at lines: ${Array.from(functionsWithTags).map(l => l + 1).join(', ')}`);
            
            // Separate matches by whether their function has a tag
            const matchesForUpdate: LineMatch[] = [];
            const matchesForNewTags: LineMatch[] = [];
            
            for (const match of uniqueMatches) {
                const functionStartLine = this.findFunctionStart(document, match.fileLineNumber - 1);
                
                console.log(`  🔍 Line ${match.fileLineNumber} belongs to function at line ${functionStartLine + 1}`);
                
                if (functionsWithTags.has(functionStartLine)) {
                    matchesForUpdate.push(match);
                    console.log(`    ✅ Function at ${functionStartLine + 1} HAS TAG - will update`);
                } else {
                    matchesForNewTags.push(match);
                    console.log(`    ➕ Function at ${functionStartLine + 1} NO TAG - will add new`);
                }
            }
            
            console.log(`\n📊 Summary:`);
            console.log(`  Matches for updating existing tags: ${matchesForUpdate.length}`);
            console.log(`  Matches for adding new tags: ${matchesForNewTags.length}`);
            
            // Update existing tags first
            if (matchesForUpdate.length > 0) {
                console.log(`\n🔄 Updating ${matchesForUpdate.length} existing tag(s)...`);
                await this.updateExistingTags(document, matchesForUpdate);
            }
            
            // Then add new tags
            if (matchesForNewTags.length > 0) {
                console.log(`\n➕ Adding ${matchesForNewTags.length} new tag(s)...`);
                await this.addDecoratorTags(matchesForNewTags, author, document);
            }
            
            if (matchesForUpdate.length === 0 && matchesForNewTags.length === 0) {
                console.log('\n  ℹ️  No tags to add or update.');
            }
        } else {
            console.log('\n✓ No exact line matches found with chatbot code.');
        }
    }

    private async addDecoratorTags(matches: LineMatch[], author: string, document: vscode.TextDocument): Promise<void> {
        console.log('\n🏷️  Generating decorator tags for functions...');
        
        // Group matches by function
        const functionGroups = await this.groupMatchesByFunction(matches, document);
        
        if (functionGroups.length === 0) {
            console.log('No functions found to tag.');
            return;
        }

        console.log(`Found ${functionGroups.length} function(s) with matches`);

        const docContent = document.getText();
        const docLines = docContent.split('\n');
        
        const functionsToTag: FunctionGroup[] = [];
        
        for (const funcGroup of functionGroups) {
            // Check if the line DIRECTLY above the function has a tag
            const lineAboveFunction = funcGroup.functionStartLine > 0 ? docLines[funcGroup.functionStartLine - 1] : '';
            
            // Only skip if the IMMEDIATE previous line has a tag
            if (lineAboveFunction.trim().includes('@LLM_Generated')) {
                console.log(`  ⚠️  Function at line ${funcGroup.functionStartLine + 1} already has a tag. Skipping.`);
                continue;
            }
            
            functionsToTag.push(funcGroup);
            console.log(`  ✅ Will tag function at line ${funcGroup.functionStartLine + 1}`);
        }

        if (functionsToTag.length === 0) {
            console.log('All matching functions already have tags.');
            return;
        }

        console.log(`Will add tags to ${functionsToTag.length} function(s)`);

        // Generate decorator tags for each function
        const decoratorTags: string[] = [];
        const insertPositions: number[] = [];
        
        for (const funcGroup of functionsToTag) {
            const tag = await this.generateDecoratorTag(funcGroup);
            decoratorTags.push(tag);
            insertPositions.push(funcGroup.functionStartLine);
            
            console.log(`  📝 Prepared tag for function at line ${funcGroup.functionStartLine + 1}`);
        }

        // Insert decorator comments into the document
        await this.insertDecoratorComments(decoratorTags, insertPositions, document);
        
        console.log(`✅ Added ${decoratorTags.length} decorator tag(s) to the document`);
    }

    private async groupMatchesByFunction(matches: LineMatch[], document: vscode.TextDocument): Promise<FunctionGroup[]> {
        const functionMap = new Map<number, LineMatch[]>();

        // Group matches by their containing function
        for (const match of matches) {
            const functionStartLine = this.findFunctionStart(document, match.fileLineNumber - 1);
            
            if (!functionMap.has(functionStartLine)) {
                functionMap.set(functionStartLine, []);
            }
            functionMap.get(functionStartLine)!.push(match);
        }

        // Convert to FunctionGroup array with purpose grouping
        const functionGroups: FunctionGroup[] = [];

        for (const [functionStartLine, functionMatches] of functionMap) {
            // Group matches by purpose within this function
            const purposeMap = new Map<string, number[]>();
            
            for (const match of functionMatches) {
                const purpose = await this.extractPurpose(match.userPrompt);
                
                if (!purposeMap.has(purpose)) {
                    purposeMap.set(purpose, []);
                }
                purposeMap.get(purpose)!.push(match.fileLineNumber);
            }

            functionGroups.push({
                functionStartLine: functionStartLine,
                purposeGroups: purposeMap,
                author: functionMatches[0].userPrompt ? await this.getGitAuthor() : 'Unknown',
                timestamp: new Date(functionMatches[0].timestamp).toLocaleString(),
                modelName: functionMatches[0].modelName
            });
        }

        return functionGroups;
    }

    private findFunctionStart(document: vscode.TextDocument, startLine: number): number {
        const functionKeywords = ['def ', 'function ', 'class ', 'const ', 'let ', 'var ', 'async ', 'public ', 'private ', 'protected ', 'export ', 'static '];
        
        for (let i = startLine; i >= Math.max(0, startLine - 30); i--) {
            const lineText = document.lineAt(i).text.trim();
            
            // Skip LLM_Generated tags
            if (lineText.includes('@LLM_Generated')) {
                continue;
            }
            
            if (functionKeywords.some(keyword => lineText.includes(keyword) && (lineText.includes('(') || lineText.includes('=')))) {
                return i;
            }
        }
        
        return startLine;
    }

    private async extractPurpose(userPrompt: string): Promise<string> {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "openai/gpt-oss-20b:free",
                messages: [{
                    role: 'user',
                    content: `Think carefully and extract the main purpose.\n\nPrompt: "${userPrompt}"\n\nRespond with ONLY 2-3 words (e.g., "subtract function", "error handling", "data validation"):`
                }],
                max_tokens: 10,
                temperature: 0.7
            });

            const purpose = completion.choices[0].message.content?.trim() || 'code generation';
            console.log(`  🎯 Extracted purpose: "${purpose}" from prompt: "${userPrompt.substring(0, 50)}..."`);
            return purpose;
        } catch (error) {
            console.error('Error extracting purpose with LLM:', error);
            return this.extractPurposeManually(userPrompt);
        }
    }

    private extractPurposeManually(prompt: string): string {
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('subtract')) return 'subtract function';
        if (lowerPrompt.includes('add')) return 'add function';
        if (lowerPrompt.includes('multiply')) return 'multiply function';
        if (lowerPrompt.includes('divide')) return 'divide function';
        if (lowerPrompt.includes('validate')) return 'data validation';
        if (lowerPrompt.includes('error')) return 'error handling';
        if (lowerPrompt.includes('test')) return 'unit testing';
        if (lowerPrompt.includes('parse')) return 'data parsing';
        if (lowerPrompt.includes('format')) return 'data formatting';
        if (lowerPrompt.includes('function')) return 'function creation';
        if (lowerPrompt.includes('class')) return 'class definition';
        
        return 'code generation';
    }

    private async generateDecoratorTag(funcGroup: FunctionGroup): Promise<string> {
        // Build the decorator tag - consolidate all line numbers and purpose into ONE tag
        let allLineNumbers: number[] = [];
        const allPurposes: string[] = [];
        
        // Collect all line numbers and purposes
        for (const [purpose, lineNumbers] of funcGroup.purposeGroups) {
            allLineNumbers = allLineNumbers.concat(lineNumbers);
            allPurposes.push(purpose);
        }

        // Use the most common or first purpose
        const primaryPurpose = allPurposes[0];
        
        // Format all line numbers together
        const formattedLines = this.formatLineNumbers(allLineNumbers);
        
        // Create single consolidated tag
        const tag = `@LLM_Generated (${funcGroup.modelName} | Author: ${funcGroup.author} | Time: ${funcGroup.timestamp} | Lines: ${formattedLines} | Purpose: ${primaryPurpose})`;
        
        return tag;
    }

    private formatLineNumbers(lineNumbers: number[]): string {
        if (lineNumbers.length === 0) return '';
        
        // Sort line numbers
        const sorted = [...lineNumbers].sort((a, b) => a - b);
        
        // Group consecutive numbers
        const ranges: string[] = [];
        let rangeStart = sorted[0];
        let rangeEnd = sorted[0];
        
        for (let i = 1; i <= sorted.length; i++) {
            if (i < sorted.length && sorted[i] === rangeEnd + 1) {
                rangeEnd = sorted[i];
            } else {
                if (rangeStart === rangeEnd) {
                    ranges.push(`${rangeStart}`);
                } else if (rangeEnd === rangeStart + 1) {
                    ranges.push(`${rangeStart}, ${rangeEnd}`);
                } else {
                    ranges.push(`${rangeStart}-${rangeEnd}`);
                }
                if (i < sorted.length) {
                    rangeStart = sorted[i];
                    rangeEnd = sorted[i];
                }
            }
        }
        
        return ranges.join(', ');
    }

    private async insertDecoratorComments(tags: string[], positions: number[], document: vscode.TextDocument): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor || editor.document !== document) {
            console.log('Active editor does not match the document');
            return;
        }

        console.log(`\n📝 Inserting ${tags.length} decorator comment(s)...`);

        // Sort by position in ASCENDING order (top to bottom)
        const combined = tags.map((tag, i) => ({ tag, position: positions[i] }));
        combined.sort((a, b) => a.position - b.position);

        // First, update all tags with their correct line numbers
        const updatedCombined: Array<{ tag: string, position: number }> = [];
        let cumulativeShift = 0;

        for (let i = 0; i < combined.length; i++) {
            const { tag, position } = combined[i];
            
            // Each tag adds 1 line
            const tagLinesCount = 1;
            
            // Update line numbers in the tag to reflect:
            // 1. Cumulative shift from previous tags
            // 2. +1 for THIS tag being inserted above the function
            const updatedTag = this.updateLineNumbersInTag(tag, cumulativeShift + tagLinesCount);
            
            // Store the updated tag with its adjusted position
            updatedCombined.push({ 
                tag: updatedTag, 
                position: position + cumulativeShift 
            });
            
            console.log(`  Tag ${i + 1}: Shift = ${cumulativeShift}, Position = ${position} -> ${position + cumulativeShift}`);
            console.log(`  Line numbers in tag shifted by: +${cumulativeShift + tagLinesCount}`);
            
            // Increase cumulative shift for next tags
            cumulativeShift += tagLinesCount;
        }

        // Now insert the tags in REVERSE order to avoid line number shifts during insertion
        updatedCombined.reverse();

        await editor.edit(editBuilder => {
            for (const { tag, position } of updatedCombined) {
                const line = document.lineAt(position);
                const indent = line.text.match(/^\s*/)?.[0] || '';
                
                const commentPrefix = this.getCommentPrefix(document.languageId);
                const decoratorComment = `${indent}${commentPrefix} ${tag}\n`;
                
                editBuilder.insert(new vscode.Position(position, 0), decoratorComment);
                
                console.log(`  📍 Inserted tag at line ${position + 1}`);
            }
        });

        console.log(`✅ Successfully applied ${updatedCombined.length} edit(s)`);

        const docUri = document.uri.toString();
        if (!this.taggedFunctions.has(docUri)) {
            this.taggedFunctions.set(docUri, new Set());
        }
        
        for (let i = 0; i < positions.length; i++) {
            this.taggedFunctions.get(docUri)!.add(positions[i]);
        }
    }

    private updateLineNumbersInTag(tag: string, lineShift: number): string {
        // Extract the line numbers section from the tag
        // Format: @LLM_Generated (...| Lines: 4-6 | ...)
        
        const linesMatch = tag.match(/Lines:\s*([0-9,\-\s]+)/);
        if (!linesMatch) {
            return tag;
        }
        
        const linesStr = linesMatch[1];
        const updatedLinesStr = this.shiftLineNumbers(linesStr, lineShift);
        
        return tag.replace(/Lines:\s*[0-9,\-\s]+/, `Lines: ${updatedLinesStr}`);
    }

    private shiftLineNumbers(linesStr: string, shift: number): string {
        // Parse line numbers like "4-6", "4, 6", "4, 6-8"
        const parts = linesStr.split(',').map(s => s.trim());
        const shiftedParts: string[] = [];
        
        for (const part of parts) {
            if (part.includes('-')) {
                // Range like "4-6"
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                shiftedParts.push(`${start + shift}-${end + shift}`);
            } else {
                // Single number like "4"
                const num = parseInt(part.trim());
                shiftedParts.push(`${num + shift}`);
            }
        }
        
        return shiftedParts.join(', ');
    }

    private getCommentPrefix(languageId: string): string {
        const commentMap: { [key: string]: string } = {
            'python': '#',
            'javascript': '//',
            'typescript': '//',
            'java': '//',
            'c': '//',
            'cpp': '//',
            'csharp': '//',
            'go': '//',
            'rust': '//',
            'php': '//',
            'ruby': '#',
            'shell': '#',
            'bash': '#',
            'yaml': '#',
            'toml': '#'
        };
        
        return commentMap[languageId] || '//';
    }

    private getSelectedModelName(chatbot: any): string {
        try {
            const model = chatbot.getSelectedModel?.() || 'openai/gpt-oss-20b:free';
            return this.getModelDisplayName(model);
        } catch {
            return 'GPT OSS 20B';
        }
    }

    private getModelDisplayName(modelId: string): string {
        const modelMap: { [key: string]: string } = {
            'openai/gpt-oss-20b:free': 'GPT OSS 20B',
            'meta-llama/llama-3.2-3b-instruct:free': 'Llama 3.2 3B',
            'mistralai/mistral-7b-instruct:free': 'Mistral 7B'
        };
        
        return modelMap[modelId] || modelId;
    }

    private findUserPromptForResponse(conversationHistory: any[], assistantIndex: number): string {
        for (let i = assistantIndex - 1; i >= 0; i--) {
            if (conversationHistory[i].role === 'user') {
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

        matches.sort((a, b) => a.fileLineNumber - b.fileLineNumber);

        console.log('\n📍 MATCHED LINES:');
        matches.forEach(match => {
            console.log(`\n  Line ${match.fileLineNumber} - 100% EXACT MATCH`);
            console.log(`    Content: "${match.fileLineContent}"`);
            console.log(`    Author: ${author}`);
            console.log(`    Model: ${match.modelName}`);
            console.log(`    Timestamp: ${new Date(match.timestamp).toLocaleString()}`);
            console.log(`    Purpose: ${match.userPrompt.substring(0, 100)}${match.userPrompt.length > 100 ? '...' : ''}`);
        });

        console.log('\n' + '-'.repeat(80));

        const lineNumbers = matches.map(m => m.fileLineNumber).join(', ');
        console.log(`\n✅ SUMMARY: Line(s) ${lineNumbers} are 100% exact matches from AI chatbot`);
        console.log('⚠'.repeat(80) + '\n');

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

    // Add this method to track and update existing tags
    private async updateExistingTags(document: vscode.TextDocument, matches: LineMatch[]): Promise<void> {
        console.log('\n🔄 Checking for existing tags that need updating...');
        
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return;
        }

        const docContent = document.getText();
        const docLines = docContent.split('\n');
        
        // Find all existing @LLM_Generated tags in the document
        const existingTags: Array<{ lineNumber: number, content: string }> = [];
        
        for (let i = 0; i < docLines.length; i++) {
            if (docLines[i].includes('@LLM_Generated')) {
                existingTags.push({ lineNumber: i, content: docLines[i] });
            }
        }

        if (existingTags.length === 0) {
            console.log('  No existing tags found.');
            return;
        }

        console.log(`  Found ${existingTags.length} existing tag(s)`);

        // Get the chatbot conversation history to re-scan for AI-generated content
        const chatbot = ChatbotPanel.getCurrentPanel();
        if (!chatbot) {
            console.log('  Cannot update tags - chatbot not available');
            return;
        }

        const conversationHistory = chatbot.getConversationHistory();

        // For each existing tag, check if we need to update it
        const tagsToUpdate: Array<{ oldLine: number, newTag: string }> = [];

        for (const tag of existingTags) {
            const functionStartLine = tag.lineNumber + 1; // Function is right after the tag
            
            console.log(`\n  Processing tag at line ${tag.lineNumber + 1}`);
            console.log(`    Function should start at line ${functionStartLine + 1}`);
            
            // Find the end of this function
            const functionEndLine = this.findFunctionEnd(document, functionStartLine);
            console.log(`    Function ends at line ${functionEndLine + 1}`);
            
            // Re-scan ALL lines in this function to find which ones are AI-generated
            const aiGeneratedLines: number[] = [];
            const processedLines = new Set<number>(); // Track which lines we've already checked
            
            for (let lineNum = functionStartLine; lineNum <= functionEndLine; lineNum++) {
                const currentLine = docLines[lineNum].trim();
                
                // Skip empty lines ONLY (don't skip function definition anymore)
                if (currentLine.length === 0) {
                    continue;
                }
                
                // Skip if we've already processed this line
                if (processedLines.has(lineNum)) {
                    continue;
                }
                
                let foundMatch = false;
                
                // Check if this line matches any AI-generated content from conversation history
                for (const msg of conversationHistory) {
                    if (msg.role === 'assistant') {
                        const chatbotLines = msg.content.split('\n');
                        
                        for (const chatbotLine of chatbotLines) {
                            const trimmedChatbotLine = chatbotLine.trim();
                            
                            if (currentLine === trimmedChatbotLine && trimmedChatbotLine.length > 0) {
                                aiGeneratedLines.push(lineNum + 1); // +1 for 1-based line numbers
                                processedLines.add(lineNum); // Mark as processed
                                foundMatch = true;
                                console.log(`      ✅ Line ${lineNum + 1} is AI-generated: "${currentLine}"`);
                                break; // Stop checking this line once we find a match
                            }
                        }
                        
                        if (foundMatch) {
                            break; // Stop checking other messages for this line
                        }
                    }
                }
            }

            console.log(`    Found ${aiGeneratedLines.length} AI-generated line(s) in this function`);

            if (aiGeneratedLines.length > 0) {
                console.log(`    AI-generated lines: ${aiGeneratedLines.join(', ')}`);
                
                // Extract metadata from existing tag
                const modelMatch = tag.content.match(/@LLM_Generated \(([^|]+)/);
                const authorMatch = tag.content.match(/Author:\s*([^|]+)/);
                const timeMatch = tag.content.match(/Time:\s*([^|]+)/);
                const purposeMatch = tag.content.match(/Purpose:\s*([^)]+)/);
                
                const model = modelMatch ? modelMatch[1].trim() : 'GPT OSS 20 B';
                const author = authorMatch ? authorMatch[1].trim() : 'Unknown';
                const time = timeMatch ? timeMatch[1].trim() : new Date().toLocaleString();
                const purpose = purposeMatch ? purposeMatch[1].trim() : 'code generation';
                
                // Format the line numbers
                const formattedLines = this.formatLineNumbers(aiGeneratedLines);
                
                // Create updated tag
                const newTag = `@LLM_Generated (${model} | Author: ${author} | Time: ${time} | Lines: ${formattedLines} | Purpose: ${purpose})`;
                
                console.log(`    Old tag: ${tag.content.trim()}`);
                console.log(`    New tag: ${this.getCommentPrefix(document.languageId)} ${newTag}`);
                
                // Only update if the tag actually changed
                const oldTagContent = tag.content.trim();
                const newTagContent = `${this.getCommentPrefix(document.languageId)} ${newTag}`;
                
                if (oldTagContent !== newTagContent) {
                    tagsToUpdate.push({ oldLine: tag.lineNumber, newTag });
                } else {
                    console.log(`    Tag is already up-to-date, skipping`);
                }
            } else {
                console.log(`    No AI-generated lines found for this function`);
            }
        }

        // Apply all tag updates
        if (tagsToUpdate.length > 0) {
            await editor.edit(editBuilder => {
                for (const { oldLine, newTag } of tagsToUpdate) {
                    const line = document.lineAt(oldLine);
                    const indent = line.text.match(/^\s*/)?.[0] || '';
                    const commentPrefix = this.getCommentPrefix(document.languageId);
                    const updatedComment = `${indent}${commentPrefix} ${newTag}`;
                    
                    // Replace the entire line
                    editBuilder.replace(line.range, updatedComment);
                    
                    console.log(`  ✅ Updated tag at line ${oldLine + 1}`);
                }
            });
            
            console.log(`\n✅ Updated ${tagsToUpdate.length} tag(s)`);
        } else {
            console.log('\n  No tags need updating.');
        }
    }

    private findFunctionEnd(document: vscode.TextDocument, functionStartLine: number): number {
        const docLines = document.getText().split('\n');
        const functionLine = docLines[functionStartLine];
        const functionIndent = functionLine.match(/^\s*/)?.[0].length || 0;
        
        console.log(`    Finding end of function starting at line ${functionStartLine + 1} (indent: ${functionIndent})`);
        
        // Search forward to find where the function ends
        // Function ends when we hit a line with same or less indentation (that's not empty/comment)
        for (let i = functionStartLine + 1; i < docLines.length; i++) {
            const line = docLines[i];
            const trimmedLine = line.trim();
            
            // Skip empty lines and comments
            if (trimmedLine.length === 0 || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
                continue;
            }
            
            const lineIndent = line.match(/^\s*/)?.[0].length || 0;
            
            // If we hit a line with same or less indentation, function has ended
            if (lineIndent <= functionIndent) {
                console.log(`    Function ends at line ${i}`);
                return i - 1;
            }
        }
        
        // If we reach end of file, function ends at last line
        console.log(`    Function ends at end of file (line ${docLines.length})`);
        return docLines.length - 1;
    }
}