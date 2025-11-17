import * as vscode from 'vscode';
import OpenAI from 'openai';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export class ChatbotPanel {
    private static currentPanel: ChatbotPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private conversationHistory: Message[] = [];
    private disposables: vscode.Disposable[] = [];
    private openai!: OpenAI;
    private selectedModel: string = "openai/gpt-oss-20b:free";
    private includeFileContext: boolean = true;
    private lastActiveEditor: vscode.TextEditor | undefined; // Add this to cache the last editor

    private constructor(panel: vscode.WebviewPanel, private readonly context: vscode.ExtensionContext) {
        this.panel = panel;
        
        // Cache the current active editor before opening the panel
        this.lastActiveEditor = vscode.window.activeTextEditor;
        
        // Initialize OpenAI immediately
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: "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",
        });
        
        // Load conversation history from storage FIRST
        this.loadConversationHistory().then(() => {
            // THEN set HTML
            this.panel.webview.html = this.getHtmlContent();
            
            this.panel.webview.onDidReceiveMessage(
                message => this.handleMessage(message),
                null,
                this.disposables
            );

            this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
            
            // Restore conversation AFTER webview is ready
            setTimeout(() => {
                this.restoreConversationInUI();
                // Send file context after webview is ready
                this.sendFileContextToWebview();
            }, 100);
        });
        
        // Listen for active editor changes
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.lastActiveEditor = editor;
                this.sendFileContextToWebview();
            }
        }, null, this.disposables);
    }

    public static createOrShow(context: vscode.ExtensionContext) {
        if (ChatbotPanel.currentPanel) {
            ChatbotPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'aiChatbot',
            'AI Assistant',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ChatbotPanel.currentPanel = new ChatbotPanel(panel, context);
    }

    public static togglePanel(context: vscode.ExtensionContext) {
        if (ChatbotPanel.currentPanel) {
            // If panel exists, close it
            ChatbotPanel.currentPanel.dispose();
            ChatbotPanel.currentPanel = undefined;
        } else {
            // If panel doesn't exist, create it
            ChatbotPanel.createOrShow(context);
        }
    }

    private async loadConversationHistory(): Promise<void> {
        const saved = this.context.globalState.get<Message[]>('conversationHistory');
        if (saved) {
            // Convert timestamp strings back to Date objects
            this.conversationHistory = saved.map(msg => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
            }));
        }
    }

    private async saveConversationHistory() {
        await this.context.globalState.update('conversationHistory', this.conversationHistory);
    }

    private restoreConversationInUI() {
        // Send all previous messages to the webview
        this.conversationHistory.forEach(msg => {
            if (msg.role === 'user') {
                this.panel.webview.postMessage({
                    type: 'userMessage',
                    content: msg.content
                });
            } else {
                this.panel.webview.postMessage({
                    type: 'assistantMessage',
                    content: msg.content
                });
            }
        });
    }

    private async handleMessage(message: any) {
        switch (message.type) {
            case 'sendMessage':
                await this.handleUserMessage(message.text, message.includeFile);
                break;
            case 'insertCode':
                await this.insertCodeToEditor(message.code);
                break;
            case 'modelChanged':
                this.selectedModel = message.model;
                console.log('Model changed to:', this.selectedModel);
                vscode.window.showInformationMessage(`Model switched to: ${this.selectedModel}`);
                break;
            case 'requestFileContext':
                this.sendFileContextToWebview();
                break;
            case 'removeFileContext':
                this.includeFileContext = false;
                // Update the webview to show no context
                this.panel.webview.postMessage({
                    type: 'fileContext',
                    fileInfo: null
                });
                break;
            case 'clearChat':
                console.log('Before clear:', this.conversationHistory.length, 'messages');
                this.conversationHistory = [];
                await this.saveConversationHistory();
                console.log('After clear:', this.conversationHistory.length, 'messages');
                const stored = this.context.globalState.get<Message[]>('conversationHistory');
                console.log('Storage now contains:', stored?.length || 0, 'messages');
                this.panel.webview.postMessage({
                    type: 'clearMessages'
                });
                vscode.window.showInformationMessage('Chat history cleared');
                break;
        }
    }

    private sendFileContextToWebview() {
        // Use lastActiveEditor instead of activeTextEditor
        const editor = this.lastActiveEditor;
        if (editor) {
            const document = editor.document;
            const fileName = document.fileName.split('/').pop() || 'Unknown';
            this.panel.webview.postMessage({
                type: 'fileContext',
                fileInfo: {
                    fileName: fileName,
                    fullPath: document.fileName,
                    language: document.languageId
                }
            });
            this.includeFileContext = true;
        } else {
            this.panel.webview.postMessage({
                type: 'fileContext',
                fileInfo: null
            });
            this.includeFileContext = false;
        }
    }

    private async handleUserMessage(userMessage: string, includeFile: boolean = true) {
        // Use lastActiveEditor instead of activeTextEditor
        const editor = this.lastActiveEditor;
        let contextMessage = userMessage;
        
        if (includeFile && this.includeFileContext && editor) {
            const document = editor.document;
            const fileName = document.fileName;
            const fileContent = document.getText();
            const selection = editor.selection;
            const selectedText = document.getText(selection);
            const language = document.languageId;
            
            let context = `[File Context]\n`;
            context += `File: ${fileName}\n`;
            context += `Language: ${language}\n`;
            
            if (selectedText && !selection.isEmpty) {
                context += `Selected Code:\n\`\`\`${language}\n${selectedText}\n\`\`\`\n`;
            } else if (fileContent.length < 10000) {
                context += `File Content:\n\`\`\`${language}\n${fileContent}\n\`\`\`\n`;
            } else {
                context += `(File is too large to include entirely)\n`;
            }
            
            context += `\nUser Question: ${userMessage}`;
            contextMessage = context;
        }
        
        this.conversationHistory.push({
            role: 'user',
            content: contextMessage,
            timestamp: new Date()
        });
        
        await this.saveConversationHistory();

        this.panel.webview.postMessage({
            type: 'userMessage',
            content: userMessage
        });

        this.panel.webview.postMessage({
            type: 'typing',
            isTyping: true
        });

        const response = await this.getLLMResponse(contextMessage);
        
        this.panel.webview.postMessage({
            type: 'typing',
            isTyping: false
        });
        
        this.conversationHistory.push({
            role: 'assistant',
            content: response,
            timestamp: new Date()
        });
        
        await this.saveConversationHistory();

        const codeBlocks = this.extractCodeBlocks(response);

        this.panel.webview.postMessage({
            type: 'assistantMessage',
            content: response,
            codeBlocks: codeBlocks
        });
    }

    private async getLLMResponse(prompt: string): Promise<string> {
        try {
            // Optional: Limit to last 3 messages to avoid token limits
            const recentMessages = this.conversationHistory.slice(-3);
            const messages = recentMessages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
            
            messages.push({
                role: 'user',
                content: prompt
            });

            const completion = await this.openai.chat.completions.create({
                model: this.selectedModel, // Use the selected model
                messages: messages
            });

            return completion.choices[0].message.content || "No response received";

        } catch (error) {
            console.error('LLM Error:', error);
            return `Error: Unable to get response from LLM. ${error}`;
        }
    }

    private extractCodeBlocks(text: string): Array<{language: string, code: string}> {
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        const codeBlocks: Array<{language: string, code: string}> = [];
        let match;

        while ((match = codeBlockRegex.exec(text)) !== null) {
            codeBlocks.push({
                language: match[1] || 'plaintext',
                code: match[2].trim()
            });
        }

        return codeBlocks;
    }

    private async insertCodeToEditor(code: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, code);
            });
        }
    }

    public getConversationHistory(): Message[] {
        return this.conversationHistory;
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Assistant</title>
    <style>
        * {
            box-sizing: border-box;
        }
        
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        #chat-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
        #model-selector {
            padding: 12px 16px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        #model-selector label {
            font-size: 12px;
            font-weight: 600;
            opacity: 0.8;
        }
        
        #model-select {
            flex: 1;
            padding: 6px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        
        #model-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        #context-section {
            padding: 12px 16px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        #context-label {
            font-size: 11px;
            font-weight: 600;
            opacity: 0.7;
            text-transform: uppercase;
        }
        
        .context-tag {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .context-tag-icon {
            font-size: 10px;
            opacity: 0.8;
        }
        
        .context-tag-name {
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .context-tag-remove {
            cursor: pointer;
            padding: 2px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s ease;
            opacity: 0.7;
        }
        
        .context-tag-remove:hover {
            background-color: rgba(255, 255, 255, 0.1);
            opacity: 1;
        }
        
        #no-context {
            font-size: 11px;
            opacity: 0.5;
            font-style: italic;
        }
        
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .message {
            max-width: 85%;
            padding: 12px 16px;
            border-radius: 8px;
            line-height: 1.6;
            animation: fadeIn 0.3s ease-in;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .user-message {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            align-self: flex-end;
            border-bottom-right-radius: 4px;
        }
        
        .assistant-message {
            background-color: var(--vscode-input-background);
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border-left: 3px solid var(--vscode-focusBorder);
        }
        
        .message-header {
            font-size: 11px;
            opacity: 0.7;
            margin-bottom: 8px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .typing-indicator {
            max-width: 85%;
            padding: 12px 16px;
            border-radius: 8px;
            background-color: var(--vscode-input-background);
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border-left: 3px solid var(--vscode-focusBorder);
            animation: fadeIn 0.3s ease-in;
        }
        
        .typing-dots {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        
        .typing-dots span {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--vscode-foreground);
            opacity: 0.4;
            animation: typing 1.4s infinite;
        }
        
        .typing-dots span:nth-child(1) {
            animation-delay: 0s;
        }
        
        .typing-dots span:nth-child(2) {
            animation-delay: 0.2s;
        }
        
        .typing-dots span:nth-child(3) {
            animation-delay: 0.4s;
        }
        
        @keyframes typing {
            0%, 60%, 100% {
                opacity: 0.4;
                transform: scale(1);
            }
            30% {
                opacity: 1;
                transform: scale(1.2);
            }
        }
        
        .code-block {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 16px;
            margin: 12px 0;
            border-radius: 6px;
            position: relative;
            border: 1px solid var(--vscode-panel-border);
        }
        
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .code-language {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            opacity: 0.7;
            letter-spacing: 0.5px;
        }
        
        .code-block pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Courier New', Consolas, monospace;
            font-size: 13px;
            line-height: 1.5;
        }
        
        .insert-button {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
            transition: all 0.2s ease;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .insert-button:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        
        .insert-button:active {
            transform: translateY(0);
        }
        
        #input-section {
            padding: 16px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        #input-wrapper {
            position: relative;
            display: flex;
            align-items: flex-end;
        }
        
        #user-input {
            flex: 1;
            padding: 10px 50px 10px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            resize: none;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            line-height: 1.5;
            transition: border-color 0.2s ease;
            max-height: 200px;
            min-height: 38px;
        }
        
        #user-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        #send-button {
            position: absolute;
            right: 8px;
            bottom: 8px;
            padding: 6px;
            background-color: transparent;
            color: var(--vscode-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.2s ease;
            width: 28px;
            height: 28px;
        }
        
        #send-button:hover:not(:disabled) {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        
        #send-button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        #send-button svg {
            width: 16px;
            height: 16px;
            fill: currentColor;
        }
        
        #button-row {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            justify-content: flex-end;
        }
        
        .action-button {
            padding: 4px 8px;
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s ease;
            opacity: 0.8;
        }
        
        .action-button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }
        
        strong {
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
        }
        
        em {
            font-style: italic;
            opacity: 0.9;
        }
        
        code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 3px 6px;
            border-radius: 3px;
            font-family: 'Courier New', Consolas, monospace;
            font-size: 0.9em;
            border: 1px solid var(--vscode-panel-border);
        }
        
        h3 {
            margin: 16px 0 8px 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        
        ul, ol {
            margin: 8px 0;
            padding-left: 24px;
        }
        
        li {
            margin: 4px 0;
            line-height: 1.6;
        }
        
        p {
            margin: 8px 0;
        }
        
        ::-webkit-scrollbar {
            width: 10px;
        }
        
        ::-webkit-scrollbar-track {
            background: var(--vscode-editor-background);
        }
        
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 5px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>
    <div id="chat-container">
        <div id="model-selector">
            <label for="model-select">Model:</label>
            <select id="model-select">
                <option value="openai/gpt-oss-20b:free" selected>GPT OSS 20B (Free)</option>
                <option value="meta-llama/llama-3.2-3b-instruct:free">Llama 3.2 3B (Free)</option>
                <option value="mistralai/mistral-7b-instruct:free">Mistral 7B (Free)</option>
            </select>
        </div>
        <div id="context-section">
            <span id="context-label">Context:</span>
            <div id="context-tags"></div>
            <span id="no-context">No file open</span>
        </div>
        <div id="messages"></div>
        <div id="input-section">
            <div id="input-wrapper">
                <textarea id="user-input" placeholder="Ask me anything..." rows="1"></textarea>
                <button id="send-button" title="Send message">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                        <path d="M2 2l12 6-12 6V9l8-3-8-3V2z"/>
                    </svg>
                </button>
            </div>
            <div id="button-row">
                <button id="clear-button" class="action-button">Clear Chat</button>
            </div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const messagesDiv = document.getElementById('messages');
        const userInput = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');
        const clearButton = document.getElementById('clear-button');
        const modelSelect = document.getElementById('model-select');
        const contextTags = document.getElementById('context-tags');
        const noContext = document.getElementById('no-context');
        let typingIndicatorElement = null;
        let currentFile = null;

        // Load saved model selection
        const savedState = vscode.getState();
        if (savedState && savedState.selectedModel) {
            modelSelect.value = savedState.selectedModel;
        }

        // Request current file context on load
        vscode.postMessage({ type: 'requestFileContext' });

        // Save model selection when changed
        modelSelect.addEventListener('change', () => {
            vscode.setState({ selectedModel: modelSelect.value });
            vscode.postMessage({
                type: 'modelChanged',
                model: modelSelect.value
            });
        });

        function updateContextDisplay(fileInfo) {
            if (fileInfo) {
                currentFile = fileInfo;
                noContext.style.display = 'none';
                
                const tag = document.createElement('div');
                tag.className = 'context-tag';
                tag.innerHTML = 
                    '<span class="context-tag-icon">📄</span>' +
                    '<span class="context-tag-name" title="' + fileInfo.fullPath + '">' + fileInfo.fileName + '</span>' +
                    '<span class="context-tag-remove" title="Remove from context">✕</span>';
                
                tag.querySelector('.context-tag-remove').addEventListener('click', () => {
                    currentFile = null;
                    contextTags.innerHTML = '';
                    noContext.style.display = 'inline';
                    vscode.postMessage({ type: 'removeFileContext' });
                });
                
                contextTags.innerHTML = '';
                contextTags.appendChild(tag);
            } else {
                currentFile = null;
                contextTags.innerHTML = '';
                noContext.style.display = 'inline';
            }
        }

        // Auto-resize textarea
        userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });

        function formatMarkdown(text) {
            text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
            text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            text = text.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
            text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            text = text.replace(/\\n\\n/g, '</p><p>');
            text = text.replace(/\\n/g, '<br>');
            text = '<p>' + text + '</p>';
            return text;
        }

        function showTypingIndicator(show) {
            if (show) {
                if (typingIndicatorElement) {
                    typingIndicatorElement.remove();
                }
                
                typingIndicatorElement = document.createElement('div');
                typingIndicatorElement.className = 'typing-indicator';
                typingIndicatorElement.innerHTML = 
                    '<div class="message-header">Working...</div>' +
                    '<div class="typing-dots">' +
                    '<span></span>' +
                    '<span></span>' +
                    '<span></span>' +
                    '</div>';
                
                messagesDiv.appendChild(typingIndicatorElement);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            } else {
                if (typingIndicatorElement) {
                    typingIndicatorElement.remove();
                    typingIndicatorElement = null;
                }
            }
        }

        function addMessage(content, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = isUser ? 'message user-message' : 'message assistant-message';
            
            if (!isUser) {
                const header = document.createElement('div');
                header.className = 'message-header';
                header.textContent = 'AI Assistant';
                messageDiv.appendChild(header);
            }
            
            let processedContent = content;
            const codeBlocks = [];
            let codeBlockIndex = 0;
            
            processedContent = processedContent.replace(/\`\`\`(\\w+)?\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
                const language = lang || 'code';
                const placeholder = '___CODE_BLOCK_' + codeBlockIndex + '___';
                codeBlocks.push({
                    placeholder: placeholder,
                    language: language,
                    code: code.trim()
                });
                codeBlockIndex++;
                return placeholder;
            });
            
            processedContent = formatMarkdown(processedContent);
            
            codeBlocks.forEach(block => {
                const codeHtml = '<div class="code-block">' +
                    '<div class="code-header">' +
                    '<span class="code-language">' + block.language + '</span>' +
                    '<button class="insert-button" data-code-index="' + codeBlocks.indexOf(block) + '">Insert Code</button>' +
                    '</div>' +
                    '<pre><code>' + escapeHtml(block.code) + '</code></pre>' +
                    '</div>';
                processedContent = processedContent.replace(block.placeholder, codeHtml);
            });
            
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = processedContent;
            messageDiv.appendChild(contentDiv);
            
            messagesDiv.appendChild(messageDiv);
            
            messageDiv.querySelectorAll('.insert-button').forEach(button => {
                button.addEventListener('click', function() {
                    const index = parseInt(this.getAttribute('data-code-index'));
                    insertCode(codeBlocks[index].code);
                    this.textContent = '✓ Inserted';
                    this.style.backgroundColor = 'var(--vscode-testing-iconPassed)';
                    setTimeout(() => {
                        this.textContent = 'Insert Code';
                        this.style.backgroundColor = '';
                    }, 2000);
                });
            });
            
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function insertCode(code) {
            vscode.postMessage({
                type: 'insertCode',
                code: code
            });
        }

        function sendMessage() {
            const text = userInput.value.trim();
            if (text) {
                sendButton.disabled = true;
                vscode.postMessage({
                    type: 'sendMessage',
                    text: text,
                    includeFile: currentFile !== null
                });
                userInput.value = '';
                userInput.style.height = 'auto';
            }
        }

        clearButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear the conversation history?')) {
                vscode.postMessage({
                    type: 'clearChat'
                });
            }
        });

        sendButton.addEventListener('click', sendMessage);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'userMessage') {
                addMessage(message.content, true);
            } else if (message.type === 'assistantMessage') {
                addMessage(message.content, false);
                sendButton.disabled = false;
            } else if (message.type === 'typing') {
                showTypingIndicator(message.isTyping);
            } else if (message.type === 'clearMessages') {
                messagesDiv.innerHTML = '';
            } else if (message.type === 'fileContext') {
                updateContextDisplay(message.fileInfo);
            }
        });
    </script>
</body>
</html>`;
    }

    private dispose() {
        ChatbotPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}