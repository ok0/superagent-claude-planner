import { GitHubError } from '../../src/core/errors.ts'
import type { FoundIssue, HostIdentity, IssueHost, IssueRef } from '../../src/core/github/port.ts'

type StoredIssue = { number: number; title: string; body: string; creator: string }

function issueUrl(repo: string, number: number): string {
  return `https://example.test/${repo}/issues/${number}`
}

export class FakeIssueHost implements IssueHost {
  readonly login: string
  readonly type: string
  failOnCreate: number | undefined
  readonly issues = new Map<string, StoredIssue[]>()
  calls = 0
  createCalls = 0
  updateCalls = 0
  writeCalls = 0

  constructor(opts: { login: string; type?: string; failOnCreate?: number }) {
    this.login = opts.login
    this.type = opts.type ?? 'User'
    this.failOnCreate = opts.failOnCreate
  }

  async whoami(): Promise<HostIdentity> {
    this.calls++
    return { login: this.login, type: this.type }
  }

  async createIssue(repo: string, input: { title: string; body: string }): Promise<IssueRef> {
    this.calls++
    this.createCalls++
    if (this.createCalls === this.failOnCreate) {
      throw new GitHubError(502, 'simulated create failure')
    }
    this.writeCalls++
    return this.store(repo, input.title, input.body, this.login)
  }

  async updateIssueBody(repo: string, number: number, body: string): Promise<void> {
    this.calls++
    this.updateCalls++
    this.writeCalls++
    const issue = (this.issues.get(repo) ?? []).find(i => i.number === number)
    if (issue === undefined) {
      throw new GitHubError(404, 'not found')
    }
    issue.body = body
  }

  async findIssueByMarker(repo: string, marker: string, creator: string): Promise<FoundIssue | null> {
    this.calls++
    const issue = (this.issues.get(repo) ?? []).find(i => i.creator === creator && i.body.includes(marker))
    if (issue === undefined) {
      return null
    }
    return { repo, number: issue.number, url: issueUrl(repo, issue.number), body: issue.body }
  }

  seed(repo: string, input: { title: string; body: string; creator?: string }): IssueRef {
    return this.store(repo, input.title, input.body, input.creator ?? this.login)
  }

  bodies(): string[] {
    return [...this.issues.values()].flat().map(i => i.body)
  }

  private store(repo: string, title: string, body: string, creator: string): IssueRef {
    const list = this.issues.get(repo) ?? []
    const number = list.length + 1
    list.push({ number, title, body, creator })
    this.issues.set(repo, list)
    return { repo, number, url: issueUrl(repo, number) }
  }
}
