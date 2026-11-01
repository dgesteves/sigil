// Blocks `rm -rf /`. Reads the Claude Code hook payload from stdin.
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const cmd = JSON.parse(input).tool_input?.command ?? ''
  if (/rm\s+-rf\s+\/(\s|$)/.test(cmd)) {
    process.stderr.write('blocked by demo/guard')
    process.exit(2)
  }
})
