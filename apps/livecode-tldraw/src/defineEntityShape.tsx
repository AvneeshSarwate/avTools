import type { ReactNode } from "react";
import {
  BaseBoxShapeUtil,
  createShapeId,
  type Editor,
  HTMLContainer,
  type RecordProps,
  T,
  type TLBaseBoxShape,
  type TLBaseShape,
  type TLShapeId,
  useEditor,
} from "tldraw";

/**
 * The props every entity-bound project shape carries. `entityType` and
 * `entityName` are the view's binding: they are what project persistence
 * saves, what Duplicate rebinds to the cloned entity, and what the shape's
 * component reads. Anything else the shape needs is `Extra`.
 */
export interface EntityShapeBaseProps {
  w: number;
  h: number;
  entityType: string;
  entityName: string;
}

export type EntityShape<Extra extends object = Record<never, never>> =
  TLBaseShape<string, EntityShapeBaseProps & Extra>;

export interface EntityShapeComponentProps<
  Extra extends object = Record<never, never>,
> {
  shape: EntityShape<Extra>;
  entityType: string;
  entityName: string;
  editor: Editor;
}

export interface EntityShapeConfig<Extra extends object = Record<never, never>> {
  /** The tldraw shape type; unique across the app's built-ins and the project. */
  type: string;
  /** The durable entity kind this view binds to, e.g. "params". */
  entityType: string;
  defaultSize?: { w: number; h: number };
  defaultEntityName?: string;
  /** tldraw validators for `Extra`, one per key, with their defaults. */
  props?: { [K in keyof Extra]: T.Validatable<Extra[K]> };
  defaultProps?: Extra;
  canResize?: boolean;
  component: (props: EntityShapeComponentProps<Extra>) => ReactNode;
}

const DEFAULT_SIZE = { w: 320, h: 200 };

/**
 * Build a tldraw `ShapeUtil` for a view bound to one named entity. The
 * factory owns the ceremony (validators, defaults, geometry, indicator, the
 * container that keeps pointer events inside the shape); the caller owns the
 * component. The component runs inside tldraw's tree, so every `@livecode-ui`
 * hook and `useEditor` work in it.
 */
export function defineEntityShape<Extra extends object = Record<never, never>>(
  config: EntityShapeConfig<Extra>,
) {
  type Shape = EntityShape<Extra>;
  const size = config.defaultSize ?? DEFAULT_SIZE;
  const Component = config.component;
  const extraValidators = (config.props ?? {}) as Record<string, T.Validatable<unknown>>;
  const extraDefaults = (config.defaultProps ?? {}) as Extra;

  function EntityShapeView({ shape }: { shape: Shape }) {
    const editor = useEditor();
    return (
      <HTMLContainer
        className="project-entity-shape"
        style={{ width: shape.props.w, height: shape.props.h }}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <Component
          shape={shape}
          entityType={shape.props.entityType}
          entityName={shape.props.entityName}
          editor={editor}
        />
      </HTMLContainer>
    );
  }

  // tldraw types every shape as a member of its global props map, which a
  // project-defined type is not part of; the util is typed against the box
  // base and the component sees the precise shape.
  class EntityShapeUtil extends BaseBoxShapeUtil<TLBaseBoxShape> {
    static override type = config.type as TLBaseBoxShape["type"];
    static override props = {
      w: T.number,
      h: T.number,
      entityType: T.string,
      entityName: T.string,
      ...extraValidators,
    } as unknown as RecordProps<TLBaseBoxShape>;

    override canScroll(): boolean {
      return true;
    }

    override canEdit(): boolean {
      return true;
    }

    override canResize(): boolean {
      return config.canResize ?? true;
    }

    override getDefaultProps(): TLBaseBoxShape["props"] {
      return {
        w: size.w,
        h: size.h,
        entityType: config.entityType,
        entityName: config.defaultEntityName ?? "",
        ...extraDefaults,
      } as unknown as TLBaseBoxShape["props"];
    }

    override component(shape: TLBaseBoxShape) {
      return <EntityShapeView shape={shape as unknown as Shape} />;
    }

    override getIndicatorPath(shape: TLBaseBoxShape) {
      const path = new Path2D();
      path.rect(0, 0, shape.props.w, shape.props.h);
      return path;
    }
  }

  return EntityShapeUtil;
}

/** True for a shape built by `defineEntityShape`: it carries the binding props. */
export function isEntityShape(value: unknown): value is EntityShape {
  if (!value || typeof value !== "object") return false;
  const props = (value as { props?: unknown }).props;
  return Boolean(
    props && typeof props === "object" &&
      typeof (props as EntityShapeBaseProps).entityType === "string" &&
      typeof (props as EntityShapeBaseProps).entityName === "string" &&
      typeof (props as EntityShapeBaseProps).w === "number" &&
      typeof (props as EntityShapeBaseProps).h === "number",
  );
}

/** Create a project entity shape of `type` bound to `entityName`. */
export function createEntityShape(
  editor: Editor,
  type: string,
  options: {
    entityName: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    id?: TLShapeId;
    props?: Record<string, unknown>;
  },
): TLShapeId {
  const id = options.id ?? createShapeId();
  const { entityName, x, y, w, h, props } = options;
  const shapeProps = {
    ...(props ?? {}),
    entityName,
    ...(w !== undefined ? { w } : {}),
    ...(h !== undefined ? { h } : {}),
  };
  editor.createShape({
    id,
    type: type as TLBaseBoxShape["type"],
    x: x ?? 0,
    y: y ?? 0,
    props: shapeProps as Partial<TLBaseBoxShape["props"]>,
  });
  return id;
}
