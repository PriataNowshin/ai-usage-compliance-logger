# Code Authorship Tracking System - Implementation Guide

## What Was Built

A comprehensive code authorship tracking system that:

1. **Monitors Git changes** - Listens for file saves and analyzes diffs
2. **Parses full conversation history** - No artificial limits or truncation
3. **Determines code origin** - LLM-generated, human-prompted, or human-written
4. **Inserts authorship tags** - Language-aware comments in source code
5. **Creates audit logs** - Structured JSON logs for compliance

## Quick Start

### 1. Open the AI Assistant
- Click "AI Assistant" in the VS Code status bar (bottom right)
- Start a conversation with the chatbot

### 2. Get Code from the Chatbot
```python
You: "Please write a function to calculate factorial"

ChatBot: 
def factorial(n):
    """Returns factorial of n."""
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

### 3. Use the Code in Your Files
- Copy the chatbot-generated code into your source files
- Save the file

### 4. Tags Are Inserted Automatically
The system will:
1. Detect the new code
2. Compare with conversation history
3. Determine authorship
4. Prompt you to insert tags
5. Add tags like this to your file:

```python
# [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=5
def factorial(n):
    """Returns factorial of n."""
    if n <= 1:
        return 1
    return n * factorial(n - 1)
```

### 5. Check the Logs
Look in `.authorship-logs/` directory for detailed JSON logs:
```json
{
  "filePath": "src/math.py",
  "functionName": "factorial",
  "detectedLabel": "LLM_GENERATED",
  "confidenceScore": 0.92,
  "reasoning": "Code first appeared in chatbot response (message 5)..."
}
```

## System Architecture

### 7 Core Modules

| Module | Purpose |
|--------|---------|
| **conversationParser.ts** | Extract code snippets from full conversation history |
| **diffParser.ts** | Parse git diffs and identify changed code blocks |
| **codeSimilarityMatcher.ts** | Multi-level code comparison (exact, fuzzy, structural) |
| **authorshipAttributor.ts** | Core logic: determine authorship via first appearance |
| **codeTagInserter.ts** | Insert language-aware tags into source code |
| **attributionLogger.ts** | Generate structured JSON audit logs |
| **gitChangeTracker.ts** | Orchestrate the pipeline and listen for save events |

### Attribution Pipeline

```
File Save Event
    ↓
Parse Full Conversation History
    ↓
Analyze Git Diff
    ↓
Extract Code Blocks
    ↓
Compare Each Block Against Conversation
    ↓
Determine First Appearance (Temporal Ordering)
    ↓
Assign Authorship Label & Confidence
    ↓
Insert Language-Aware Tags
    ↓
Create Structured Logs
    ↓
Display Results
```

## Authorship Labels

### LLM_GENERATED
- Code first appeared in chatbot response
- Not mentioned by user before
- Example confidence: 92%

### HUMAN_PROMPT_ORIGIN
- Code first appeared in user prompt
- User provided the concept/code
- Chatbot may have refined it
- Example confidence: 85%

### HUMAN_WRITTEN
- Code does not appear in conversation
- User wrote directly without chatbot help
- Example confidence: 95%

### MIXED
- Function contains both LLM-generated and human-written portions
- Example confidence: 78%

### UNCERTAIN
- Could not confidently determine origin
- Example confidence: 55%

## Similarity Matching (Multi-Level)

The system compares code at 5 levels:

1. **Exact Match** (100%)
   - Character-by-character identical

2. **Whitespace Match** (95%)
   - Same after removing extra spaces/formatting

3. **Normalized Match** (85%)
   - Same after replacing variable names, removing comments

4. **Fuzzy Match** (70%)
   - Line-by-line similarity with ~70%+ overlap

5. **Structural Match** (60%)
   - Same code patterns, control flow, operators

## Temporal Ordering: The Key

The system doesn't just ask "is similar code in the conversation?"

It asks: **"WHO INTRODUCED IT FIRST?"**

### Example

**Conversation Timeline:**
- Message 5 (User): "Here's my code: `x = 5`"
- Message 6 (Assistant): "To improve, try: `x = 5; print(x)`"
- Message 8 (User): "Let me write my own version"

**Commit Has:** `x = 5`

**Result:** 
- First appearance: Message 5 (User prompt)
- Label: **HUMAN_PROMPT_ORIGIN** (user introduced it first)
- Note: Even though chatbot repeated it in Message 6

## Log Files

### Location
```
.authorship-logs/
├── [commit-hash]_[timestamp].json    # Full analysis per commit
├── function-attributions.jsonl       # Per-function records
└── analysis-report.txt               # Human-readable summary
```

### JSON Log Example
```json
{
  "metadata": {
    "commitHash": "abc1234",
    "timestamp": "2026-03-23T10:30:00.000Z",
    "filesAnalyzed": ["src/utils.py"],
    "totalCodeBlocks": 3
  },
  "statistics": {
    "totalNewLines": 45,
    "llmGeneratedLines": 15,
    "humanPromptLines": 12,
    "humanWrittenLines": 18
  },
  "attributions": [...]
}
```

## Supported Languages

The system supports comment syntax for:

| Language | Comment |
|----------|---------|
| Python, Ruby, Bash, Shell | `#` |
| JavaScript, TypeScript, Java, C, C++, Go, Rust, PHP, etc. | `//` |
| SQL, Haskell, Lua | `--` |
| YAML, TOML | `#` |
| And more... |

## Common Workflows

### Workflow 1: Ask ChatBot, Copy Code

1. Ask chatbot to write function
2. Copy code into your file
3. Save file
4. System detects: **LLM_GENERATED** ✓ Confidence: 92%

### Workflow 2: Show ChatBot Your Code, Ask for Improvement

1. Paste your code in chat: "Here's my function, can you improve it?"
2. ChatBot refines it
3. Copy improved version to your file
4. Save file
5. System detects: **HUMAN_PROMPT_ORIGIN** ✓ Confidence: 88%

### Workflow 3: Manual Implementation

1. Discuss with ChatBot but don't copy
2. Write your own implementation
3. Save file
4. System detects: **HUMAN_WRITTEN** ✓ Confidence: 95%

### Workflow 4: Mixed Authorship

1. ChatBot writes `calculate()` function
2. You add error handling
3. Save file
4. System detects: **MIXED** ✓ Function has both parts

## Troubleshooting

### Q: Tags not showing up?
**A:** 
- Make sure chatbot is open with conversation history
- Verify file is in a git repository
- File must have at least one git commit

### Q: Low confidence scores?
**A:**
- Code may be heavily refactored from original
- Variable names changed significantly
- Try exact copy first to test (should be 100%)

### Q: How to review attributions?
**A:**
- Check `.authorship-logs/` directory
- Open JSON file to see detailed evidence
- Look for "similarityMatches" for detailed match info

### Q: Can I disable tagging?
**A:**
- Yes, in the extension settings (future enhancement)
- Or modify gitChangeTracker.ts config

### Q: How is confidence calculated?
**A:**
- Based on similarity match quality (0-100)
- Exact/Whitespace matches: +0.4 to confidence
- Fuzzy matches: +0.1 to +0.2
- Multiple matches reduce confidence (ambiguous)

## Advanced Features

### Remove Tags
If you need to clean up all tags from a file:
```typescript
const tagInserter = new CodeTagInserter();
await tagInserter.removeAllTags(document);
```

### Export to CSV
Generate spreadsheet-friendly logs:
```typescript
const csv = logger.exportToCSV(attributions);
// Save to file or import into Excel/Sheets
```

### Custom Configuration
```typescript
gitChangeTracker.setConfig({
  minSimilarityThreshold: 80,      // More strict matching
  fuzzyMatchThreshold: 65,         // Allow more fuzzy matches
  insertTags: false,               // Just log, don't tag
  createLogs: true
});
```

## Example Output

### Source Code (After Tagging)
```typescript
// [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=12
async function fetchUserData(userId: string): Promise<User> {
  const response = await fetch(`/api/users/${userId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.statusText}`);
  }
  return response.json();
}

// [AUTHORSHIP: HUMAN_WRITTEN] | confidence=95% | timestamp=2026-03-23 | origin=unknown | msg_index=none
function validateUserId(id: string): boolean {
  return /^[0-9a-f]{24}$/.test(id); // MongoDB ObjectId format
}
```

### Console Output
```
[AuthorshipTracker] Analyzing changes in: src/api.ts
[AuthorshipTracker] Step 1: Parsing conversation history...
  ✓ Found 28 messages with 42 code snippets
[AuthorshipTracker] Step 2: Analyzing git diff...
  ✓ Found 2 code block(s) with changes
[AuthorshipTracker] Step 3: Attributing code authorship...
  ✓ Results: 1 LLM, 0 Human-Prompted, 1 Human-Written
  ✓ Average Confidence: 93.5%
[AuthorshipTracker] Step 4: Generating authorship tags...
[AuthorshipTracker] Step 5: Creating structured logs...
  ✓ Log created at: .authorship-logs/abc1234_1711270200.json
[AuthorshipTracker] Analysis complete! ✓
```

## Why This Matters

✅ **Compliance & Audit Trail** - Document code origins for regulatory requirements
✅ **Transparency** - Know exactly what's LLM vs human-written
✅ **Code Review** - Faster review when origin is visible
✅ **Training** - Learn from which patterns come from LLM
✅ **Risk Assessment** - Identify heavy reliance on LLM-generated code
✅ **Quality Metrics** - Track human vs AI contribution over time

## Next Steps

1. **Start using the system** - Save a file and watch the pipeline
2. **Review the logs** - Check `.authorship-logs/` for detailed JSON
3. **Customize configuration** - Adjust thresholds if needed (in gitChangeTracker.ts)
4. **Integrate with your workflow** - Add to git hooks or CI/CD pipeline

## For More Information

See **ARCHITECTURE.md** for:
- Detailed module documentation
- Attribution algorithm deep dive
- Multi-level similarity matching explained
- Extending the system
- Future enhancements

---

**Version:** 1.0.0  
**Last Updated:** March 23, 2026  
**Status:** Production Ready
