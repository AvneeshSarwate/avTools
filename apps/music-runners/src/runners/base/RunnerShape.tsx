// The base runner instance shape. One tldraw shape type per runner
// definition is produced by defineRunnerShape; the view is
// RunnerInstanceView.tsx (kept apart so that file Fast Refreshes).
import {
  BaseBoxShapeUtil,
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  type RecordProps,
  T,
  type TLBaseBoxShape,
} from "tldraw";
import { clockStore } from "../../store/clock";
import { runnerShapeType } from "../registry";
import type { RunnerDefinition } from "../runnerTypes";
import { defaultInstanceProps, type RunnerShape } from "./instanceProps";
import { RunnerInstanceView } from "./RunnerInstanceView";

export type { RunnerShape };

export function defineRunnerShape(def: RunnerDefinition) {
  const type = runnerShapeType(def.type);

  function View({ shape }: { shape: RunnerShape }) {
    return <RunnerInstanceView shape={shape} def={def} />;
  }

  const versions = createShapePropsMigrationIds(type, { AddTempo: 1 });
  // Instances saved before per-instance tempo: the project BPM (loaded before
  // the snapshot) as their tempo, and speed back to 1 now that tempo carries
  // the rate.
  const migrations = createShapePropsMigrationSequence({
    sequence: [
      {
        id: versions.AddTempo,
        up: (props: Record<string, unknown>) => {
          props.tempo = clockStore.bpm;
          const params = props.params as Record<string, unknown> | undefined;
          if (params && "speed" in params) params.speed = 1;
        },
        down: (props: Record<string, unknown>) => {
          delete props.tempo;
        },
      },
    ],
  });

  class RunnerShapeUtil extends BaseBoxShapeUtil<TLBaseBoxShape> {
    static override type = type as TLBaseBoxShape["type"];
    static override migrations = migrations;
    static override props = {
      w: T.number,
      h: T.number,
      runnerType: T.string,
      name: T.string,
      midiOutputName: T.string,
      midiInputName: T.string,
      midiThru: T.boolean,
      mpe: T.boolean,
      bendRange: T.number,
      autoRoot: T.boolean,
      rootToleranceCents: T.number,
      // Numbers, or a { root, degrees } scale for a scale param
      params: T.dict(T.string, T.jsonValue),
      tempo: T.positiveNumber,
      queued: T.boolean,
      showSource: T.boolean,
      showGenerated: T.boolean,
      showPreview: T.boolean,
    } as unknown as RecordProps<TLBaseBoxShape>;

    override canScroll(): boolean {
      return true;
    }

    override canEdit(): boolean {
      return true;
    }

    override canResize(): boolean {
      return true;
    }

    override isAspectRatioLocked(): boolean {
      return false;
    }

    override getDefaultProps(): TLBaseBoxShape["props"] {
      return defaultInstanceProps(def) as unknown as TLBaseBoxShape["props"];
    }

    override component(shape: TLBaseBoxShape) {
      return <View shape={shape as RunnerShape} />;
    }

    override getIndicatorPath(shape: TLBaseBoxShape) {
      const path = new Path2D();
      path.rect(0, 0, shape.props.w, shape.props.h);
      return path;
    }
  }

  return RunnerShapeUtil;
}
