# System Architecture Diagram

## High-Level Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CODE AUTHORSHIP TRACKING SYSTEM                  │
│                                                                          │
│  A comprehensive system to determine if code was written by:            │
│  - The AI Chatbot (LLM_GENERATED)                                       │
│  - The Human in a prompt (HUMAN_PROMPT_ORIGIN)                          │
│  - The Human directly (HUMAN_WRITTEN)                                   │
│  - A mix of both (MIXED)                                                │
│  - Unknown (UNCERTAIN)                                                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           EVENT TRIGGERS                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User saves a file in VS Code                                           │
│           ↓                                                              │
│  onDidSaveTextDocument event fires                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     STEP 1: PARSE CONVERSATION                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ConversationParser Module                                              │
│                                                                          │
│  INPUT: Full conversation history from ChatbotPanel                     │
│  (No artificial limits or truncation)                                   │
│                                                                          │
│  PROCESS:                                                               │
│    └─ Extract code snippets from ALL messages                           │
│    └─ Parse code blocks (``` ``` format)                               │
│    └─ Extract inline code patterns                                      │
│    └─ Extract function/class definitions                                │
│    └─ Extract import statements                                         │
│    └─ Extract context code from user prompts                            │
│    └─ Index by message index and role                                   │
│                                                                          │
│  OUTPUT: ParsedConversation object containing:                          │
│    └─ All messages with timestamps                                      │
│    └─ All code snippets with source info                                │
│    └─ Conversation metadata                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      STEP 2: ANALYZE GIT DIFF                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DiffParser Module                                                      │
│                                                                          │
│  INPUT: File changes (old vs new content)                               │
│         Get old version from git using repo.show('HEAD', filepath)      │
│                                                                          │
│  PROCESS:                                                               │
│    └─ Calculate unified diff                                            │
│    └─ Parse diff hunks (lines with @ markers)                           │
│    └─ Identify added/modified lines                                     │
│    └─ Extract code blocks from hunks                                    │
│    └─ Identify function boundaries                                      │
│    └─ Detect programming language                                       │
│    └─ Map changes to specific functions                                 │
│                                                                          │
│  OUTPUT: CodeBlock[] array containing:                                  │
│    └─ Function name                                                     │
│    └─ File path                                                         │
│    └─ Line ranges (start-end)                                           │
│    └─ Code content                                                      │
│    └─ Whether new or modified                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                  STEP 3: MATCH & ATTRIBUTE (CORE LOGIC)                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AuthorshipAttributor + CodeSimilarityMatcher Modules                   │
│                                                                          │
│  FOR EACH code block:                                                   │
│                                                                          │
│    ┌─────────────────────────────────────────────────────┐             │
│    │ PHASE 1: FIND ALL MATCHES IN CONVERSATION           │             │
│    ├─────────────────────────────────────────────────────┤             │
│    │                                                      │             │
│    │ CodeSimilarityMatcher performs 5-level matching:     │             │
│    │                                                      │             │
│    │ Level 1: EXACT MATCH                               │             │
│    │  • Code identical character-by-character            │             │
│    │  • Score: 100%                                      │             │
│    │                                                      │             │
│    │ Level 2: WHITESPACE NORMALIZATION                  │             │
│    │  • Same after removing formatting                   │             │
│    │  • Score: 95%                                       │             │
│    │                                                      │             │
│    │ Level 3: SYNTAX NORMALIZATION                      │             │
│    │  • Same after normalizing var names, comments       │             │
│    │  • Score: 85%                                       │             │
│    │                                                      │             │
│    │ Level 4: FUZZY LINE MATCHING                       │             │
│    │  • 70%+ of lines match                              │             │
│    │  • Score: 70-80%                                    │             │
│    │                                                      │             │
│    │ Level 5: STRUCTURAL SIMILARITY                     │             │
│    │  • Same control flow, operators, patterns           │             │
│    │  • Score: 60-70%                                    │             │
│    │                                                      │             │
│    └─ RESULT: All matches sorted by score ────────────────┘             │
│                                                                          │
│    ┌─────────────────────────────────────────────────────┐             │
│    │ PHASE 2: DETERMINE FIRST APPEARANCE (TEMPORAL)      │             │
│    ├─────────────────────────────────────────────────────┤             │
│    │                                                      │             │
│    │ KEY PRINCIPLE: "WHO INTRODUCED IT FIRST?"           │             │
│    │                                                      │             │
│    │ Find the EARLIEST message where code appeared       │             │
│    │ (sorted by message index, not match quality)        │             │
│    │                                                      │             │
│    │ Check if first appearance was:                      │             │
│    │  ├─ User prompt message? → HUMAN_PROMPT_ORIGIN     │             │
│    │  ├─ Chatbot response? → Check if user showed first │             │
│    │  │   ├─ Yes → HUMAN_PROMPT_ORIGIN                  │             │
│    │  │   └─ No → LLM_GENERATED                         │             │
│    │  └─ Not found → HUMAN_WRITTEN                      │             │
│    │                                                      │             │
│    └─────────────────────────────────────────────────────┘             │
│                                                                          │
│    ┌─────────────────────────────────────────────────────┐             │
│    │ PHASE 3: CALCULATE CONFIDENCE & BUILD EVIDENCE      │             │
│    ├─────────────────────────────────────────────────────┤             │
│    │                                                      │             │
│    │ Confidence factors:                                  │             │
│    │  • Match quality score (0-100%)                     │             │
│    │  • Match type (exact > whitespace > fuzzy)          │             │
│    │  • Number of matching messages (more = less sure)   │             │
│    │  • Temporal clarity (clear > ambiguous)             │             │
│    │                                                      │             │
│    │ Build ProvenanceEvidence object:                    │             │
│    │  ├─ First source message info                       │             │
│    │  ├─ All similarity matches                          │             │
│    │  ├─ Confidence score (0-1)                          │             │
│    │  └─ Reasoning explanation                           │             │
│    │                                                      │             │
│    └─────────────────────────────────────────────────────┘             │
│                                                                          │
│  OUTPUT: AttributionResult[] containing:                                │
│    └─ Label (LLM_GENERATED/HUMAN_PROMPT_ORIGIN/etc)                    │
│    └─ Confidence (0-1)                                                  │
│    └─ Evidence & reasoning                                              │
│    └─ First appearance details                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    STEP 4: GENERATE & INSERT TAGS                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CodeTagInserter Module                                                 │
│                                                                          │
│  PROCESS:                                                               │
│    ├─ Detect language from file extension                               │
│    ├─ Get correct comment syntax (Python: #, JS: //, etc)              │
│    ├─ Generate tag text:                                                │
│    │  └─ [AUTHORSHIP: <LABEL>]                                         │
│    │  └─ confidence=<PCT>%                                              │
│    │  └─ timestamp=<DATE>                                               │
│    │  └─ origin=<ROLE> (user/assistant)                                 │
│    │  └─ msg_index=<NUM>                                                │
│    ├─ Present to user: "Insert X tags? Yes/No"                          │
│    └─ Insert before each function definition                            │
│                                                                          │
│  EXAMPLE OUTPUT:                                                        │
│  ┌────────────────────────────────────────────────────────┐            │
│  │ // [AUTHORSHIP: LLM_GENERATED] | confidence=92% |      │            │
│  │ //   timestamp=2026-03-23 | origin=assistant |         │            │
│  │ //   msg_index=5                                       │            │
│  │ function calculateAverage(numbers) {                  │            │
│  │   return numbers.reduce((a,b) => a+b, 0) /            │            │
│  │          numbers.length;                               │            │
│  │ }                                                       │            │
│  └────────────────────────────────────────────────────────┘            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     STEP 5: CREATE AUDIT LOGS                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AttributionLogger Module                                               │
│                                                                          │
│  OUTPUTS:                                                               │
│                                                                          │
│  1. JSON Log (.authorship-logs/[hash]_[timestamp].json)                │
│     ├─ Metadata (commit, timestamp, files)                              │
│     ├─ Statistics (total lines, breakdown by label)                     │
│     └─ Detailed attributions array                                      │
│                                                                          │
│  2. JSONL Log (.authorship-logs/function-attributions.jsonl)           │
│     └─ One JSON line per function                                       │
│                                                                          │
│  3. Human-Readable Report                                               │
│     ├─ Summary statistics                                               │
│     ├─ Per-function details                                             │
│     └─ Confidence metrics                                               │
│                                                                          │
│  4. CSV Export (optional)                                               │
│     └─ File, function, label, confidence                                │
│     └─ Import into Excel/Sheets                                         │
│                                                                          │
│  EXAMPLE LOG ENTRY:                                                    │
│  ┌────────────────────────────────────────────────────────┐            │
│  │ {                                                      │            │
│  │   "filePath": "src/math.py",                           │            │
│  │   "functionName": "factorial",                         │            │
│  │   "codeBlockLineRange": "10-15",                       │            │
│  │   "detectedLabel": "LLM_GENERATED",                    │            │
│  │   "confidenceScore": 0.92,                             │            │
│  │   "firstMatchSource": "chatbot_response",              │            │
│  │   "reasoning": "Code first appeared in chatbot...",    │            │
│  │   "similarityMatches": [                               │            │
│  │     {                                                   │            │
│  │       "type": "exact",                                 │            │
│  │       "score": 100,                                    │            │
│  │       "messageIndex": 5                                │            │
│  │     }                                                   │            │
│  │   ]                                                     │            │
│  │ }                                                       │            │
│  └────────────────────────────────────────────────────────┘            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Module Dependency Graph

```
┌──────────────┐
│  extension   │  ← Entry point
└──────────────┘
       ↓
┌──────────────────────────┐
│  gitChangeTracker        │  ← Orchestrator
│  (Refactored)            │
└──────────────────────────┘
   ↙    ↓      ↘    ↙      ↘
┌─────────┬──────────┬─────────────┬──────────┬────────────┐
│         │          │             │          │            │
↓         ↓          ↓             ↓          ↓            ↓
types   conversation diffParser  similarity attributor   tagInserter
.ts     Parser.ts     .ts         Matcher.ts .ts         .ts
                                              ↓
                                          logger.ts
```

## Data Flow

```
ChatbotPanel                          FileSystem
(Conversation)                        (Git Repository)
    ↓                                      ↓
    └─────────────────┬────────────────────┘
                      ↓
            [INPUT: User Saves File]
                      ↓
    ┌─────────────────┴────────────────────┐
    ↓                                       ↓
Parse Conversation                   Parse Git Diff
    ↓                                       ↓
[ParsedConversation]                [CodeBlock[]]
    ↓                                       ↓
[CodeSnippet[]]                     [DiffHunk[]]
    ↓                                       ↓
[Indexed by message]                [Indexed by file]
    ↓                                       ↓
    └─────────────────┬─────────────────────┘
                      ↓
        [Match & Attribute Code]
                      ↓
        [CodeSimilarityMatcher]
        [AuthorshipAttributor]
                      ↓
        [AttributionResult[]]
        (with labels, confidence,
         evidence, reasoning)
                      ↓
        ┌─────────────┴──────────────┐
        ↓                            ↓
    Insert Tags              Create Audit Logs
        ↓                            ↓
    [Source Code]            [JSON Files]
    (with comments)          [CSV Export]
        ↓                            ↓
    FileSystem              .authorship-logs/
```

## Authorship Attribution Tree

```
Code Found in Conversation?
         │
         ├─ NO
         │   └─ HUMAN_WRITTEN (95%+ confidence)
         │
         └─ YES
              └─ Who introduced it first?
                   │
                   ├─ USER (in prompt)
                   │   └─ HUMAN_PROMPT_ORIGIN (80-95%)
                   │       (Even if ChatBot refined it later)
                   │
                   └─ ASSISTANT (in response)
                        └─ Was user shown code before?
                             │
                             ├─ YES
                             │   └─ HUMAN_PROMPT_ORIGIN
                             │       (User introduced concept first)
                             │
                             └─ NO
                                 └─ LLM_GENERATED (85-100%)
                                     (ChatBot genuinely generated it)
```

## Similarity Matching Decision Tree

```
Compare Code?
     │
     ├─ Exact match?
     │  └─ YES → 100% (exact)
     │
     ├─ Whitespace normalized?
     │  └─ YES → 95% (whitespace)
     │
     ├─ Syntax normalized?
     │  (var names, comments)
     │  └─ YES → 85% (normalized)
     │
     ├─ Fuzzy line match?
     │  (70%+ of lines match)
     │  └─ YES → 70-80% (fuzzy)
     │
     ├─ Structural similarity?
     │  (same flow, operators)
     │  └─ YES → 60-70% (structural)
     │
     └─ NO MATCH → 0%
```

## Configuration & Module Lifecycle

```
VS Code Extension Activation
         │
         ├── Load ChatbotPanel
         │   └─ Restore conversation history
         │
         ├── Create GitChangeTracker
         │   ├─ Initialize modules:
         │   │  ├─ ConversationParser
         │   │  ├─ DiffParser
         │   │  ├─ CodeSimilarityMatcher
         │   │  ├─ AuthorshipAttributor
         │   │  ├─ CodeTagInserter
         │   │  └─ AttributionLogger
         │   │
         │   ├─ Load configuration
         │   │  ├─ minSimilarityThreshold: 75
         │   │  ├─ fuzzyMatchThreshold: 60
         │   │  ├─ analyzeFullConversation: true
         │   │  ├─ insertTags: true
         │   │  └─ createLogs: true
         │   │
         │   └─ Setup file save listener
         │       └─ Listen for onDidSaveTextDocument
         │
         └─ Ready to analyze
```

## Summary

This architecture provides:

✅ **Completeness** - Full conversation history, no artificial limits
✅ **Accuracy** - 5-level matching + temporal ordering
✅ **Transparency** - Clear evidence for every attribution
✅ **Auditability** - Structured JSON logs for compliance
✅ **Usability** - Language-aware tags in source code
✅ **Extensibility** - Modular design for future enhancements
✅ **Performance** - Efficient pipeline for typical workflows

---

**Architecture Version:** 1.0.0
**Last Updated:** March 23, 2026
