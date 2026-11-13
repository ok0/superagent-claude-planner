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
}).then(
  code => {
    process.exitCode = code
  },
  (e: unknown) => {
    process.stderr.write('sac-planner: ' + String(e) + '\n')
    process.exitCode = 1
  },
)
