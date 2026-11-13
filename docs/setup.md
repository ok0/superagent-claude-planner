# Setup

This guide covers the planner account, the token, the agent requirements, the config file, the optional repo catalog, plugin installation, the approval flow, and troubleshooting.

## Planner machine account

Create a dedicated GitHub account of type **User** (not a bot or GitHub App). It is used only to author the planning issues. The account must differ from the agent account named in `agent.login`.

## Token

Create a personal access token (PAT) for the planner account with issue write access on the target repositories. Export it as `PLANNER_GITHUB_TOKEN`, or under the name set in `github.tokenEnv`:

```sh
export PLANNER_GITHUB_TOKEN=<token>
```

Never put the token in a file. The guard hook blocks Bash commands that reference the token variable.

## Agent requirements

- The planner account must differ from `agent.login`.
- The planner account must be listed in the agent's allowed issue authors (`policy.allowed`). Otherwise the agent ignores the issues.
- `sac-planner publish` checks that the token belongs to a User account whose login differs from `agent.login`. It refuses to publish otherwise.

## Config file

The CLI reads the config from the first source that applies, in this order:

1. `--config <path>`
2. `$SAC_PLANNER_CONFIG`
3. `./sac-planner.config.json` in the current directory
4. `~/.config/sac-planner/config.json`

Start from `sac-planner.config.example.json` and fill in the placeholders:

```json
{
  "agent": { "kind": "superagent-claude", "login": "<agent-login>" },
  "github": {
    "tokenEnv": "PLANNER_GITHUB_TOKEN",
    "apiBaseUrl": "https://github.example.com/api/v3"
  },
  "catalog": "catalog.json"
}
```

- `agent.login` is required. It is the GitHub login of the agent account that is mentioned in each issue.
- `github.tokenEnv` is optional. It names the environment variable that holds the planner token. The default is `PLANNER_GITHUB_TOKEN`.
- `github.apiBaseUrl` is optional. Set it only for a GitHub Enterprise Server host. Omit it for github.com.
- `catalog` is optional. It is a path to the catalog file, relative to the config file. Omit it to use direct mode (see below).

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

From the root of this repository:

```sh
pnpm install && pnpm build
claude plugin marketplace add <path to this repo>
claude plugin install superagent-claude-planner@sac-planner-local
```

To load the plugin for one session without installing it, run:

```sh
claude --plugin-dir <path to this repo>
```

Then invoke the Skill with your change request:

```
/superagent-claude-planner:plan <request>
```

## Approval flow

1. The Skill writes and validates the plan with `sac-planner validate <plan>`.
2. `sac-planner show <plan>` renders every issue without contacting GitHub, then prints the plan hash.
3. You review the issues and reply with an explicit approval.
4. The Skill runs `sac-planner publish <plan> --approve-hash <hash>`, using the hash shown in step 2.

Any edit to the plan changes its hash, and the earlier approval no longer applies. Validate and show the plan again, then approve the new hash.

If publishing stops part way, re-run the same `publish` command to resume. Already created issues are not created twice. To inspect the saved publish state, run `sac-planner state <plan>`.

## Troubleshooting

- Exit code 1: the plan is invalid or publishing was refused. Read the `path: message` lines, fix the plan, and validate again. For a refused publish, check the approval hash and the planner identity.
- Exit code 2: a usage or config error. Check the command arguments, the config file, the token variable, and the catalog file. The error message names the file involved.
- Exit code 3: a GitHub failure. Check network access, token scope, and repository access, then re-run the same `publish` command to resume.
