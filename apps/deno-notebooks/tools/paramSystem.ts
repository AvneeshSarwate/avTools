import type { WindowTweakpane, PaneBinding, PaneFolder } from '../window/mod.ts'
import type {
  TrackInput,
  TrackCallbacks,
  TrackData,
  NumberElement,
  EnumElement,
  FuncElementData,
} from './animationEditorWebSocketClient.ts'
import type { TrackMap } from './animationEditorAdapter.ts'

export interface BaseParamDef<TValue> {
  value: TValue
  label?: string
}

export interface NumberParamDef extends BaseParamDef<number> {
  min: number
  max: number
  step?: number
}

export interface BooleanParamDef extends BaseParamDef<boolean> {}

export interface StringParamDef extends BaseParamDef<string> {
  options: Record<string, string>
}

export interface ActionDef {
  action: () => void
  label?: string
}

export type ParamDef = NumberParamDef | BooleanParamDef | StringParamDef

export interface ParamDefFolder {
  _folder: string
  _actions?: Record<string, ActionDef>
  [key: string]: ParamDef | ParamDefFolder | Record<string, ActionDef> | string | undefined
}

export type ParamDefs = Record<string, ParamDef | ParamDefFolder>

export type ParamValue = number | boolean | string

type PaneContainer = WindowTweakpane | PaneFolder

const SNAPSHOT_TIME_EPS = 1e-6

export interface BuiltParamSystem {
  readonly params: Record<string, ParamValue>
  readonly trackInputs: TrackInput[]
  readonly paramMeta: Map<string, ParamDef>
  readonly actionMap: Map<string, () => void>
  setupPane(pane: WindowTweakpane): Map<string, PaneBinding>
}

function isParamFolder(value: unknown): value is ParamDefFolder {
  return typeof value === 'object' && value !== null && '_folder' in value
}

function isParamDef(value: unknown): value is ParamDef {
  return typeof value === 'object' && value !== null && 'value' in value
}

function isNumberParamDef(def: ParamDef): def is NumberParamDef {
  return typeof def.value === 'number'
}

function isBooleanParamDef(def: ParamDef): def is BooleanParamDef {
  return typeof def.value === 'boolean'
}

function isStringParamDef(def: ParamDef): def is StringParamDef {
  return typeof def.value === 'string'
}

function cloneTrackElement(
  element: TrackData['elementData'][number],
): TrackData['elementData'][number] {
  const rawValue = (element as { value: unknown }).value

  if (typeof rawValue === 'object' && rawValue !== null && 'funcName' in rawValue) {
    const funcElement = element as FuncElementData
    return {
      id: funcElement.id,
      time: funcElement.time,
      value: {
        funcName: funcElement.value.funcName,
        args: [...funcElement.value.args],
      },
    }
  }

  if (typeof (element as NumberElement).value === 'number') {
    const numberElement = element as NumberElement
    return { id: numberElement.id, time: numberElement.time, value: numberElement.value }
  }

  const enumElement = element as EnumElement
  return { id: enumElement.id, time: enumElement.time, value: enumElement.value }
}

function buildTrackInput(name: string, def: ParamDef): TrackInput {
  if (isNumberParamDef(def)) {
    if (!Number.isFinite(def.min) || !Number.isFinite(def.max)) {
      throw new Error(`Number param "${name}" must define finite min/max bounds`)
    }

    return {
      name,
      fieldType: 'number',
      data: [],
      low: def.min,
      high: def.max,
    }
  }

  if (isBooleanParamDef(def)) {
    return {
      name,
      fieldType: 'enum',
      data: [],
      enumOptions: ['true', 'false'],
    }
  }

  if (isStringParamDef(def)) {
    return {
      name,
      fieldType: 'enum',
      data: [],
      enumOptions: Object.values(def.options),
    }
  }

  throw new Error(`Unsupported param definition for "${name}"`)
}

function insertOrUpdateElementAtTime(
  track: TrackData,
  time: number,
  value: number | string,
): TrackData {
  const elementData = track.elementData.map(cloneTrackElement)
  const existingIndex = elementData.findIndex((element) => Math.abs(element.time - time) < SNAPSHOT_TIME_EPS)

  if (track.fieldType === 'number') {
    const nextElement: NumberElement = existingIndex >= 0
      ? { ...(elementData[existingIndex] as NumberElement), time, value: value as number }
      : { id: generateSnapshotElementId(), time, value: value as number }

    if (existingIndex >= 0) {
      elementData[existingIndex] = nextElement
    } else {
      elementData.push(nextElement)
    }
  } else if (track.fieldType === 'enum') {
    const nextElement: EnumElement = existingIndex >= 0
      ? { ...(elementData[existingIndex] as EnumElement), time, value: String(value) }
      : { id: generateSnapshotElementId(), time, value: String(value) }

    if (existingIndex >= 0) {
      elementData[existingIndex] = nextElement
    } else {
      elementData.push(nextElement)
    }
  } else {
    return {
      ...track,
      elementData,
    }
  }

  elementData.sort((a, b) => a.time - b.time)

  return {
    ...track,
    elementData,
  }
}

function generateSnapshotElementId(): string {
  return `snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function buildParamSystem(paramDefs: ParamDefs): BuiltParamSystem {
  const params: Record<string, ParamValue> = {}
  const trackInputs: TrackInput[] = []
  const paramMeta = new Map<string, ParamDef>()
  const actionMap = new Map<string, () => void>()

  const registerParam = (name: string, def: ParamDef) => {
    if (paramMeta.has(name) || actionMap.has(name)) {
      throw new Error(`Duplicate flat param key "${name}"`)
    }

    params[name] = def.value
    paramMeta.set(name, def)
    trackInputs.push(buildTrackInput(name, def))
  }

  const registerAction = (name: string, def: ActionDef) => {
    if (paramMeta.has(name) || actionMap.has(name)) {
      throw new Error(`Duplicate flat param key "${name}"`)
    }

    actionMap.set(name, def.action)
    trackInputs.push({
      name,
      fieldType: 'func',
      data: [],
    })
  }

  const walkDefs = (defs: ParamDefs) => {
    for (const [key, node] of Object.entries(defs)) {
      if (isParamFolder(node)) {
        for (const [childKey, childValue] of Object.entries(node)) {
          if (childKey === '_folder') continue
          if (childKey === '_actions') {
            for (const [actionKey, actionDef] of Object.entries(childValue ?? {})) {
              registerAction(actionKey, actionDef as ActionDef)
            }
            continue
          }

          if (!childValue) continue
          if (isParamFolder(childValue)) {
            walkDefs({ [childKey]: childValue })
            continue
          }

          if (!isParamDef(childValue)) {
            throw new Error(`Invalid param definition for "${childKey}"`)
          }

          registerParam(childKey, childValue)
        }
        continue
      }

      if (!isParamDef(node)) {
        throw new Error(`Invalid param definition for "${key}"`)
      }

      registerParam(key, node)
    }
  }

  walkDefs(paramDefs)

  const setupPane = (pane: WindowTweakpane): Map<string, PaneBinding> => {
    const bindings = new Map<string, PaneBinding>()

    const addBinding = (container: PaneContainer, key: string, def: ParamDef) => {
      let binding: PaneBinding

      if (isNumberParamDef(def)) {
        binding = container.addBinding(params, key, {
          min: def.min,
          max: def.max,
          step: def.step,
          label: def.label,
        })
      } else if (isStringParamDef(def)) {
        binding = container.addBinding(params, key, {
          options: def.options,
          label: def.label,
        })
      } else {
        binding = def.label
          ? container.addBinding(params, key, { label: def.label })
          : container.addBinding(params, key)
      }

      bindings.set(key, binding)
    }

    const addDefsToPane = (container: PaneContainer, defs: ParamDefs) => {
      for (const [key, node] of Object.entries(defs)) {
        if (isParamFolder(node)) {
          const folder = container.addFolder({ title: node._folder })

          for (const [childKey, childValue] of Object.entries(node)) {
            if (childKey === '_folder') continue

            if (childKey === '_actions') {
              const actions = childValue as Record<string, ActionDef> | undefined
              for (const [actionKey, actionDef] of Object.entries(actions ?? {})) {
                folder.addButton({ title: actionDef.label ?? actionKey }).on('click', actionDef.action)
              }
              continue
            }

            if (!childValue) continue
            if (isParamFolder(childValue)) {
              addDefsToPane(folder, { [childKey]: childValue })
              continue
            }

            if (!isParamDef(childValue)) {
              throw new Error(`Invalid param definition for "${childKey}"`)
            }

            addBinding(folder, childKey, childValue)
          }

          continue
        }

        if (!isParamDef(node)) {
          throw new Error(`Invalid param definition for "${key}"`)
        }

        addBinding(container, key, node)
      }
    }

    addDefsToPane(pane, paramDefs)
    return bindings
  }

  return {
    params,
    trackInputs,
    paramMeta,
    actionMap,
    setupPane,
  }
}

export function createAnimationCallbacks(
  params: Record<string, ParamValue>,
  bindings: Map<string, PaneBinding>,
  paramMeta: Map<string, ParamDef>,
  actionMap: Map<string, () => void>,
  syncRef: { enabled: boolean },
): TrackCallbacks {
  const refreshBinding = (trackName: string) => {
    if (syncRef.enabled) {
      bindings.get(trackName)?.refresh()
    }
  }

  return {
    updateNumber(trackName, value) {
      params[trackName] = value
      refreshBinding(trackName)
    },

    updateEnum(trackName, value) {
      const def = paramMeta.get(trackName)

      if (def && isBooleanParamDef(def)) {
        params[trackName] = value === 'true'
      } else {
        params[trackName] = value
      }

      refreshBinding(trackName)
    },

    updateFunc(_trackName, funcName) {
      actionMap.get(funcName)?.()
    },
  }
}

export function snapshotToAnimation(
  params: Record<string, ParamValue>,
  paramMeta: Map<string, ParamDef>,
  trackMap: TrackMap,
  animationName: string,
  time: number,
): void {
  const animation = trackMap.getFull(animationName)
  if (!animation) return

  const updatedTracks = animation.tracks.map((track) => {
    if (track.fieldType === 'func') {
      return {
        ...track,
        elementData: track.elementData.map(cloneTrackElement),
      }
    }

    const paramDef = paramMeta.get(track.name)
    if (!paramDef) {
      return {
        ...track,
        elementData: track.elementData.map(cloneTrackElement),
      }
    }

    const currentValue = params[track.name]
    if (track.fieldType === 'number') {
      return insertOrUpdateElementAtTime(track, time, Number(currentValue))
    }

    if (isBooleanParamDef(paramDef)) {
      return insertOrUpdateElementAtTime(track, time, currentValue ? 'true' : 'false')
    }

    return insertOrUpdateElementAtTime(track, time, String(currentValue))
  })

  trackMap.set(animationName, updatedTracks, animation.trackOrder)
}
