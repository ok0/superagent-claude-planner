import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { checkCoreImports, runHygiene, stripAllowed, stripRepoMeta } from '../scripts/check-hygiene.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NAME_A = 'zz-forbidden-' + 'alpha'
const NAME_B = 'zz-forbidden-' + 'beta'

const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'issuecrew-'))
  made.push(root)
  mkdirSync(join(root, 'src', 'core'), { recursive: true })
  mkdirSync(join(root, 'src', 'cli'), { recursive: true })
  mkdirSync(join(root, 'src', 'adapters'), { recursive: true })
  return root
}

function write(root: string, rel: string, text: string): string {
  const full = join(root, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
  return full
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    outText: () => out.join(''),
    errText: () => err.join(''),
  }
}

describe('hygiene', () => {
  it('deliberate core import of CLI fails', () => {
    const tmp = fixture()
    write(tmp, 'src/cli/main.ts', 'export const main = 1\n')
    write(tmp, 'src/core/bad.ts', "import { main } from '../cli/main.ts'\n")
    expect(checkCoreImports(join(tmp, 'src'))).toHaveLength(1)
    const io = capture()
    expect(runHygiene({ root: tmp, env: {}, files: [], out: io.out, err: io.err })).toBe(1)
    expect(io.errText()).toContain('bad.ts')
  })

  it('core import of the GitHub adapter or an external package fails', () => {
    const tmp = fixture()
    write(tmp, 'src/core/x.ts', "import { createOctokitIssueHost } from '../adapters/github/octokit.ts'\n")
    write(tmp, 'src/core/y.ts', "import { Octokit } from '@octokit/rest'\n")
    expect(checkCoreImports(join(tmp, 'src'))).toHaveLength(2)
  })

  it('names from env are detected in a fixture', () => {
    const tmp = fixture()
    const f = write(tmp, 'f.txt', `see ${NAME_A.toUpperCase()} here\n`)
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: ` ${NAME_A}, ` },
      files: [f],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(1)
    expect(io.errText()).toContain('forbidden name #1')
    const all = (io.outText() + io.errText()).toLowerCase()
    expect(all).not.toContain(NAME_A)
  })

  it('names from the local file are detected', () => {
    const tmp = fixture()
    const nameFile = write(tmp, '.forbidden-names', `# comment\n${NAME_B}\n`)
    const f = write(tmp, 'g.txt', `contains ${NAME_B}\n`)
    const io = capture()
    const code = runHygiene({ root: tmp, env: {}, files: [f, nameFile], out: io.out, err: io.err })
    expect(code).toBe(1)
    expect(io.errText()).toContain('g.txt')
    expect(io.errText()).not.toContain('.forbidden-names')
  })

  it('no source: skipped with notice', () => {
    const tmp = fixture()
    const io = capture()
    expect(runHygiene({ root: tmp, env: {}, files: [], out: io.out, err: io.err })).toBe(0)
    expect(io.outText()).toContain('forbidden-name check skipped')
  })

  it('repository passes hygiene', () => {
    const io = capture()
    expect(runHygiene({ root: ROOT, env: process.env, out: io.out, err: io.err })).toBe(0)
  })
})

describe('repo-meta exemption', () => {
  it('repository, homepage and bugs in root package.json are exempt', () => {
    const tmp = fixture()
    const pkg = write(
      tmp,
      'package.json',
      JSON.stringify({
        name: 'x',
        repository: { type: 'git', url: 'https://h.example/' + NAME_A + '/x.git' },
        homepage: 'https://h.example/' + NAME_A,
        bugs: { url: 'https://h.example/' + NAME_A + '/issues' },
      }),
    )
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [pkg],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(0)
  })

  it('forbidden name in another package.json field fails', () => {
    const tmp = fixture()
    const pkg = write(
      tmp,
      'package.json',
      JSON.stringify({
        name: 'x',
        description: NAME_A,
        repository: { type: 'git', url: 'https://h.example/' + NAME_A + '/x.git' },
        homepage: 'https://h.example/' + NAME_A,
        bugs: { url: 'https://h.example/' + NAME_A + '/issues' },
      }),
    )
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [pkg],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(1)
    expect(io.errText()).toContain('forbidden name #1')
  })

  it('nested package.json gets no exemption', () => {
    const tmp = fixture()
    const pkg = write(
      tmp,
      'fixtures/x/package.json',
      JSON.stringify({ name: 'x', repository: { type: 'git', url: 'https://h.example/' + NAME_A + '/x.git' } }),
    )
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [pkg],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(1)
  })

  it('stripRepoMeta leaves invalid JSON unchanged', () => {
    const input = 'not json ' + NAME_A
    expect(stripRepoMeta(input)).toBe(input)
    expect(stripRepoMeta('{"homepage":"a","name":"b"}')).toBe('{"name":"b"}')
  })
})

describe('allow file', () => {
  it('exact allowed URL forms are exempt', () => {
    const tmp = fixture()
    const allowFile = write(
      tmp,
      '.hygiene-allow',
      '# c\nh.example/' + NAME_A + '/tool-x\nh.example/' + NAME_A + '/tool\n',
    )
    const doc = write(
      tmp,
      'doc.md',
      'https://h.example/' +
        NAME_A +
        '/tool.git https://h.example/' +
        NAME_A +
        '/tool#readme https://h.example/' +
        NAME_A +
        '/tool/issues https://h.example/' +
        NAME_A +
        '/tool-x\n',
    )
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [allowFile, doc],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(0)
  })

  it('allow entry does not exempt longer names or bare names', () => {
    const tmp = fixture()
    const allowFile = write(tmp, '.hygiene-allow', 'h.example/' + NAME_A + '/tool\n')
    const doc = write(tmp, 'doc.md', 'https://h.example/' + NAME_A + '/toolkit\n')
    const io = capture()
    const code = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [allowFile, doc],
      out: io.out,
      err: io.err,
    })
    expect(code).toBe(1)
    const doc2 = write(tmp, 'doc2.md', NAME_A + '\n')
    const io2 = capture()
    const code2 = runHygiene({
      root: tmp,
      env: { ISSUECREW_PLANNER_FORBIDDEN_NAMES: NAME_A },
      files: [allowFile, doc2],
      out: io2.out,
      err: io2.err,
    })
    expect(code2).toBe(1)
    expect(io2.errText()).toContain('forbidden name #1')
  })

  it('stripAllowed removes the longest entry first', () => {
    expect(stripAllowed('a/b-c a/b', ['a/b', 'a/b-c'])).toBe(' ')
  })
})
