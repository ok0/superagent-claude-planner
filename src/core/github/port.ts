export type IssueRef = { repo: string; number: number; url: string }

export type HostIdentity = { login: string; type: string }
export type FoundIssue = IssueRef & { body: string }

/**
 * Implementations throw `GitHubError` on host failure.
 * `findIssueByMarker` scans all states, all pages, skips pull requests, and matches `body.includes(marker)`.
 */
export interface IssueHost {
  whoami(): Promise<HostIdentity>
  createIssue(repo: string, input: { title: string; body: string }): Promise<IssueRef>
  updateIssueBody(repo: string, number: number, body: string): Promise<void>
  findIssueByMarker(repo: string, marker: string, creator: string): Promise<FoundIssue | null>
}
