# Setup

This guide covers the planner account, the token, the agent requirements, the config file, the optional repo catalog, plugin installation, the CLI commands, the approval flow, and troubleshooting. The short path is to install the CLI and the plugin, create one config file, export the token, and type `/superagent-claude-planner:plan <request>` in Claude Code.

## Planner machine account

Create a dedicated GitHub account of type **User** (not a bot or GitHub App). It is used only to author the planning issues. The account must differ from the agent account named in `agent.login`.

Your own GitHub User account with a personal access token also works, as long as it differs from the agent account.

## Token

Create a personal access token (PAT) for the planner account with issue write access on the target repositories. Export it as `PLANNER_GITHUB_TOKEN`, or under the name set in `github.tokenEnv`:

```sh
export PLANNER_GITHUB_TOKEN=<token>
```

Never put the token in a file. The guard hook blocks Bash commands that reference the token variable.

## Agent requirements

- The planner account must differ from `agent.login`.
- The planner account must be listed in the agent's allowed issue authors (`policy.allowed`). Otherwise the agent ignores the issues. Do not add the agent's own login there; the agent refuses to start if you do.
- The agent's `policy.acceptMode` must be `auto`. The default, `observe`, only records events and starts no work.
- Every target repository must be listed in the agent's `repositories`, and the agent account must be able to read it (write access lets it push branches and open pull requests).
- The agent must be running (`superagent-claude start --config <path>`) with its own token, before or shortly after you publish.
- `sac-planner publish` checks that the token belongs to a User account whose login differs from `agent.login`. It refuses to publish otherwise.

## Config file

Create one config file at `~/.config/sac-planner/config.json`. Every project on the machine then finds it, and you never pass a path:

```sh
mkdir -p ~/.config/sac-planner
```

```json
{
  "agent": { "kind": "superagent-claude", "login": "<agent-login>" },
  "github": { "tokenEnv": "PLANNER_GITHUB_TOKEN" }
}
```

To use different settings in one project, put a `sac-planner.config.json` in that project directory. It takes precedence over the file in your home directory.

- `agent.login` is required. It is the GitHub login of the agent account that is mentioned in each issue.
- `github.tokenEnv` is optional. It names the environment variable that holds the planner token. The default is `PLANNER_GITHUB_TOKEN`.
- `github.apiBaseUrl` is optional. Set it only for a GitHub Enterprise Server host, for example `https://github.example.com/api/v3`. Omit it for github.com.
- `catalog` is optional. It is a path to the catalog file, relative to the config file. Omit it to use direct mode (see below). An absolute path also works.

The CLI uses the first source that exists, in this order:

1. `--config <path>`
2. `$SAC_PLANNER_CONFIG`
3. `./sac-planner.config.json` in the current directory
4. `~/.config/sac-planner/config.json`

`--config` and `$SAC_PLANNER_CONFIG` are advanced options, for scripts, headless runs, or a config kept outside both default locations. Inside Claude Code you don't need them.

## Catalog (optional)

The catalog lists the repositories the planner may use. Its format is:

```json
{
  "repos": [
    {
      "repo": "example-org/orders-api",
      "description": "Order service; owns the orders REST API",
      "localPath": "repos/orders-api",
      "contracts": ["contract/orders.openapi.yaml"]
    }
  ]
}
```

- `repo` is the `owner/name` slug. Each slug must be unique (case-insensitive).
- `description` is a short sentence the Skill uses to shortlist repos.
- `localPath` is optional. It is relative to the catalog file.
- `contracts` is optional. Each entry is relative to the repo root.

Without a catalog, the Skill runs in direct mode: it asks you for the local paths of the repos, or shallow-clones them, and then reads them directly.

Run `sac-planner catalog` to print the catalog, or `sac-planner catalog --json` for JSON output. If no catalog is configured, it prints `no catalog configured`.

## Plugin install

Install the CLI from npm and the plugin from this repository's marketplace:

```sh
npm i -g superagent-claude-planner
claude plugin marketplace add <owner>/superagent-claude-planner
claude plugin install superagent-claude-planner@sac-planner-local
```

`<owner>/superagent-claude-planner` is the GitHub repository of this plugin. The plugin provides the Skill and its guard hook. The Skill runs `sac-planner` from your `PATH`, which the npm package provides.

Export the planner token (see [Token](#token)) before you start Claude Code. Then open Claude Code in your own project directory and type:

```
/superagent-claude-planner:plan <request>
```

Do not run `claude` from the root of the plugin repository. There Claude Code treats `.sac-planner/` as a sensitive path and denies the Write of the plan draft.

### From a local checkout

To try changes to the plugin itself, build it and add the checkout as a marketplace:

```sh
pnpm install && pnpm build
claude plugin marketplace add <path to this repo>
claude plugin install superagent-claude-planner@sac-planner-local
```

To load the plugin for one session without installing it, run `claude --plugin-dir <path to this repo>` from your project directory.

Headless runs (`claude -p`) follow the same rule. Run them from a project directory that is not the plugin root, for example `cd <scratch project> && claude -p --plugin-dir <path to this repo> --permission-mode acceptEdits ...`. The config is found as usual. Pass a config path in the request only when the config is in neither default location.

## CLI reference

The Skill runs these commands for you, and you can also run them yourself. Every command finds the config as described in [Config file](#config-file). Add `--config <path>` to use another file.

- `sac-planner validate <plan>`: validate a plan file and print `OK <hash>`.
- `sac-planner show <plan>`: render every issue without contacting GitHub, then print the plan hash.
- `sac-planner approve <plan> --hash <h>`: record approval of a shown hash.
- `sac-planner publish <plan> --approve-hash <h>`: publish one issue per repo using the approved plan.
- `sac-planner state <plan>`: print the saved publish state.
- `sac-planner schema`: print the plan JSON Schema.
- `sac-planner catalog [--json]`: print the configured repo catalog, or `no catalog configured`.
- `sac-planner save [--file <path>]`: read plan JSON from <path> or stdin, validate it, and store it as `.sac-planner/<changesetId>/plan.json`.
- `sac-planner session start|end`: mark the plan session active (with the current time) or done; the Skill's guard hook reads this marker.

## Approval flow

1. The Skill saves and validates the plan with `sac-planner save --file .sac-planner/draft.json`, which stores it as `.sac-planner/<changesetId>/plan.json`.
2. `sac-planner show <plan>` renders every issue without contacting GitHub, then prints the plan hash.
3. You review the issues and reply with an explicit approval.
4. The Skill runs `sac-planner publish <plan> --approve-hash <hash>`, using the hash shown in step 2.

Any edit to the plan changes its hash, and the earlier approval no longer applies. Validate and show the plan again, then approve the new hash.

If publishing stops part way, re-run the same `publish` command to resume. Already created issues are not created twice. To inspect the saved publish state, run `sac-planner state <plan>`.

## Troubleshooting

- `sac-planner: command not found`: install the CLI with `npm i -g superagent-claude-planner`, then restart Claude Code so that it sees the new `PATH`.
- Exit code 2 with `no config found`: create `~/.config/sac-planner/config.json` as shown in [Config file](#config-file).
- Exit code 1: the plan is invalid or publishing was refused. Read the `path: message` lines, fix the plan, and validate again. For a refused publish, check the approval hash and the planner identity.
- Exit code 2: a usage or config error. Check the command arguments, the config file, the token variable, and the catalog file. The error message names the file involved.
- Exit code 3: a GitHub failure. Check network access, token scope, and repository access, then re-run the same `publish` command to resume.
- Issues were created but the agent does nothing: check that the agent is running, that its policy.acceptMode is auto, that the repository is in its repositories, and that the planner account is in its policy.allowed. Each issue starts with the agent mention; new work starts only from that mention.
