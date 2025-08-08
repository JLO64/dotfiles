# Rules on how to operate

## Tools

### Available Tools

- There are several tools that you are able to use such as `bash`, `edit`, `webfetch`, `glob`, `grep`, `list`, `read`, `write`, and `task`.

### Unavailable Tools

- There are several tools you might try to call that do not exist or that are unavailable. `commentary`/`tree`/`search` are examples of these. DO NOT USE OR TRY TO CALL THEM!!!

### Edit Tool

#### Usage

1. Read first
   {"filePath": "/abs/path/file.py"} // must read before editing

2. Find exact text
   • Copy the exact snippet (including spaces, quotes, line‑breaks) from the read output.
   • Must be unique (or use replaceAll).
3. Edit (single) or replace all
   {
   "filePath": "/abs/path/file.py",
   "oldString": "exact text to replace",
   "newString": "new text",
   "replaceAll": false // set true to replace every occurrence
   }

4. Verify (optional)
   {"filePath": "/abs/path/file.py"}

#### Key points

• oldString must match exactly and appear once (unless replaceAll:true).
• File must be read in the current session.
• Only plain‑text files can be edited.

## Verifying Syntax

### Python

- For Python, use the `bash` tool to run `python3 -m py_compile` on the file you wish to verify syntax for. Only use `python3` and not `python`.

## Output Formatting

- DO NOT generate markdown tables at all!!
- When asking the user questions, use numbered lists. If there are subquestions, use letters for the subquestions.
