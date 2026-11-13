export type StubRequest = { method: string; url: URL; headers: Record<string, string>; body: unknown }
export type StubResponse = { status: number; body?: unknown; headers?: Record<string, string> }
export type StubRoute = (req: StubRequest) => StubResponse

const BASE_URL = 'http://github-stub.test'

export function createGitHubStub(routes: Record<string, StubRoute>): {
  baseUrl: string
  fetch: typeof fetch
  requests: StubRequest[]
} {
  const requests: StubRequest[] = []

  const stubFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = Object.fromEntries(
      new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).entries(),
    )
    const rawBody = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : ''
    const body: unknown = rawBody === '' ? undefined : JSON.parse(rawBody)
    const req: StubRequest = { method, url, headers, body }
    requests.push(req)

    const route = routes[`${method} ${url.pathname}`]
    const res: StubResponse = route ? route(req) : { status: 404, body: { message: 'Not Found' } }
    const responseHeaders = { 'content-type': 'application/json', ...(res.headers ?? {}) }
    if (res.status === 204) {
      return new Response(null, { status: 204, headers: responseHeaders })
    }
    return new Response(JSON.stringify(res.body ?? null), { status: res.status, headers: responseHeaders })
  }

  return { baseUrl: BASE_URL, fetch: stubFetch as typeof fetch, requests }
}
