// Spike: injecting baseUrl + request.fetch routes @octokit/rest 22.0.1 requests to the stub: CONFIRMED
import { Octokit } from '@octokit/rest'
import { describe, expect, it } from 'vitest'
import { createGitHubStub } from './support/github-stub.ts'

const SENTINEL = 'sentinel-token-7f3a9c'

describe('octokit spike', () => {
  it('Octokit routes requests to injected baseUrl and fetch', async () => {
    const stub = createGitHubStub({
      'GET /user': () => ({ status: 200, body: { login: 'planner-user', type: 'User' } }),
    })
    const octokit = new Octokit({ auth: SENTINEL, baseUrl: stub.baseUrl, request: { fetch: stub.fetch } })
    const { data } = await octokit.rest.users.getAuthenticated()
    expect(data.login).toBe('planner-user')
    expect(stub.requests.length).toBe(1)
    expect(stub.requests[0]?.url.href).toBe(stub.baseUrl + '/user')
    expect(stub.requests[0]?.headers['authorization']).toContain(SENTINEL)
  })
})
