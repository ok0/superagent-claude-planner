# superagent-claude-planner

Plan one change that spans several repositories, then publish it as one GitHub issue per repository for an issue-driven coding agent. All issues share one contract and a merge order, so the agent's pull requests can land in the right sequence.

![superagent-claude-planner flow](docs/assets/flow.svg)

## Install

```sh
npm i -g superagent-claude-planner
sac-planner --help
```

It needs Node.js 22.19 or later. `npx superagent-claude-planner --help` runs it without a global install.

The Claude Code plugin installs from this repository's marketplace: see [Plugin install](docs/setup.md#plugin-install).

## Configuration

The CLI reads the config from the first source that applies, in this order:

1. `--config <path>`
2. `$SAC_PLANNER_CONFIG`
3. `./sac-planner.config.json` in the current directory
4. `~/.config/sac-planner/config.json`

A minimal config:

```json
{
  "agent": { "kind": "superagent-claude", "login": "<agent-login>" },
  "github": { "tokenEnv": "PLANNER_GITHUB_TOKEN" }
}
```

The planner token is read from `PLANNER_GITHUB_TOKEN` (or the variable named by `github.tokenEnv`) and is never written to files. See [Config file](docs/setup.md#config-file) for every option.

## Operator setup

The planner runs as its own machine account. That account needs a token with issue write access on the target repositories. The agent that picks up the issues has its own requirements, such as its account and start conditions. See [docs/setup.md](docs/setup.md) for the full setup.

## Usage

### Skill (Claude Code plugin)

Invoke the Skill from Claude Code with your change request:

```
/superagent-claude-planner:plan <request>
```

The Skill reads the repositories, drafts a plan, validates it, shows the issues and the plan hash, and publishes only after you explicitly approve.

### CLI

The `sac-planner` CLI provides the deterministic steps:

- `sac-planner validate <plan>`: validate a plan file and print `OK <hash>`.
- `sac-planner show <plan>`: render every issue without contacting GitHub, then print the plan hash.
- `sac-planner approve <plan> --hash <h>`: record approval of a shown hash.
- `sac-planner publish <plan> --approve-hash <h>`: publish one issue per repo using the approved plan.
- `sac-planner state <plan>`: print the saved publish state.
- `sac-planner schema`: print the plan JSON Schema.
- `sac-planner catalog [--json]`: print the configured repo catalog, or `no catalog configured`.
- `sac-planner save [--file <path>]`: read plan JSON from <path> or stdin, validate it, and store it as `.sac-planner/<changesetId>/plan.json`.
- `sac-planner session start|end`: mark the plan session active (with the current time) or done; the Skill's guard hook reads this marker.

## Works with superagent-claude

![superagent-claude-planner and superagent-claude: each works on its own, and the planner's GitHub issues can optionally feed the agent](docs/assets/works-with.svg)

Each tool works on its own, and they can be used together. superagent-claude is a proactive coding agent for GitHub repositories. It acts when an allowed person mentions its account, and answers with a pull request ([npm](https://www.npmjs.com/package/superagent-claude)). The planner publishes one issue per repository, each mentioning the configured agent login (`agent.login`). superagent-claude picks up each issue and opens a pull request, and the shared contract and merge order keep the pull requests consistent. The agent boundary is a generic adapter (`agent.kind`). superagent-claude is the profile shipped today, and another issue-driven agent can be supported by adding an adapter, without changing the plan format or the publish flow.

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

## Documentation

- [Setup](docs/setup.md): planner account, token, config, catalog, plugin install
- [Release](docs/release.md): release procedure and checks

## Development

- `pnpm check` runs the full set of checks: typecheck, format check, tests, build, bundle check, hygiene check, and commit-message check.
- `pnpm check:commits` checks commit messages against Conventional Commits.
- Commit messages follow Conventional Commits.
- `pnpm release:check` builds, checks the npm pack contents, and installs the tarball in a clean project.

## Sample fixture

`fixtures/synthetic-shop/` contains three small placeholder repositories, a sample catalog, and sample configs. Use them to try the Skill without real repositories.

## License

MIT. See [LICENSE](LICENSE).
