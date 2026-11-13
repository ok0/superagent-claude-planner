# superagent-claude-planner

Plan one change that spans several repositories, then publish it as one GitHub issue per repository for an issue-driven coding agent. All issues share one contract and a merge order, so the agent's pull requests can land in the right sequence.

## Install

See [docs/setup.md](docs/setup.md) for the planner account, token, config file, optional catalog, and plugin installation.

## Usage

Invoke the Skill from Claude Code with your change request:

```
/superagent-claude-planner:plan <request>
```

The Skill reads the repositories, drafts a plan, validates it, shows the issues and the plan hash, and publishes only after you explicitly approve.

The `sac-planner` CLI provides the deterministic steps:

- `sac-planner validate <plan>`: validate a plan file and print `OK <hash>`.
- `sac-planner show <plan>`: render every issue without contacting GitHub, then print the plan hash.
- `sac-planner approve <plan> --hash <h>`: record approval of a shown hash.
- `sac-planner publish <plan> --approve-hash <h>`: publish one issue per repo using the approved plan.
- `sac-planner state <plan>`: print the saved publish state.
- `sac-planner schema`: print the plan JSON Schema.
- `sac-planner catalog [--json]`: print the configured repo catalog, or `no catalog configured`.
- `sac-planner save`: read plan JSON from stdin, validate it, and store it as `.sac-planner/<changesetId>/plan.json`.
- `sac-planner session start|end`: mark the plan session active (with the current time) or done; the Skill's guard hook reads this marker.

## Breaking changes

When a change removes or renames something, the Skill stops and asks you to choose between two strategies:

- **(A) staged**: add the new form alongside the old one, migrate consumers, and remove the old form in a later change. Safe to deploy in any order, with more steps.
- **(B) at-once**: change the producer and consumers together and merge in the given order. Fewer steps, with brief breakage between merges.

The choice is always made by you. The Skill explains both options and records your answer in the plan.

## Safety model

- Approval is bound to the plan hash. Any edit to the plan invalidates the earlier approval.
- The language model has no GitHub write path. Publishing is a deterministic CLI command that runs only after approval.
- A guard hook denies `gh`, direct GitHub API calls, and any use of the planner token in Bash, at all times. While a planning session is active, it also restricts Bash to read-only commands and the `sac-planner` commands.

## Generic design

The planner makes no assumption about the language, framework, build tool, contract format, or target organization of the repositories it plans. The catalog is optional. Without it, the Skill asks for the repositories and reads them directly.

## Development

- `pnpm check` runs the full set of checks: typecheck, format check, tests, build, bundle check, hygiene check, and commit-message check.
- `pnpm check:commits` checks commit messages against Conventional Commits.
- Commit messages follow Conventional Commits.

## Sample fixture

`fixtures/synthetic-shop/` contains three small placeholder repositories, a sample catalog, and sample configs. Use them to try the Skill without real repositories.
