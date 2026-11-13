---
name: plan
description: Plan one change across several repositories as coordinated GitHub issues. Reads the repos, drafts and validates a plan, shows the issues and the plan hash, and publishes only after explicit approval.
argument-hint: "[change request]"
disable-model-invocation: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write(./.sac-planner/draft.json)
  - Bash(sac-planner session *)
  - Bash(sac-planner save *)
  - Bash(sac-planner validate *)
  - Bash(sac-planner show *)
  - Bash(sac-planner state *)
  - Bash(sac-planner schema*)
  - Bash(sac-planner catalog*)
  - Bash(sac-planner publish * --approve-hash *)
  - Bash(git clone --depth 1 *)
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard-bash.mjs"'
---

# Plan a multi-repository change

The request is: $ARGUMENTS

Turn the request into one plan that covers every affected repository, then publish one GitHub issue per repository only after the user explicitly approves the shown plan. You never write to GitHub yourself. The only write path is the single `sac-planner publish` command in step 10. Do not use `gh`, `curl`, or `git push`, and do not call any GitHub API directly.

**Command rules.** Run one command per Bash call. Do not chain or decorate commands: no `;`, `&&`, `||`, `|`, `$?`, `echo`, `date`, redirection, or command substitution. The tool reports the exit code. Read and search files with Read, Grep, and Glob, not shell loops or cat/find pipelines. Use Write only for the plan draft `.sac-planner/draft.json`; never write any other file there.

Follow the steps in order.

1. **Start the session.** Run `sac-planner session start` from the project root (the working directory at invocation; do not change directory). It writes `.sac-planner/.session-active` with the current UTC time, and also refreshes a marker left by an earlier session. The guard hook restricts Bash commands while that file says `active`.

2. **Refine the request.** Restate the request in one or two sentences. Ask only the questions whose answers change how the change is split across repositories. The CLI finds the config by itself. Only if the user names a config file, add `--config <path>` to every `sac-planner` command you run.

3. **Check the catalog.** Run `sac-planner catalog`. If the output is `no catalog configured`, use direct mode. Otherwise use hybrid mode: shortlist the candidate repositories from their descriptions and contract locations. If the command exits with code 2, show the error message and point the user to `docs/setup.md`.

4. **Identify and confirm the repositories (required, never skip).** In hybrid mode, use the shortlist and each repository's `localPath` from the catalog. In direct mode, ask the user for the local path of each repository, or shallow-clone it with `git clone --depth 1 <url> .sac-planner/repos/<name>`. Then show the user one line per repository: the `owner/name` slug, its expected role (`producer`, `consumer`, `both`, or `other`), its local path, and where the slug came from (catalog, the user, or a clone remote). A slug inferred from a clone remote or a directory name is only a guess. Ask the user to confirm or correct the list, roles, and slugs, and wait for the reply. Do not read further, save, or show a plan until the user has confirmed the repositories. This confirmation is separate from the approval in step 9 and does not replace it. If the user later adds or removes a repository, confirm the new list the same way.

5. **Read the repositories directly.** Do this in both modes. Use Read, Grep, and Glob to find the contract files: use the `contracts` listed in the catalog when present, otherwise search for API specifications, schemas, interface or type definitions, and message formats, whatever the repository uses. Then grep for the consumers of every name the change touches. Make no assumption about the language, framework, build tool, or contract format. Pick `contract.format` from the schema enum, and use `text` when no entry fits.

6. **Breaking-change choice.** If any change removes or renames something (a `contract.changes[].kind` of `remove` or `rename`), stop and ask the user to choose between two strategies. Explain both:
   - **(A) staged**: add the new form alongside the old one, migrate the consumers, and remove the old form in a later change. Safe to deploy in any order, with more steps.
   - **(B) at-once**: change the producer and the consumers together and merge in the given order. Fewer steps, with a brief period of breakage between merges.

   Recommend nothing as final. Wait for the user's answer and never choose for the user. Record `breaking: { isBreaking: true, strategy: "staged" | "at-once", note: "<the user's reason, if given>" }`. Do not write the final plan before the user answers.

7. **Decompose.** Produce, without asking the user to write any of it: the repositories with their roles (`producer`, `consumer`, `both`, or `other`), one task per repository, the shared contract (summary, definition, rules, examples, and changes), the dependencies (`before`, `after`, and `reason`), and a merge-order note. Run `sac-planner schema` if you are unsure of the format.

8. **Save and validate.** Write the whole plan JSON to `.sac-planner/draft.json` with the Write tool, then run `sac-planner save --file .sac-planner/draft.json` (no heredoc, no braces in the Bash command). The command validates the plan and writes `.sac-planner/<changesetId>/plan.json`. It prints `saved <plan>` and `OK <hash>`, or one `path: message` line per problem and saves nothing. A successful save deletes `.sac-planner/draft.json`; to change the plan, Write the whole draft again and save it again. Fix and Write the whole plan again until it prints `OK <hash>`. Use the printed path as <plan> below; `sac-planner validate <plan>` re-checks it.

9. **Show and ask for approval.** Run `sac-planner show <plan>`. Present each issue (its repository, title, and key body parts) and the `Plan hash:` line verbatim. Ask the user to reply "approve" (or "승인") to publish these issues with that hash. After **any** plan edit, re-run validate, re-run `show`, present the new hash, and ask again. An earlier approval no longer counts.

10. **Publish only after explicit approval.** Run publish only when the user's latest message is an explicit approval of the plan you showed, for example "approve", "승인", or "yes, publish". Run `sac-planner publish <plan> --approve-hash <the hash most recently shown>`. If the reply is ambiguous, ask again. Never run publish earlier, never with a different hash, and never through any other command. Report the URL of each issue from the output.
    - Exit 1: show the message and its hint (approval, identity, or state).
    - Exit 2: this is a configuration problem. Point the user to `docs/setup.md`.
    - Exit 3: this is a GitHub failure. Offer to re-run the same command to resume, and ask before you re-run it.

11. **End the session.** At the end, or whenever the user aborts or declines, run `sac-planner session end`, which writes `done` to `.sac-planner/.session-active`. It also deletes a leftover `.sac-planner/draft.json`.
