// Port of NoteMetadataEditor.vue + MetadataNode.vue: N selected notes viewed as
// one tree whose leaves are shared / mixed / partial / conflict, edited as a
// list of path operations applied to every note in one undo step. The raw JSON
// textarea of the Vue version is dropped: the host supplies its own editor.
import {
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  applyPlan,
  pathKey,
  PATH_KEY_SEPARATOR,
  planEdit,
  summarize,
  type EditOp,
  type EditPlan,
  type GroupNode,
  type JsonObject,
  type Path
} from './groupEdit'
import { validateMetadataValue } from './rules'

// ================= Node =================

interface NodeHandle {
  startAdd(): void
}

interface NodeProps {
  node: GroupNode
  count: number
  depth: number
  pending: Set<string>
  warned: Set<string>
  errors: Map<string, string>
  onSet: (path: Path, value: unknown) => void
  onRemove: (path: Path) => void
}

const formatValue = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const MetadataNode: ForwardRefExoticComponent<NodeProps & RefAttributes<NodeHandle>> = forwardRef<NodeHandle, NodeProps>(function MetadataNodeImpl(
  { node, count, depth, pending, warned, errors, onSet, onRemove },
  ref
) {
  const [collapsed, setCollapsed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const newKeyInput = useRef<HTMLInputElement>(null)

  const key = pathKey(node.path)
  const isRoot = node.path.length === 0
  const state = node.state
  const isObject = state.kind === 'object'
  const isPending = pending.has(key)
  const isWarned = warned.has(key)
  const error = errors.get(key) ?? null
  const isColor = node.path.length === 1 && node.key === 'color'

  const leafValue: unknown = state.kind === 'shared' ? state.value : state.kind === 'partial' ? state.value : undefined

  let badge = ''
  switch (state.kind) {
    case 'object':
      badge = state.have < count ? `${state.have} of ${count}` : ''
      break
    case 'mixed':
      badge = `${state.distinct} values`
      break
    case 'partial':
      badge = `${state.have} of ${count}`
      break
    case 'conflict':
      badge = 'mixed types'
      break
  }

  let placeholder = ''
  if (state.kind === 'mixed') placeholder = 'mixed'
  else if (state.kind === 'partial' && state.value === undefined) placeholder = 'mixed'
  else if (state.kind === 'conflict') placeholder = 'object / value'

  const isBoolean = typeof leafValue === 'boolean'
  const inputText = draft ?? formatValue(leafValue)

  // Text is read as JSON when it parses and as a string otherwise, except that
  // a string leaf stays a string so editing "12" to "123" does not retype it.
  const parseInput = (text: string, current: unknown): unknown => {
    if (typeof current === 'string' && !isColor) return text
    const trimmed = text.trim()
    if (trimmed === '') return ''
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }

  const commitText = () => {
    if (draft === null) return
    const text = draft
    setDraft(null)
    if (text === formatValue(leafValue) && state.kind === 'shared') return
    onSet(node.path, parseInput(text, leafValue))
  }

  const onKeydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitText()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setDraft(null)
      event.currentTarget.blur()
    }
  }

  const startAdd = useCallback(() => {
    setAdding(true)
    setNewKey('')
    setNewValue('')
    setCollapsed(false)
  }, [])

  useEffect(() => {
    if (adding) newKeyInput.current?.focus()
  }, [adding])

  useImperativeHandle(ref, () => ({ startAdd }), [startAdd])

  const commitAdd = () => {
    const name = newKey.trim()
    if (!name) {
      setAdding(false)
      return
    }
    onSet([...node.path, name], parseInput(newValue, undefined))
    setAdding(false)
  }

  const onAddKeydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commitAdd()
    else if (event.key === 'Escape') setAdding(false)
  }

  const colorValue = typeof leafValue === 'string' && /^#[0-9a-f]{6}$/i.test(leafValue) ? leafValue : '#000000'

  let validation: string | null = error
  if (!validation && (isPending || state.kind === 'shared')) {
    validation = validateMetadataValue(node.path, leafValue)
  }

  const childDepth = isRoot ? depth : depth + 1
  const expandable = isObject || state.kind === 'conflict'

  return (
    <div
      className={
        'pr-meta-node' + (isPending ? ' pending' : '') + (isWarned ? ' warned' : '') + (validation ? ' invalid' : '')
      }
    >
      {!isRoot && (
        <div className="pr-meta-row" style={{ paddingLeft: depth * 12 }}>
          {expandable ? (
            <button
              type="button"
              className={'pr-meta-twisty' + (collapsed ? ' collapsed' : '')}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="pr-meta-twisty-space" />
          )}

          <span className="pr-meta-key" title={node.path.join('.')}>
            {node.key}
          </span>

          {isObject ? (
            <span className="pr-meta-obj">{`{ ${node.children.length} }`}</span>
          ) : (
            <>
              {isColor && (
                <input
                  type="color"
                  className="pr-meta-swatch"
                  value={colorValue}
                  onChange={(event) => onSet(node.path, event.target.value)}
                />
              )}
              {isBoolean && state.kind === 'shared' ? (
                <input
                  type="checkbox"
                  className="pr-meta-check"
                  checked={leafValue === true}
                  onChange={(event) => onSet(node.path, event.target.checked)}
                />
              ) : (
                <input
                  className={'pr-meta-value' + (inputText === '' ? ' empty' : '')}
                  value={inputText}
                  placeholder={placeholder}
                  spellCheck={false}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitText}
                  onKeyDown={onKeydown}
                />
              )}
            </>
          )}

          {badge && <span className="pr-meta-badge">{badge}</span>}
          {validation ? (
            <span className="pr-meta-err" title={validation}>
              {validation}
            </span>
          ) : isWarned ? (
            <span className="pr-meta-warn" title="Some selected notes hold a different value here">
              overwrites
            </span>
          ) : null}

          {expandable && (
            <button type="button" className="pr-meta-act" title="Add field" onClick={startAdd}>
              +
            </button>
          )}
          <button type="button" className="pr-meta-act" title="Remove from all selected" onClick={() => onRemove(node.path)}>
            {'×'}
          </button>
        </div>
      )}

      {!collapsed && (
        <>
          {node.children.map((child) => (
            <MetadataNode
              key={child.key}
              node={child}
              count={count}
              depth={childDepth}
              pending={pending}
              warned={warned}
              errors={errors}
              onSet={onSet}
              onRemove={onRemove}
            />
          ))}
          {adding && (
            <div className="pr-meta-row add" style={{ paddingLeft: childDepth * 12 }}>
              <span className="pr-meta-twisty-space" />
              <input
                ref={newKeyInput}
                className="pr-meta-key-input"
                value={newKey}
                placeholder="key"
                spellCheck={false}
                onChange={(event) => setNewKey(event.target.value)}
                onKeyDown={onAddKeydown}
              />
              <input
                className="pr-meta-value"
                value={newValue}
                placeholder="value ({} for object)"
                spellCheck={false}
                onChange={(event) => setNewValue(event.target.value)}
                onKeyDown={onAddKeydown}
              />
              <button type="button" className="pr-meta-act" title="Add" onClick={commitAdd}>
                {'✓'}
              </button>
              <button type="button" className="pr-meta-act" title="Cancel" onClick={() => setAdding(false)}>
                {'×'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
})

// ================= Editor =================

export interface MetadataTreeProps {
  /** One metadata object per selected item; null when nothing is editable. */
  documents: JsonObject[] | null
  emptyText?: string
  onApply: (plan: EditPlan) => void
  onCancel?: () => void
}

export function MetadataTree({ documents, emptyText, onApply, onCancel }: MetadataTreeProps) {
  const canEdit = documents !== null && documents.length > 0
  const summary = useMemo(() => summarize(documents ?? []), [documents])

  // Latest op per path. Preview is the documents with these applied, re-summarized,
  // so added and changed paths appear in the tree as shared leaves.
  const [pendingOps, setPendingOps] = useState<Map<string, EditOp>>(() => new Map())
  const ops = useMemo(() => Array.from(pendingOps.values()), [pendingOps])
  const plan = useMemo(() => planEdit(summary, ops), [summary, ops])
  const preview = useMemo(() => {
    if (ops.length === 0) return summary
    return summarize((documents ?? []).map((doc) => applyPlan(doc, plan) ?? {}))
  }, [documents, ops, plan, summary])
  const pendingKeys = useMemo(() => new Set(ops.map((op) => pathKey(op.path))), [ops])
  const warnedKeys = useMemo(() => new Set(plan.warnings.map((w) => pathKey(w.path))), [plan])

  // Rule violations on pending edits block Save. Pre-existing bad values are
  // shown on their row but never block an unrelated edit.
  const errors = useMemo(() => {
    const out = new Map<string, string>()
    for (const op of ops) {
      if (op.op !== 'set') continue
      const message = validateMetadataValue(op.path, op.value)
      if (message) out.set(pathKey(op.path), message)
    }
    return out
  }, [ops])

  const hasChanges = ops.length > 0
  const warningCount = plan.warnings.length

  // Selection changes reset the draft; incidental re-emits of identical
  // documents (playhead moves, redraws) must not.
  const signature = JSON.stringify(documents)
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    setPendingOps(new Map())
  }, [signature])

  const setValue = useCallback((path: Path, value: unknown) => {
    setPendingOps((prev) => {
      const next = new Map(prev)
      next.set(pathKey(path), { op: 'set', path, value })
      return next
    })
  }, [])

  const removeValue = useCallback(
    (path: Path) => {
      const key = pathKey(path)
      let node: GroupNode | null = summary.root
      let existed = true
      for (const segment of path) {
        node = node.children.find((c) => c.key === segment) ?? null
        if (!node) {
          existed = false
          break
        }
      }
      setPendingOps((prev) => {
        const next = new Map(prev)
        // Drop pending ops at or under the path; a removal of something that only
        // existed as a pending add is just that add withdrawn.
        for (const k of Array.from(next.keys())) {
          if (k === key || k.startsWith(key + PATH_KEY_SEPARATOR)) next.delete(k)
        }
        if (existed) next.set(key, { op: 'remove', path })
        return next
      })
    },
    [summary]
  )

  const save = () => {
    if (!hasChanges || errors.size > 0) return
    onApply(plan)
    setPendingOps(new Map())
  }

  const cancel = () => {
    setPendingOps(new Map())
    onCancel?.()
  }

  const rootNode = useRef<NodeHandle>(null)

  const describeWarning = (w: { path: Path; kind: string; affected: number }) =>
    `${w.path.join('.')}: ${w.kind === 'overwrites' ? 'overwrites' : 'replaces a value in'} ${w.affected} of ${summary.count}`

  return (
    <div className="pr-metadata-editor">
      {canEdit ? (
        <>
          <div className="pr-meta-bar">
            <span className="pr-meta-title">metadata · {summary.count} selected</span>
            {hasChanges && <span className="pr-meta-dirty">{ops.length} pending</span>}
            <span className="pr-meta-spacer" />
            <button type="button" className="pr-meta-btn" title="Add top-level field" onClick={() => rootNode.current?.startAdd()}>
              + field
            </button>
            <button type="button" className="pr-meta-btn" disabled={!hasChanges} onClick={cancel}>
              cancel
            </button>
            <button
              type="button"
              className="pr-meta-btn primary"
              disabled={!hasChanges || errors.size > 0}
              title={errors.size > 0 ? 'Fix invalid values first' : ''}
              onClick={save}
            >
              {warningCount > 0 ? `save anyway (${warningCount})` : 'save'}
            </button>
          </div>

          <div className="pr-meta-tree">
            <MetadataNode
              ref={rootNode}
              node={preview.root}
              count={preview.count}
              depth={0}
              pending={pendingKeys}
              warned={warnedKeys}
              errors={errors}
              onSet={setValue}
              onRemove={removeValue}
            />
            {preview.root.children.length === 0 && <div className="pr-meta-muted pr-meta-pad">no fields</div>}
          </div>

          {plan.warnings.map((w) => (
            <div key={pathKey(w.path) + w.kind} className="pr-meta-line warn">
              {describeWarning(w)}
            </div>
          ))}
        </>
      ) : (
        <div className="pr-meta-muted pr-meta-pad">{emptyText ?? 'Select notes to edit their metadata.'}</div>
      )}
    </div>
  )
}
