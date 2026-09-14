# AI Usage Compliance Logger

A VS Code extension that keeps a record of **who actually wrote your code — you or an AI assistant.**

It gives you a built-in AI chat panel to work with, and in the background it watches your Git repository. Every time you make a new commit, it compares the code you just committed against your chat history and labels each function with where it came from. It then writes that label as a comment above the function and saves a detailed audit log to disk.

This guide is written for someone opening this project for the first time — follow it top to bottom and you'll have the extension running.

---

## 1. What This Project Actually Does

- Adds an **"AI Assistant"** button to the VS Code status bar that opens a chat panel.
- The chat panel talks to an LLM through [OpenRouter](https://openrouter.ai/) (a service that gives access to several free/paid models through one API).
- Every message you send and receive is saved locally (inside VS Code's own storage, not in this repo).
- When you commit code in Git, the extension automatically:
  1. Looks at what changed in that commit.
  2. Searches your saved chat history for matching code.
  3. Decides whether each function was **written by the AI**, **written by you**, or **written by you first and then discussed with the AI**.
  4. Inserts a comment above the function recording that decision.
  5. Writes a detailed JSON log of the whole analysis to a folder called `.authorship-logs/`.

The result is a paper trail you (or your team, or an auditor) can use to see how much of a codebase came from an AI assistant.

---

## 2. Before You Start — What You Need

Make sure you have these installed:

| Requirement | Why |
| --- | --- |
| [VS Code](https://code.visualstudio.com/) `^1.104.0` | This is a VS Code extension — it only runs inside VS Code. |
| [Node.js](https://nodejs.org/) + npm | Used to install dependencies and compile the TypeScript source. |
| [Git](https://git-scm.com/) | The extension watches Git commits, so you need Git installed and a Git repository open. |
| An OpenRouter API key | Needed for the chat panel to talk to an AI model. Free to create at [openrouter.ai](https://openrouter.ai/) — free-tier models are used by default. |

You do **not** need to know anything about the internals to get it running — just follow the steps below.

---

## 3. Setup — Step by Step

### Step 1: Clone and install dependencies

```bash
git clone <this-repository-url>
cd ai-usage-compliance-logger
npm ci
```

`npm ci` installs the exact dependency versions recorded in `package-lock.json`, so your setup matches everyone else's.

### Step 2: Add your API key

The chat panel needs an OpenRouter API key to work. It reads this key from a `.env` file that you create yourself (this file is intentionally excluded from Git so your key never gets committed).

1. Create a new file named `.env` in the project root (next to `package.json`).
2. Add one line to it:

   ```
   OPENROUTER_API_KEY=your_actual_key_here
   ```

3. Save the file.

If you skip this step, the chat panel will still open, but sending a message will show an error telling you the key is missing.

### Step 3: Compile the TypeScript source

```bash
npm run compile
```

This turns the code in `src/` (TypeScript) into JavaScript in `out/`, which is what VS Code actually runs.

### Step 4: Launch the extension

1. Open this project's folder in VS Code.
2. Press `F5` (or go to **Run and Debug → Run Extension**).
3. A second VS Code window opens — this is the **Extension Development Host**, a sandbox with your extension already loaded. Everything you do from here on happens in *that* window.

### Step 5: Open a Git repository in the new window

The extension needs an active Git repository with at least one commit to do anything useful.

- Open any folder that's already a Git repo, **or**
- Create a new folder, run `git init` and make one commit, then open that folder.

### Step 6: Try it out

1. Click **AI Assistant** in the bottom status bar to open the chat panel.
2. Ask it something, e.g. *"write a function that reverses a string"*.
3. Copy the code it gives you into a file in your workspace.
4. Commit that file with Git (`git add .` then `git commit -m "..."`, or use VS Code's Source Control panel).
5. Within a few seconds, check the file again — you should see a comment inserted above the function recording its authorship, and a new `.authorship-logs/` folder should appear in your workspace with a JSON log inside it.

That's the whole loop: **chat → copy code → commit → get labeled automatically.**

---

## 4. Understanding the Output

### The labels

| Label | Meaning |
| --- | --- |
| `LLM_GENERATED` | This code first appeared in something the AI said. |
| `HUMAN_PROMPT_ORIGIN` | You typed this code into the chat yourself before the AI ever produced it (e.g. you pasted your own code and asked for feedback). |
| `HUMAN_WRITTEN` | This code doesn't match anything in your chat history — you wrote it independently. |
| `MIXED` | Part of the function came from the AI, part was written/edited by you. |
| `UNCERTAIN` | The system found a possible match but isn't confident enough to commit to a label. |

### Example of an inserted tag

```ts
// @Authorship: human - file lines 10-12; llm - file lines 13-16 | timestamp=2026-09-05
function example() {
  return true;
}
```

### Where the output goes

- `.authorship-logs/<commit>_<timestamp>.json` — full analysis for one commit.
- `.authorship-logs/function-attributions.jsonl` — one line per function, useful for streaming/bulk analysis.
- `AUTHORSHIP_LATEST_LOG.json` — the most recent analysis, in a stable location.
- `AUTHORSHIP_LATEST_REPORT.md` — the same thing, written as a human-readable summary.
- Source files themselves — `@Authorship` comments inserted directly above each analyzed function.

Tag insertion happens **after** the commit is made, so those comment changes sit in your working tree uncommitted — review them and commit separately if you want to keep them in history.

---

## 5. How It Works Under the Hood

If you want to understand or modify the logic, here's what each file does:

| File | Role |
| --- | --- |
| `src/extension.ts` | Entry point. Runs when VS Code activates the extension; sets up the status bar button and starts the Git watcher. |
| `src/chatbotPanel.ts` | The chat UI (webview), sending/receiving messages, and saving conversation history. |
| `src/envLoader.ts` | Reads your `.env` file so the API key never has to be hardcoded in source. |
| `src/gitChangeTracker.ts` | Watches Git for new commits and runs the whole attribution pipeline when one appears. |
| `src/conversationParser.ts` | Scans your saved chat history and pulls out every code snippet it can find. |
| `src/diffParser.ts` | Reads the Git diff for a commit and breaks it into function-sized blocks of code. |
| `src/codeSimilarityMatcher.ts` | Compares two pieces of code and scores how similar they are (exact match, same after formatting, same structure, etc). |
| `src/authorshipAttributor.ts` | The core decision-maker — for each code block, works out who introduced it *first* in the conversation. |
| `src/codeTagInserter.ts` | Writes the `@Authorship` comment into the right place in the file, using the correct comment style for the language. |
| `src/attributionLogger.ts` | Writes the JSON/JSONL/Markdown log files described above. |
| `src/types.ts` | Shared TypeScript types used across all the files above. |

**The pipeline, in order:**

```
You commit code in Git
        ↓
gitChangeTracker detects the new commit
        ↓
conversationParser indexes your saved chat history
        ↓
diffParser extracts the changed functions from the commit
        ↓
authorshipAttributor compares each function against the chat history
        ↓
codeTagInserter writes a comment above each function
        ↓
attributionLogger saves the full analysis to disk
```

The key rule the attribution engine follows: **whoever said the code first wins.** If you pasted your own code before the AI ever produced anything similar, it's labeled as yours — even if the AI repeated or improved it afterward.

---

## 6. Everyday Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Install dependencies exactly as locked in `package-lock.json`. |
| `npm run compile` | Compile `src/` into `out/`. Run this after any code change before testing. |
| `npm run watch` | Same as above, but keeps running and recompiles automatically as you edit. Useful while developing. |
| `npm run lint` | Check the code style with ESLint. |
| `npm test` | Run the VS Code extension test suite (requires an environment that can launch VS Code). |

---

## 7. Troubleshooting

**Nothing happens after I commit.**
- Make sure the workspace you committed in is a Git repository with at least one prior commit.
- The extension only reacts to commits made *after* it started watching — the very first commit it sees on startup is just recorded as a baseline, not analyzed.
- Detection can lag a few seconds; it uses both Git events and a polling fallback.

**The chat panel shows an API key error.**
- Check that you created a `.env` file in the project root with `OPENROUTER_API_KEY=...` set, and that you ran `npm run compile` / relaunched the extension host afterward.

**Everything is labeled `HUMAN_WRITTEN`.**
- This is expected if the chat panel has no conversation history yet, or if it's a different session than the one that generated the code. The extension only compares against chat history it can currently access.

**Confidence scores look low or attribution seems wrong.**
- The matching is heuristic (pattern-based, not perfect understanding of code). Heavily rewritten or renamed code is harder to match. Treat this as a helpful signal, not a certainty — review anything important manually before relying on it for compliance purposes.

---

## 8. Known Limitations

- Attribution is heuristic — it's based on text/structure similarity, not true code understanding. Manually review before using it for formal compliance decisions.
- Conversation history lives inside VS Code's internal storage, not in this repository — clearing VS Code's extension storage or switching machines loses that history.
- Function boundary detection may occasionally include an adjacent top-level statement, depending on the language.
- Inserting several tags into one file in a single pass can shift line numbers as it goes.
- There is currently no user-facing settings UI in VS Code for changing thresholds — configuration is done in code (`gitChangeTracker.setConfig(...)`).

---

## 9. Cleaning Up

These are all generated automatically and safe to delete if you want a clean slate — they'll be recreated the next time you run the relevant command:

- `node_modules/` — recreated by `npm ci`.
- `out/` — recreated by `npm run compile`.
- `.authorship-logs/`, `AUTHORSHIP_LATEST_LOG.json`, `AUTHORSHIP_LATEST_REPORT.md` — recreated the next time a commit is analyzed.
- `.vscode-test/` — recreated by `npm test`.
- `*.vsix` — recreated if you package the extension.

Never delete `.env` unless you're intentionally resetting your API key — it isn't tracked by Git and won't be recreated automatically.
