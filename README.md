# superagent-claude-planner

![One conversation, one approved plan, one GitHub issue in each of five repositories at once, in merge order](docs/assets/hero.svg)

superagent-claude-planner is a Claude Code plugin that plans one change across several GitHub repositories. You describe the change once. It reads the repositories, drafts a shared contract and a merge order, and publishes one GitHub issue per repository for an issue-driven coding agent, only after you approve the exact plan it showed you. Each issue mentions the agent, so its pull requests can land in the right order.

## How it works

![superagent-claude-planner flow](docs/assets/flow.svg)

## Quick start

```sh
npm i -g superagent-claude-planner
claude plugin marketplace add <owner>/superagent-claude-planner
claude plugin install superagent-claude-planner@sac-planner-local
export PLANNER_GITHUB_TOKEN=<planner account token>   # before you start Claude Code
```

Save one config file as `~/.config/sac-planner/config.json`:

```json
{
  "agent": { "kind": "superagent-claude", "login": "<agent-login>" }
}
```

Then open Claude Code in your own project directory and type:

```
/superagent-claude-planner:plan <request>
```

It needs Node.js 22.19 or later. `<owner>/superagent-claude-planner` is the GitHub repository of this plugin. The Skill calls `sac-planner` from your `PATH`, so install the package globally. `npx superagent-claude-planner --help` runs the CLI on its own without an install. Every command finds the config by itself, so you never pass a path: a `./sac-planner.config.json` in the project directory comes first, then `~/.config/sac-planner/config.json`. The token belongs to the planner's own GitHub account, needs issue write access on the target repositories, and is never written to files. Run `claude` from your own project, not from the root of the plugin repository, where Claude Code blocks the plan draft. See [docs/setup.md](docs/setup.md) for the planner account, the token, what the agent needs, and the optional repo catalog.

## Documentation

- [Setup](docs/setup.md): planner account, token, config, catalog, plugin install
- [CLI reference](docs/setup.md#cli-reference): every `sac-planner` command

## Works with superagent-claude

![superagent-claude-planner and superagent-claude: each works on its own, and the planner's GitHub issues can optionally feed the agent](docs/assets/works-with.svg)

Each tool works on its own, and they can be used together. [superagent-claude](https://www.npmjs.com/package/superagent-claude) is a proactive coding agent for GitHub repositories. It acts when an allowed person mentions its account, handles one request in one repository at a time, and answers with a pull request. The planner splits a change that spans several repositories into one issue per repository, with a shared contract and a merge order, and mentions the agent (`agent.login`) in each issue. superagent-claude then works through those issues like any other request. The agent boundary is a generic adapter (`agent.kind`). superagent-claude is the profile shipped today, and another issue-driven agent can be added as an adapter without changing the plan format or the publish flow.

## Approval and safety

The Skill confirms the repositories with you before it drafts anything, and it shows every issue and a plan hash before it publishes. Approval is bound to that hash, so any edit to the plan needs a new approval. When a change removes or renames something, the Skill stops and asks you to choose. **(A) staged** adds the new form next to the old one and removes the old form later. **(B) at-once** changes the producer and the consumers together and merges them in order. The choice is always yours. The model has no GitHub write path: publishing is one deterministic CLI command, and a guard hook denies `gh`, direct GitHub API calls, and any use of the planner token in Bash. The planner makes no assumption about the language, framework, build tool, contract format, or organization of the repositories it plans.

## CLI

The Skill runs each deterministic step through the `sac-planner` CLI, and you can run the same commands yourself: `save`, `validate`, `show`, `approve`, `publish`, `state`, `schema`, `catalog`, and `session`. `sac-planner --help` lists them, and the [CLI reference](docs/setup.md#cli-reference) describes each one. Every command finds the config by itself. For scripts and headless runs, `--config <path>` or `$SAC_PLANNER_CONFIG` points it at another file.

## Contributing

Development setup, checks, commit rules, and the release process are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
