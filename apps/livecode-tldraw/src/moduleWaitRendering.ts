import type { SourceRange } from '@avtools/livecode-protocol'

export interface ModuleWaitRenderingState {
  manifest: {
    callsites: readonly {
      id: string
      range: SourceRange
    }[]
  } | null
  activeIds: readonly string[]
}

/** Compare only geometry because CodeMirror's wait decorations use only offsets. */
export function equalWaitRangeGeometry(
  previous: readonly SourceRange[],
  next: readonly SourceRange[],
): boolean {
  if (previous.length !== next.length) return false
  return previous.every((range, index) =>
    range.from === next[index].from && range.to === next[index].to
  )
}

/**
 * Project runtime wait state and preserve the prior array when the visible
 * decoration geometry did not change. Unrelated module fields are deliberately
 * absent from this input contract.
 */
export function reconcileActiveWaitRanges(
  previous: SourceRange[] | null,
  moduleState: ModuleWaitRenderingState | null | undefined,
): SourceRange[] {
  if (!moduleState?.manifest) {
    return previous && previous.length === 0 ? previous : []
  }

  const active = new Set(moduleState.activeIds)
  const next = moduleState.manifest.callsites
    .filter((callsite) => active.has(callsite.id))
    .map((callsite) => callsite.range)
  return previous && equalWaitRangeGeometry(previous, next) ? previous : next
}
