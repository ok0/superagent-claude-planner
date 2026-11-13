import { describe, expect, it } from 'vitest'
import { GitHubError } from '../src/core/errors.ts'
import { createOctokitIssueHost } from '../src/adapters/github/octokit.ts'
import { createGitHubStub } from './support/github-stub.ts'
import type { StubRequest } from './support/github-stub.ts'

const SENTINEL = 'sentinel-token-7f3a9c'
const BASE_URL = 'http://github-stub.test'

describe('octokit host adapter', () => {
  it('whoami maps GET /user', async () => {
    const stub = createGitHubStub({
      'GET /user': () => ({ status: 200, body: { login: 'planner-user', type: 'User' } }),
    })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })
    expect(await host.whoami()).toEqual({ login: 'planner-user', type: 'User' })
    expect(stub.requests[0]?.headers['authorization']).toContain(SENTINEL)
  })

  it('createIssue maps POST /repos/{o}/{r}/issues', async () => {
    const stub = createGitHubStub({
      'POST /repos/example-org/alpha/issues': () => ({
        status: 201,
        body: { number: 7, html_url: 'https://example.test/example-org/alpha/issues/7' },
      }),
    })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })
    const result = await host.createIssue('example-org/alpha', { title: 'T', body: 'B' })
    expect(result).toEqual({
      repo: 'example-org/alpha',
      number: 7,
      url: 'https://example.test/example-org/alpha/issues/7',
    })
    expect(stub.requests[0]?.body).toEqual({ title: 'T', body: 'B' })
  })

  it('updateIssueBody maps PATCH', async () => {
    const stub = createGitHubStub({
      'PATCH /repos/example-org/alpha/issues/7': () => ({
        status: 200,
        body: { number: 7 },
      }),
    })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })
    await host.updateIssueBody('example-org/alpha', 7, 'new')
    expect(stub.requests[0]?.method).toBe('PATCH')
    expect(stub.requests[0]?.body).toEqual({ body: 'new' })
  })

  it('findIssueByMarker paginates, filters creator/state and skips PRs', async () => {
    const pageRoute = (req: StubRequest) => {
      if (req.url.searchParams.get('page') === '2') {
        return { status: 200, body: [{ number: 3, body: 'pre M post', html_url: 'https://example.test/3' }] }
      }
      return {
        status: 200,
        body: [
          { number: 1, body: 'x', html_url: 'https://example.test/1' },
          { number: 2, body: 'M', pull_request: {}, html_url: 'https://example.test/2' },
        ],
        headers: {
          link: `<${BASE_URL}/repos/example-org/alpha/issues?page=2&per_page=100&creator=planner-user&state=all>; rel="next"`,
        },
      }
    }
    const stub = createGitHubStub({ 'GET /repos/example-org/alpha/issues': pageRoute })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })

    const found = await host.findIssueByMarker('example-org/alpha', 'M', 'planner-user')
    expect(found).toEqual({
      repo: 'example-org/alpha',
      number: 3,
      url: 'https://example.test/3',
      body: 'pre M post',
    })
    expect(stub.requests.length).toBe(2)
    const first = stub.requests[0]
    expect(first?.url.searchParams.get('creator')).toBe('planner-user')
    expect(first?.url.searchParams.get('state')).toBe('all')
    expect(first?.url.searchParams.get('per_page')).toBe('100')
  })

  it('findIssueByMarker returns null when the marker is absent', async () => {
    const stub = createGitHubStub({
      'GET /repos/example-org/alpha/issues': () => ({
        status: 200,
        body: [{ number: 1, body: 'x', html_url: 'https://example.test/1' }],
      }),
    })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })
    expect(await host.findIssueByMarker('example-org/alpha', 'absent', 'planner-user')).toBeNull()
  })

  it('errors are GitHubError with token and authorization removed', async () => {
    const stub = createGitHubStub({
      'GET /user': () => ({
        status: 401,
        body: { message: `Bad credentials ${SENTINEL} authorization: token ${SENTINEL}` },
      }),
    })
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: stub.baseUrl, fetch: stub.fetch })
    const err = await host.whoami().then(
      () => {
        throw new Error('expected rejection')
      },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(GitHubError)
    expect((err as GitHubError).status).toBe(401)
    expect(String(err)).not.toContain(SENTINEL)
    expect((err as Error).message).not.toContain(SENTINEL)
    expect(JSON.stringify(err)).not.toContain(SENTINEL)
    expect((err as Error).stack ?? '').not.toContain(SENTINEL)
    expect((err as Error).cause).toBeUndefined()
  })

  it('network failure yields GitHubError without status and without token', async () => {
    const failingFetch = (async () => {
      throw new Error('connect failed ' + SENTINEL)
    }) as unknown as typeof fetch
    const host = createOctokitIssueHost({ token: SENTINEL, baseUrl: 'http://github-stub.test', fetch: failingFetch })
    const err = await host.whoami().then(
      () => {
        throw new Error('expected rejection')
      },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(GitHubError)
    expect((err as GitHubError).status).toBeUndefined()
    expect(String(err)).not.toContain(SENTINEL)
    expect((err as Error).message).not.toContain(SENTINEL)
  })
})
