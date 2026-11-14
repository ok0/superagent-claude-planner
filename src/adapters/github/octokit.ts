import { Octokit } from '@octokit/rest'
import { GitHubError } from '../../core/errors.ts'
import type { FoundIssue, HostIdentity, IssueHost, IssueRef } from '../../core/github/port.ts'

export type OctokitHostOptions = { token: string; baseUrl?: string; fetch?: typeof fetch }

export const GITHUB_API_VERSION = '2026-03-10'

export function sanitizeError(e: unknown, token: string): GitHubError {
  const err = e as { status?: unknown; response?: unknown } | null
  const status =
    typeof err?.status === 'number' && typeof err?.response === 'object' && err.response !== null
      ? err.status
      : undefined
  let msg = e instanceof Error ? e.message : String(e)
  if (token !== '') {
    msg = msg.split(token).join('[redacted]')
  }
  msg = msg.replace(/authorization["']?\s*[:=]\s*["']?[^"',}\n]*/gi, 'authorization: [redacted]')
  msg = msg.replace(/\b(token|bearer)\s+[A-Za-z0-9_\-.]+/gi, '$1 [redacted]')
  return new GitHubError(status, msg)
}

function split(repo: string): { owner: string; repo: string } {
  const [owner = '', name = ''] = repo.split('/')
  return { owner, repo: name }
}

export function createOctokitIssueHost(opts: OctokitHostOptions): IssueHost {
  const octokit = new Octokit({
    auth: opts.token,
    userAgent: 'issuecrew-planner',
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetch ? { request: { fetch: opts.fetch } } : {}),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  })
  octokit.hook.before('request', options => {
    options.headers['x-github-api-version'] = GITHUB_API_VERSION
  })

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw sanitizeError(e, opts.token)
    }
  }

  return {
    whoami(): Promise<HostIdentity> {
      return guard(async () => {
        const { data } = await octokit.rest.users.getAuthenticated()
        return { login: data.login, type: data.type }
      })
    },
    createIssue(repo: string, input: { title: string; body: string }): Promise<IssueRef> {
      return guard(async () => {
        const { owner, repo: name } = split(repo)
        const { data } = await octokit.rest.issues.create({ owner, repo: name, title: input.title, body: input.body })
        return { repo, number: data.number, url: data.html_url }
      })
    },
    updateIssueBody(repo: string, number: number, body: string): Promise<void> {
      return guard(async () => {
        const { owner, repo: name } = split(repo)
        await octokit.rest.issues.update({ owner, repo: name, issue_number: number, body })
      })
    },
    findIssueByMarker(repo: string, marker: string, creator: string): Promise<FoundIssue | null> {
      return guard(async () => {
        const { owner, repo: name } = split(repo)
        for await (const page of octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
          owner,
          repo: name,
          creator,
          state: 'all',
          per_page: 100,
        })) {
          for (const issue of page.data) {
            if (issue.pull_request) continue
            const body = issue.body ?? ''
            if (body.includes(marker)) {
              return { repo, number: issue.number, url: issue.html_url, body }
            }
          }
        }
        return null
      })
    },
  }
}
