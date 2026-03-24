# Quick Reference Guide

## Authorship Labels at a Glance

### LLM_GENERATED ✨
**What:** Code first appeared in chatbot response
- Chatbot generated it originally
- User didn't mention it before
- Example: You asked "write a sorting function" → ChatBot provided code
- Confidence: Usually 85-100%

**Tag Example:**
```python
# [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    # ... rest of implementation
```

---

### HUMAN_PROMPT_ORIGIN 👤
**What:** Code originated from user prompt, chatbot refined it
- User provided the code first (in a prompt)
- Chatbot may have improved or repeated it
- Example: You said "Here's my code: `x = 5`" → ChatBot suggested improvements
- Confidence: Usually 80-95%

**Tag Example:**
```python
# [AUTHORSHIP: HUMAN_PROMPT_ORIGIN] | confidence=85% | timestamp=2026-03-23 | origin=user
def calculate_average(numbers):
    return sum(numbers) / len(numbers)
```

---

### HUMAN_WRITTEN ✍️
**What:** Code doesn't appear in conversation history
- Human wrote it directly without chatbot
- Not mentioned or discussed in chat
- Example: You wrote your own function without asking for help
- Confidence: Usually 90-100% (very sure nothing was missed)

**Tag Example:**
```python
# [AUTHORSHIP: HUMAN_WRITTEN] | confidence=95% | timestamp=2026-03-23 | origin=unknown
def validate_email(email):
    # Custom company validation logic
    return "@company.com" in email
```

---

### MIXED ⚡
**What:** Function combines LLM-generated and human-written code
- Part of the function came from chatbot
- Part was written/modified by human
- Example: ChatBot wrote `calculate()`, you added error handling
- Confidence: Usually 70-85%

**Tag Example:**
```python
# [AUTHORSHIP: MIXED] | confidence=78% | timestamp=2026-03-23
def calculate_average(numbers):
    # ChatBot generated this part:
    if not numbers:
        return 0
    
    # Human added validation:
    if not isinstance(numbers, list):
        raise ValueError("Expected list")
    
    # ChatBot generated this:
    return sum(numbers) / len(numbers)
```

---

### UNCERTAIN ❓
**What:** System couldn't confidently determine origin
- Code is too different from conversation
- Could match multiple sources
- Example: Code is heavily refactored version of something discussed
- Confidence: Usually 50-70%

**Tag Example:**
```python
# [AUTHORSHIP: UNCERTAIN] | confidence=62% | timestamp=2026-03-23
def process_data(data):
    # Could be refactored version of something discussed
    # Manual review recommended
    result = {}
    for item in data:
        result[item['id']] = item['value']
    return result
```

---

## How The System Works

### The Key Principle: Temporal Ordering

The system asks: **"WHO INTRODUCED THIS CODE FIRST?"**

Not: "Is similar code in the conversation?"

### Example Timeline

```
Timeline of Events:
═══════════════════════════════════════════════════════════

Message 5 (User):
"Here's my current function: 
  def add(a, b):
      return a + b"
└─ Code introduced by: USER

Message 7 (ChatBot):
"That's good, here's an improved version with docstring:
  def add(a, b):
      """Adds two numbers."""
      return a + b"
└─ Code introduced by: ChatBot (but user had it first)

Message 10 (User saves file with this function)
└─ Result: HUMAN_PROMPT_ORIGIN (user introduced it first in Message 5)

═══════════════════════════════════════════════════════════

Message 12 (ChatBot):
"Here's a new function to multiply:
  def multiply(a, b):
      return a * b"
└─ Code introduced by: ChatBot

Message 14 (User saves file with this function)
└─ Result: LLM_GENERATED (ChatBot introduced it first)

═══════════════════════════════════════════════════════════
```

### Step-by-Step Process

1. **You save a file** in VS Code
2. **System gets the old version** from git
3. **System compares** old → new (git diff)
4. **System parses FULL conversation** (all messages, all code snippets)
5. **For each new function:**
   - Search conversation for similar code
   - Find FIRST appearance
   - Check: Is it from User or ChatBot?
   - Assign label and confidence
6. **System inserts tag** into your code
7. **System creates JSON log** for records

---

## Similarity Matching Explained

### 5 Levels of Matching

```
Level 1: EXACT MATCH (100%)
─────────────────────────────
def add(a, b):
    return a + b

vs

def add(a, b):
    return a + b
✓ IDENTICAL → MATCH AT 100%


Level 2: WHITESPACE MATCH (95%)
─────────────────────────────────
def add(a, b):
    return a + b

vs

def add(a, b):  return a + b
✓ SAME LOGIC, different spacing → MATCH AT 95%


Level 3: NORMALIZED MATCH (85%)
────────────────────────────────
def add(num_one, num_two):
    return num_one + num_two

vs

def add(a, b):
    return a + b
✓ SAME STRUCTURE, different variable names → MATCH AT 85%


Level 4: FUZZY MATCH (70%)
──────────────────────────
def add(a, b):
    # This function adds two numbers
    return a + b  # Return the sum

vs

def add(a, b):
    return a + b

✓ SAME LOGIC, some additions → MATCH AT 75%


Level 5: STRUCTURAL MATCH (60%)
───────────────────────────────
def add(x, y):
    if x is None:
        x = 0
    if y is None:
        y = 0
    return x + y

vs

def add(a, b):
    return a + b

✓ SIMILAR PATTERN, but refactored → MATCH AT 65%
```

---

## Reading the Tag Format

```
// [AUTHORSHIP: LLM_GENERATED] | confidence=92% | timestamp=2026-03-23 | origin=assistant | msg_index=12
```

| Part | Meaning |
|------|---------|
| `[AUTHORSHIP: LLM_GENERATED]` | The label - what the origin is |
| `confidence=92%` | How sure (0-100%). Higher = more confident |
| `timestamp=2026-03-23` | When the analysis ran |
| `origin=assistant` | Who introduced it (user or assistant) |
| `msg_index=12` | Which message in conversation it came from |

---

## Tag Confidence Explained

```
95-100% : System is very confident
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Exact match found, no ambiguity
You probably trust this completely

80-94% : System is quite confident
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Close match, minor variations
You can generally trust this

70-79% : System has reasonable confidence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Multiple possible matches
Worth a quick review

50-69% : System is uncertain
━━━━━━━━━━━━━━━━━━━━━━━━━━
Could be refactored or ambiguous
Recommend manual review

0-49% : Not a match
━━━━━━━
Code doesn't appear in conversation
Definitely human-written
```

---

## Common Scenarios

### Scenario 1: Direct Copy

```
Chat:
You: "Write a function to check if number is prime"

ChatBot:
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True

Your File:
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True
```

**Result:** 
- Label: **LLM_GENERATED**
- Confidence: **100%** (exact match)
- Origin: **assistant** (message 5)

---

### Scenario 2: Your Code + Chatbot Improvement

```
Chat:
You: "Here's my sorting code: def sort_numbers(arr): return sorted(arr)"

ChatBot: "Here's a more efficient version:
def sort_numbers(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] > arr[j]:
                arr[i], arr[j] = arr[j], arr[i]
    return arr"

Your File:
def sort_numbers(arr):
    for i in range(len(arr)):
        for j in range(i + 1, len(arr)):
            if arr[i] > arr[j]:
                arr[i], arr[j] = arr[j], arr[i]
    return arr
```

**Result:**
- Label: **HUMAN_PROMPT_ORIGIN** (you showed code first)
- Confidence: **88%** (clear match to your version first)
- Origin: **user** (message 3)

---

### Scenario 3: Custom Implementation

```
Chat:
You: "How do I validate an email?"

ChatBot: "Use regex like this: re.match(r'^...@...\.com$', email)"

Your File:
def validate_email(email):
    # I implemented my own company-specific validation
    parts = email.split('@')
    if len(parts) != 2:
        return False
    domain = parts[1]
    return domain in ['company.com', 'internal.company.com']
```

**Result:**
- Label: **HUMAN_WRITTEN**
- Confidence: **95%** (not in conversation)
- Origin: **unknown** (not found)

---

## Using the Logs

### Where Are the Logs?

```
.authorship-logs/
├── abc1234_1711270200.json        ← Full analysis per commit
├── function-attributions.jsonl    ← One entry per function
└── analysis-report.txt            ← Human-readable summary
```

### What's in a Log?

```json
{
  "filePath": "src/math.py",
  "functionName": "multiply",
  "detectedLabel": "LLM_GENERATED",
  "confidenceScore": 0.92,
  "firstMatchSource": "chatbot_response",
  "reasoning": "Code first appeared in chatbot response (message 8) with 92% similar match. No prior user mention detected.",
  "similarityMatches": [
    {
      "type": "exact",
      "score": 100,
      "messageIndex": 8
    }
  ]
}
```

### Interpreting Confidence

- **90-100%:** Trust it, make tags visible in code review
- **75-89%:** Reasonable confidence, manually verify if critical
- **60-74%:** Review the matching message in chat to confirm
- **<60%:** Probably wrong, manual review necessary

---

## Tips for Best Results

### Do This ✓

1. **Be consistent** - When asking for code, copy it directly
2. **Show your code in comments** - "Here's my current function: ..."
3. **Save frequently** - Each save triggers analysis
4. **Keep conversation open** - System needs the history
5. **Review tags** - Spot-check especially low-confidence ones

### Avoid This ✗

1. **Paraphrasing** - Heavily rewriting chatbot code makes it hard to detect
2. **Mixing multiple sources** - Combining code from different messages
3. **Deleting conversation** - Logs won't have the history
4. **Copying without asking** - If you don't mention wanting code, system might miss it
5. **Trusting 60% confidence** - Always review low-confidence attributions manually

---

## FAQ

**Q: Can I disable tagging?**
A: In gitChangeTracker.ts, set `insertTags: false`

**Q: How often does analysis run?**
A: Every time you save a file (if it's in git and has conversation history)

**Q: Does it tag unchanged code?**
A: No, only newly added or modified code blocks

**Q: What if I copy code but forget to save?**
A: Tags only appear after saving. Just save to trigger analysis.

**Q: Can I remove tags later?**
A: Yes, manually delete the tag lines or use codeTagInserter.removeAllTags()

**Q: What about refactored code?**
A: System uses fuzzy matching (level 4-5) to find similar code even if refactored

**Q: Is 60% confidence reliable?**
A: Use as a guide only. Manually review especially for legal/compliance needs

---

## System Health Check

### Everything Working? ✓
- [ ] Chatbot opens and responds
- [ ] Conversation history shows messages
- [ ] File saves trigger console output
- [ ] Tags appear in code after save
- [ ] `.authorship-logs/` directory created with JSON files

### Something Wrong? 🔧
- [ ] Chatbot panel not responding → Close and reopen
- [ ] No analysis running → Check file is in git repo
- [ ] No tags appearing → Verify file has git history
- [ ] Check console → Look for `[AuthorshipTracker]` messages
- [ ] Check `.authorship-logs/` → Are JSON files being created?

---

**Reference Version:** 1.0.0
**Last Updated:** March 23, 2026
**For detailed info:** See ARCHITECTURE.md and IMPLEMENTATION_GUIDE.md
