---
name: git-commit
description: Create well-scoped Git commits with repository-appropriate messages
argument-hint: [optional context about changes]
---

# Git Commit

Create commit(s) for the current task. Treat `$ARGUMENTS` as additional context.

## Procedure

1. Read the repository instructions, working-tree status and diff, staged diff, and recent commit messages.
2. Identify the changes that belong to the current task. If ownership is unclear, ask before including them.
3. Split independent changes into coherent commits; use one commit when the changes form a single unit.
4. Stage only the intended files and review the staged diff before each commit.
5. Follow the repository's commit convention. Otherwise, use a concise Conventional Commit subject in imperative mood that describes the change's purpose.
6. Commit using a heredoc so multiline messages are preserved exactly:

   ```bash
   git commit -m "$(cat <<'EOF'
   <commit message>
   EOF
   )"
   ```

   Fix any hook failure rather than bypassing it.

7. Verify the resulting commit and report any changes left uncommitted.

## Constraints

- Repository-specific instructions and the user's requested scope take precedence.
- Never include unrelated changes, secrets, temporary files, logs, or generated artifacts unless they are intentionally part of the task.
- Never use `--no-verify`.
- Never amend a commit that existed before this task unless explicitly asked.
