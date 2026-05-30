export interface SourceRange {
  from: number
  to: number
}

export interface VisualizerDiagnostic extends SourceRange {
  severity: 'error'
  code: string
  message: string
}

export type WaitCallsiteKind = 'timeContextMethod' | 'timeContextArgumentCall'

export interface WaitCallsiteManifestEntry {
  id: string
  moduleId: string
  sourceUri: string
  range: SourceRange
  kind: WaitCallsiteKind
  displayName: string
}

export interface VisualizerManifestMessage {
  type: 'manifest'
  moduleId: string
  sourceVersion: number
  callsites: WaitCallsiteManifestEntry[]
}

export interface AnalyzeSuccess {
  type: 'analyzeSuccess'
  moduleId: string
  sourceVersion: number
  generatedRunId: string
  manifest: VisualizerManifestMessage
  transformedModuleUri: string
  transformedCode?: string
}

export interface AnalyzeFailure {
  type: 'analyzeFailure'
  moduleId: string
  sourceVersion: number
  diagnostics: VisualizerDiagnostic[]
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure

export interface ActiveWaitSnapshot {
  type: 'activeWaitSnapshot'
  seq: number
  timestampMs: number
  modules: Record<string, string[]>
}

export interface HealthResponse {
  ok: true
  serverVersion: string
  sessionRoot: string
  activeModules: string[]
}

export interface HistoryEntry {
  generatedRunId: string
  sourceVersion: number
  callsiteCount: number
  transformedModuleUri: string
}

export interface PreparedBuild extends AnalyzeSuccess {
  sourceText: string
  serverBaseUrl: string
}

export interface PreparedFailure extends AnalyzeFailure {
  sourceText: string
  serverBaseUrl: string
}
