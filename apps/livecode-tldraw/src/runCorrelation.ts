export interface RunCorrelation {
  requestPending: boolean
  acknowledgedToken: string | null
}

export interface CorrelatedRun {
  state: 'launching' | 'running' | 'stopped' | 'error'
  runToken: string
}

export function createRunCorrelation(): RunCorrelation {
  return { requestPending: false, acknowledgedToken: null }
}

export function beginRunLaunch(correlation: RunCorrelation): void {
  correlation.requestPending = true
  correlation.acknowledgedToken = null
}

export function acknowledgeRunLaunch(correlation: RunCorrelation, runToken: string): void {
  correlation.requestPending = false
  correlation.acknowledgedToken = runToken
}

export function rejectRunLaunch(correlation: RunCorrelation): void {
  correlation.requestPending = false
  correlation.acknowledgedToken = null
}

export function shouldApplyRun(correlation: RunCorrelation, run: CorrelatedRun): boolean {
  const terminal = run.state === 'stopped' || run.state === 'error'
  if (correlation.requestPending && terminal) return false

  const acknowledgedToken = correlation.acknowledgedToken
  if (acknowledgedToken && run.runToken !== acknowledgedToken) return false
  if (run.runToken === acknowledgedToken) {
    correlation.acknowledgedToken = null
  }
  return true
}
