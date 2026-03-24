# Code Authorship Tracking System - Architecture & Design

## Overview

This system monitors every new commit or push in a repository, inspects the newly added code, compares it against the **entire chatbot conversation history** (without artificial limits), and determines whether the new code was introduced by:

1. **The chatbot first** (LLM_GENERATED)
2. **The human first inside the prompt** (HUMAN_PROMPT_ORIGIN)
3. **The human directly without it appearing in chatbot output** (HUMAN_WRITTEN)

After detecting authorship, the system automatically inserts tags before each function and creates structured logs for full audit trail.

---

## System Architecture

### High-Level Flow

```
Code Save Event
    ↓
[Parse Conversation] → Full history with code snippets
    ↓
[Analyze Git Diff] → Extract changed functions/blocks
    ↓
[Attribute Authorship] → Determine origin via temporal ordering
    ↓
[Insert Tags] → Add language-aware comments to source
    ↓
[Create Logs] → JSON audit trail for compliance
```

### Module Structure

#### 1. **types.ts** - Core Type Definitions
- `AuthorshipLabel` enum (LLM_GENERATED, HUMAN_PROMPT_ORIGIN, HUMAN_WRITTEN, MIXED, UNCERTAIN)
- `ConversationMessage` - Parsed chat message with metadata
- `CodeSnippet` - Extracted code from conversation
- `DiffHunk` - Git diff hunk representation
- `CodeBlock` - Logical code unit (function level)
- `AttributionResult` - Complete attribution with evidence
- `AuthorshipTag` - Tag to be inserted into source
- `CommitAnalysisResult` - Complete analysis for a commit

#### 2. **conversationParser.ts** - Full Conversation History Analysis
**Purpose:** Extract and index ALL code snippets from the complete conversation history

**Key Methods:**
- `parseConversation()` - Parse full message history
- `extractCodeSnippets()` - Extract code from ALL messages (no limits)
- `getUserPrompts()` / `getAssistantResponses()` - Filter by role
- `getSnippetsInOrder()` - Get snippets in temporal sequence
- `findFirstAppearance()` - Locate when code first appeared

**Features:**
- Extracts code blocks (triple backticks)
- Extracts inline code patterns
- Extracts function/class definitions
- Extracts import statements
- Extracts context code (user showing their file)

#### 3. **diffParser.ts** - Git Diff Analysis
**Purpose:** Parse git diffs and extract newly added/modified code blocks

**Key Methods:**
- `parseDiff()` - Parse unified diff format into hunks
- `extractCodeBlocks()` - Group hunks into logical code blocks
- `findContainingFunction()` - Identify function boundary
- `getAddedCode()` - Extract only newly added lines

**Features:**
- Handles function-level detection
- Preserves line number mapping
- Detects language from file extension
- Groups related changes into logical blocks

#### 4. **codeSimilarityMatcher.ts** - Multi-Level Code Comparison
**Purpose:** Compare code with multiple similarity levels to find matches

**Comparison Levels:**
1. **Exact Match (100%)** - Character-by-character identical
2. **Whitespace Match (95%)** - Same after normalizing formatting
3. **Normalized Match (85%)** - After normalizing syntax (var names, comments)
4. **Fuzzy Match (70%)** - Line-by-line similarity with tolerance
5. **Structural Match (60%)** - Same code patterns and logic flow

**Key Methods:**
- `compareCodes()` - Multi-level comparison returning match type + score
- `findSimilarCode()` - Find all matches in snippet list
- `areLinesSimilar()` - Line-level fuzzy comparison
- `calculateStructuralSimilarity()` - AST-like comparison

#### 5. **authorshipAttributor.ts** - Attribution Engine (Core Logic)
**Purpose:** Determine code authorship based on first appearance in conversation

**Attribution Logic (Temporal Ordering):**
```
For each code block:
  1. Search full conversation for similar code
  2. Find FIRST appearance (earliest message)
  3. Check who introduced it:
     - User prompt → HUMAN_PROMPT_ORIGIN
     - Chatbot response → LLM_GENERATED (unless user had it first)
     - Not in conversation → HUMAN_WRITTEN
  4. Calculate confidence (0-1) based on match quality
  5. Attach evidence and reasoning
```

**Key Methods:**
- `attributeCodeBlock()` - Main attribution logic
- `attributeCodeBlocks()` - Batch processing
- `detectMixedAuthorship()` - Identify mixed code
- `getSummary()` - Generate statistics

**Evidence Tracking:**
- Message index where code first appeared
- Similarity match details
- Confidence score calculation
- Full reasoning explanation

#### 6. **codeTagInserter.ts** - Language-Aware Tagging
**Purpose:** Insert authorship tags into source code with correct comment syntax

**Language Support:**
- Python: `#`
- JavaScript/TypeScript: `//`
- Java/C/C++/C#: `//`
- Ruby/Shell/Bash: `#`
- SQL: `--`
- And more...

**Key Methods:**
- `generateTags()` - Create tags from attributions
- `insertTagsIntoDocument()` - Add tags to file
- `removeAllTags()` - Clean up existing tags
- `parseTag()` - Extract metadata from tag

**Tag Format:**
```
// [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=15
```

#### 7. **attributionLogger.ts** - Structured Audit Logging
**Purpose:** Create JSON logs for full traceability and compliance

**Log Outputs:**
- **JSON Log Files** - Complete analysis per commit
- **JSONL Logs** - Per-function attribution records
- **Human-Readable Reports** - Summary statistics
- **CSV Export** - For spreadsheet analysis

**Logged Information:**
- Commit hash and timestamp
- File path and function name
- Line number ranges
- Authorship label and confidence
- Matching conversation segment
- First appearance details
- Similarity matching evidence
- Detailed reasoning

#### 8. **gitChangeTracker.ts** - Orchestrator & Event Handler
**Purpose:** Listen for file save events and run the attribution pipeline

**Pipeline Execution:**
1. Listen for `onDidSaveTextDocument` events
2. Get previous version from git
3. Compare with current version
4. Parse full conversation history
5. Extract code blocks from diff
6. Run attribution on each block
7. Prompt user to insert tags
8. Create structured logs
9. Display results

**Configuration:**
```typescript
minSimilarityThreshold: 75     // % for match consideration
fuzzyMatchThreshold: 60        // % for fuzzy matching
analyzeFullConversation: true  // Use entire history
insertTags: true               // Add tags to source
createLogs: true               // Generate JSON logs
```

---

## Attribution Pipeline - Step by Step

### Example Scenario

**Conversation:**
```
[Message 0 - User]: "Please write a function to add two numbers"

[Message 1 - Assistant]:
  def add(a, b):
      return a + b

[Message 3 - User]: "Now let me write subtract myself"

[Message 4 - User Code in File]:
  def subtract(a, b):
      return a - b

[Message 5 - User]: "Can you improve the add function?"

[Message 6 - Assistant]:
  def add(a, b):
      """Adds two numbers."""
      return a + b
```

**New Commit - Changes:**
1. `add()` function - improved version
2. `subtract()` function - user's original
3. `multiply()` function - completely new

**Attribution Results:**

| Function | First Appearance | Source Role | Label | Confidence |
|----------|------------------|-------------|-------|------------|
| add() | Msg 1 | assistant | LLM_GENERATED | 92% |
| subtract() | Msg 4 | user | HUMAN_PROMPT_ORIGIN | 85% |
| multiply() | Not found | - | HUMAN_WRITTEN | 95% |

---

## Similarity Matching Algorithm

### Level-by-Level Comparison

**Level 1: Exact Match**
```typescript
if (code1 === code2) → 100% match
```

**Level 2: Whitespace Normalization**
```typescript
normalize(code1) === normalize(code2)
- Remove extra spaces
- Remove formatting
→ 95% match if equal
```

**Level 3: Syntax Normalization**
```typescript
normalize_syntax(code1) === normalize_syntax(code2)
- Replace variable names with VAR
- Remove comments
- Normalize string literals
→ 85% match if equal
```

**Level 4: Fuzzy Line Matching**
```
For each line in code1:
  If similar to corresponding line in code2:
    matches++
percentage = matches / total_lines
→ Score between 60-80%
```

**Level 5: Structural Similarity**
```
Compare:
- Control flow structures (if, for, while, etc.)
- Operator density
- Line count
- Code patterns
→ Score between 40-70%
```

---

## Temporal Ordering: The Key to Accurate Attribution

The system tracks **WHEN** code first appeared in the conversation:

1. **User Mentions Code First** (in a prompt)
   - Even if chatbot repeats/refines it
   - Labeled: HUMAN_PROMPT_ORIGIN
   - Confidence: Higher

2. **Chatbot Generates Code First** (in response)
   - Not mentioned by user before
   - Labeled: LLM_GENERATED
   - Confidence: Based on match quality

3. **Code Never in Conversation** (not found)
   - Human wrote directly without asking
   - Labeled: HUMAN_WRITTEN
   - Confidence: Very high (95%+)

**Important:** The system does NOT just check "is code similar" - it checks "WHO INTRODUCED IT FIRST."

---

## Tag Format & Insertion

### Generated Tags

**Format:**
```
[AUTHORSHIP: <LABEL>] | confidence=<PCT>% | timestamp=<DATE> | origin=<ROLE> | msg_index=<NUM>
```

**Example:**
```python
# [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=5
def add(a, b):
    """Adds two numbers."""
    return a + b
```

**Languages Supported:**
- Python, JavaScript, TypeScript, Java, C, C++, C#, Go, Rust, Ruby, PHP, SQL, Haskell, Lua, Bash, Shell, YAML, TOML

### Insertion Process

1. Detect language from file extension
2. Use correct comment syntax for language
3. Match indentation of target line
4. Insert tag directly before function definition
5. Preserve original formatting
6. Handle nested functions correctly

---

## Structured Logging

### JSON Log Structure

**File:** `.authorship-logs/[commit-hash]_[timestamp].json`

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
    "analyzedLines": 42,
    "llmGeneratedLines": 15,
    "humanPromptLines": 12,
    "humanWrittenLines": 15,
    "mixedLines": 0,
    "uncertainLines": 0
  },
  "attributions": [
    {
      "commitHash": "abc1234",
      "timestamp": "2026-03-23T10:30:00.000Z",
      "filePath": "src/utils.py",
      "functionName": "add",
      "codeBlockLineRange": "10-15",
      "detectedLabel": "LLM_GENERATED",
      "confidenceScore": 0.92,
      "matchingConversationSegment": {
        "messageIndex": 5,
        "messageRole": "assistant",
        "timestamp": "2026-03-20T14:05:30.000Z",
        "snippet": "def add(a, b):\n    return a + b"
      },
      "firstMatchSource": "chatbot_response",
      "reasoning": "Code first appeared in chatbot response...",
      "similarityMatches": [
        {
          "type": "exact",
          "score": 95,
          "messageIndex": 5
        }
      ]
    }
  ],
  "tags": [...]
}
```

### Per-Function JSONL Log

**File:** `.authorship-logs/function-attributions.jsonl`

Each line is a JSON record for one function attribution. Useful for streaming/real-time analysis.

### Reports

**Human-Readable Report:**
- Summary statistics
- Per-function details
- Confidence metrics
- Source attribution breakdown

**CSV Export:**
- Import into spreadsheets
- File path, function name, label, confidence
- Useful for bulk analysis

---

## Configuration & Customization

### Configuration Options

```typescript
const config: AuthorshipConfig = {
  minSimilarityThreshold: 75,      // Don't match below 75%
  fuzzyMatchThreshold: 60,          // Fuzzy match minimum
  analyzeFullConversation: true,    // Use entire history
  insertTags: true,                 // Add tags to source
  createLogs: true,                 // Generate JSON logs
  logOutputPath: '.authorship-logs', // Custom log directory
  languageCommentMap: {             // Custom comment syntax
    'custom-lang': '//'
  }
};

gitChangeTracker.setConfig(config);
```

### Extending the System

1. **Add Language Support:**
   - Update `codeTagInserter.ts` `getCommentPrefix()` function
   - Add lang → comment syntax mapping

2. **Custom Similarity Matching:**
   - Extend `CodeSimilarityMatcher` with new algorithms
   - Implement specialized matchers for specific languages

3. **Custom Logging:**
   - Extend `AttributionLogger` with custom log formats
   - Send logs to external services (S3, database, etc.)

4. **Custom Attribution Rules:**
   - Extend `AuthorshipAttributor` with domain-specific logic
   - Add pattern recognition for specific code styles

---

## Usage Quick Start

### Basic Workflow

1. **Open the AI Assistant**
   - Click "AI Assistant" in bottom right status bar
   - Or press the keyboard shortcut

2. **Have a Conversation**
   - Ask chatbot to generate code
   - Show your own code for improvement
   - Get code suggestions

3. **Edit Your Files**
   - Copy/modify code from chatbot
   - Write your own code
   - Save the file

4. **Tags are Inserted Automatically**
   - System analyzes changes
   - Compares with conversation history
   - Prompts to insert tags
   - Tags appear in source code

5. **Review Logs**
   - Check `.authorship-logs` directory
   - View JSON analysis files
   - Generate reports for compliance

---

## Key Benefits

✅ **Complete Traceability** - Know exactly where every line came from
✅ **No Data Loss** - Uses entire conversation history (no truncation)
✅ **Accurate Attribution** - Temporal ordering ensures correct origin
✅ **Audit Ready** - JSON logs meet compliance requirements
✅ **Language Agnostic** - Works with any programming language
✅ **Confidence Scoring** - Indicates certainty of attribution
✅ **Mixed Detection** - Identifies functions with both LLM and human code
✅ **Easy Review** - Tags in source make origin visible at a glance

---

## Limitations & Future Improvements

### Current Limitations

- Simple diff-based analysis (could add semantic analysis)
- Fuzzy matching has 70% threshold (configurable)
- Doesn't track code modifications post-commit
- Line mapping preserved but block-level primarily

### Future Enhancements

- [ ] AST-based structural analysis for better accuracy
- [ ] Machine learning model for authorship detection
- [ ] Git hook integration for automatic analysis on push
- [ ] Web dashboard for log visualization
- [ ] Integration with code review platforms
- [ ] Semantic analysis for refactored code
- [ ] Multi-language AST support
- [ ] Performance optimization for large repos

---

## Example Output

### Source Code with Tags
```python
// [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=12
def calculate_average(numbers):
    """Calculates the average of a list of numbers."""
    if not numbers:
        return 0
    return sum(numbers) / len(numbers)

// [AUTHORSHIP: HUMAN_WRITTEN] | confidence=95% | timestamp=2026-03-23 | origin=unknown | msg_index=none
def validate_input(data):
    """Custom validation logic written by developer."""
    return isinstance(data, list) and all(isinstance(n, (int, float)) for n in data)

// [AUTHORSHIP: HUMAN_PROMPT_ORIGIN] | confidence=85% | timestamp=2026-03-23 | origin=user | msg_index=8
def format_result(value, decimals=2):
    """Formats number to specified decimal places."""
    return round(value, decimals)
```

### JSON Log Entry
```json
{
  "filePath": "src/math_utils.py",
  "functionName": "calculate_average",
  "codeBlockLineRange": "1-6",
  "detectedLabel": "LLM_GENERATED",
  "confidenceScore": 0.92,
  "firstMatchSource": "chatbot_response",
  "reasoning": "Code first appeared in chatbot response (message 12) as exact match. No prior user mention detected.",
  "similarityMatches": [
    {
      "type": "exact",
      "score": 100,
      "messageIndex": 12
    }
  ]
}
```

---

## Troubleshooting

### Tags Not Being Inserted
- Check if chatbot is open and has conversation history
- Verify file is in a git repository
- Check git has at least one commit

### Low Confidence Scores
- Code might be heavily refactored (use fuzzy matching)
- Variable names changed significantly
- Comments or formatting altered significantly
- Consider threshold settings in config

### Logs Not Created
- Check `.authorship-logs` directory exists and is writable
- Verify `createLogs: true` in configuration
- Check file system permissions

### Incorrect Attribution
- Review the conversation history
- Check if code appeared in multiple messages
- Verify first appearance was correctly identified
- Manual review recommended for critical code

---

## Developer Notes

### Module Dependencies

```
extension.ts
    ↓
gitChangeTracker.ts (orchestrator)
    ├─→ conversationParser.ts
    ├─→ diffParser.ts
    ├─→ authorshipAttributor.ts
    │   ├─→ codeSimilarityMatcher.ts
    │   └─→ [uses all types]
    ├─→ codeTagInserter.ts
    └─→ attributionLogger.ts
```

### Testing the System

1. Create a test file with some code
2. Modify it and save
3. Check console for pipeline logs
4. Review generated tags and logs
5. Inspect `.authorship-logs` for JSON output

---

**System Version:** 1.0.0
**Last Updated:** March 23, 2026
**Maintained By:** AI Usage Compliance Team
