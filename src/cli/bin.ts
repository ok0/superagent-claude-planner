import { main } from './main.ts'

main(process.argv.slice(2), {
  out: s => {
    process.stdout.write(s)
  },
  err: s => {
    process.stderr.write(s)
  },
  cwd: process.cwd(),
  env: process.env,
  readStdin: async () => {
    process.stdin.setEncoding('utf8')
    let s = ''
    for await (const chunk of process.stdin) s += chunk
    return s
  },
}).then(
  code => {
    process.exitCode = code
  },
  (e: unknown) => {
    process.stderr.write('sac-planner: ' + String(e) + '\n')
    process.exitCode = 1
  },
)
