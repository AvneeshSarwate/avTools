// Drawn on the canvas (tldraw's `OnTheCanvas` slot, in page space): for each
// connection arrow, its event-type chooser at the arrow's midpoint, and a
// flash along the arrow when an event is sent over it. Store reads go through
// useValue (reactive to arrows and bindings); pulses come from the event bus
// and only touch the DOM, never the tldraw store.
import { useEffect, useRef } from "react";
import { getArrowInfo, type TLArrowShape, type TLShapeId, useEditor, useValue, type Editor } from "tldraw";
import { type Connection, emitsOf, listConnections, setConnectionType } from "../store/connections";
import { onPulse } from "../store/pulses";
import { Chooser } from "./controls/controls";

interface DrawnConnection extends Connection {
  /** Page-space CSS transform of the arrow. */
  transform: string;
  /** Arrow-space SVG path of the body. */
  path: string;
  /** Page-space label point. */
  label: { x: number; y: number };
  emits: string[];
}

function bodyPath(editor: Editor, arrow: TLArrowShape): { path: string; middle: { x: number; y: number } } | null {
  const info = getArrowInfo(editor, arrow);
  if (!info || !info.isValid) return null;
  const a = info.start.point;
  const b = info.end.point;
  if (info.type === "straight") return { path: `M${a.x},${a.y} L${b.x},${b.y}`, middle: info.middle };
  if (info.type === "arc") {
    const arc = info.bodyArc;
    return { path: `M${a.x},${a.y} A${arc.radius},${arc.radius} 0 ${arc.largeArcFlag} ${arc.sweepFlag} ${b.x},${b.y}`, middle: info.middle };
  }
  const points = info.route.points;
  if (points.length < 2) return null;
  // Label point: halfway along the elbow route.
  let remaining = info.route.distance / 2;
  let middle = points[0];
  for (let i = 1; i < points.length; i += 1) {
    const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (step >= remaining) {
      const t = step > 0 ? remaining / step : 0;
      middle = { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t } as typeof middle;
      break;
    }
    remaining -= step;
  }
  return { path: points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" "), middle };
}

export function ConnectionLayer() {
  const editor = useEditor();
  const connections = useValue(
    "runner connections",
    (): DrawnConnection[] =>
      listConnections(editor).flatMap((connection) => {
        const arrow = editor.getShape<TLArrowShape>(connection.arrowId);
        const body = arrow ? bodyPath(editor, arrow) : null;
        if (!arrow || !body) return [];
        const pageTransform = editor.getShapePageTransform(arrow.id);
        return [
          {
            ...connection,
            transform: pageTransform.toCssString(),
            path: body.path,
            label: pageTransform.applyToPoint(body.middle),
            emits: emitsOf(editor, connection.fromId),
          },
        ];
      }),
    [editor],
  );

  // Pulses restart a CSS animation on the arrow's flash path and label.
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onPulse((arrowId) => {
        const nodes = layerRef.current?.querySelectorAll<HTMLElement | SVGElement>(`[data-arrow="${CSS.escape(arrowId)}"]`);
        nodes?.forEach((node) => {
          node.classList.remove("is-pulsing");
          // Force a reflow so the animation restarts on back-to-back sends.
          void (node as HTMLElement).getBoundingClientRect();
          node.classList.add("is-pulsing");
        });
      }),
    [],
  );

  return (
    <div ref={layerRef} className="connection-layer">
      {connections.map((connection) => (
        <svg key={`flash-${connection.arrowId}`} className="connection-flash" style={{ transform: connection.transform }} aria-hidden="true">
          <path data-arrow={connection.arrowId} d={connection.path} />
        </svg>
      ))}
      {connections.map((connection) => (
        <ConnectionLabel key={`label-${connection.arrowId}`} connection={connection} />
      ))}
    </div>
  );
}

function ConnectionLabel({ connection }: { connection: DrawnConnection }) {
  const editor = useEditor();
  const { emits, eventType, duplicateOf } = connection;
  const options = [...emits.map((type) => ({ value: type, label: type }))];
  if (eventType && !emits.includes(eventType)) options.push({ value: eventType, label: `${eventType} (not emitted)` });
  return (
    <div
      className={["connection-label", duplicateOf ? "is-duplicate" : "", emits.length === 0 ? "is-empty" : ""].filter(Boolean).join(" ")}
      data-arrow={connection.arrowId}
      style={{ transform: `translate(${connection.label.x}px, ${connection.label.y}px) translate(-50%, -50%)` }}
      title={duplicateOf ? "duplicate: another arrow already carries this event between these instances; this one does nothing" : "event type this arrow carries"}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {emits.length === 0 ? (
        <span className="connection-label__none">no events</span>
      ) : (
        <Chooser
          value={eventType ?? ""}
          options={options}
          onChange={(value) => setConnectionType(editor, connection.arrowId as TLShapeId, value)}
          title="event type this arrow carries"
        />
      )}
      {duplicateOf ? <span className="connection-label__dup">dup</span> : null}
    </div>
  );
}
