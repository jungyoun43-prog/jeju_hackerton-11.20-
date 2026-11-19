export function pythonCli(env = process.env) {
  return env.PYTHON_CLI || (process.platform === 'win32' ? 'python.exe' : 'python3');
}
