// The chrome's control kit, after Ableton's: flat rectangles, value fields you
// drag, choosers that open a plain list, text toggles that fill when on. No
// native form widgets are visible anywhere (a NumberBox swaps in a styled text
// field only while typing).
//
// Every control carries `data-control`, which hosts use to tell a control
// from the background they sit on (the runner header is a drag grip). Pointer
// presses on controls stop propagating, so the tldraw canvas never sees them.
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import "./controls.css";

/** Semantic colour of an active control; see the colour roles in styles.css. */
export type Tone = "select" | "play" | "run" | "rec" | "neutral";

const stopPointer = (event: React.SyntheticEvent) => event.stopPropagation();

// ---------- Button / IconButton ----------

export interface ButtonProps {
  icon?: IconName;
  label?: ReactNode;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Filled in its tone colour (an active transport, a pressed toggle). */
  active?: boolean;
  tone?: Tone;
  className?: string;
  /** Subdued until hovered: secondary actions in dense rows. */
  quiet?: boolean;
}

export function Button({ icon, label, title, onClick, disabled, active, tone = "neutral", className, quiet }: ButtonProps) {
  const classes = ["ui-button", `ui-tone-${tone}`, active ? "is-active" : "", quiet ? "is-quiet" : "", label ? "" : "is-icon", className ?? ""];
  return (
    <button
      type="button"
      data-control
      className={classes.filter(Boolean).join(" ")}
      title={title}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      onPointerDown={stopPointer}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : null}
      {label ? <span className="ui-button__label">{label}</span> : null}
    </button>
  );
}

/** A text toggle: uppercase label, filled in its tone when on. */
export function Toggle({
  label,
  icon,
  on,
  onChange,
  title,
  disabled,
  tone = "select",
  mixed,
  className,
}: {
  label?: ReactNode;
  icon?: IconName;
  on: boolean;
  onChange: (on: boolean) => void;
  title?: string;
  disabled?: boolean;
  tone?: Tone;
  /** Tri-state display for multi-selection edits. */
  mixed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-control
      role="switch"
      aria-checked={mixed ? "mixed" : on}
      className={["ui-toggle", `ui-tone-${tone}`, on && !mixed ? "is-active" : "", mixed ? "is-mixed" : "", label ? "" : "is-icon", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      title={title}
      disabled={disabled}
      onPointerDown={stopPointer}
      onClick={() => onChange(mixed ? true : !on)}
    >
      {icon ? <Icon name={icon} /> : null}
      {label ? <span className="ui-button__label">{label}</span> : null}
    </button>
  );
}

// ---------- NumberBox ----------

export interface NumberBoxProps {
  value: number | null;
  /** Every change, including each step of a drag. */
  onChange: (value: number) => void;
  /** Once per gesture: drag end, typed value, arrow key. For undoable edits. */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Display text for the value; default trims to the step's decimals. */
  format?: (value: number) => string;
  unit?: string;
  title?: string;
  disabled?: boolean;
  /** Shown when value is null (a mixed multi-selection). */
  placeholder?: string;
  /** Ableton bar slider: the field fills to the value's place in min..max. */
  bar?: boolean;
  /** Value change per pixel of drag; default spans a wide range in ~240px. */
  perPixel?: number;
  width?: number;
  className?: string;
}

const DRAG_PX_PER_STEP = 3;
/** Above this many steps across the range, dragging the full range takes this many pixels. */
const DRAG_RANGE_PX = 240;

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/**
 * A value field edited Ableton-style: drag up/down to change (Shift for fine
 * steps), double-click to type, arrow keys when focused, Escape cancels typing.
 */
export function NumberBox({
  value,
  onChange,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format,
  unit,
  title,
  disabled,
  placeholder = "—",
  bar,
  perPixel,
  width,
  className,
}: NumberBoxProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; start: number; moved: boolean; last: number } | null>(null);
  const decimals = decimalsOf(step);
  const clamp = useCallback(
    (raw: number) => {
      const stepped = Math.round(raw / step) * step;
      return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))));
    },
    [decimals, max, min, step],
  );
  const shown = value === null ? placeholder : (format ? format(value) : value.toFixed(decimals)) + (unit ?? "");

  const finite = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const perPx = perPixel ?? (finite && (max - min) / step > DRAG_RANGE_PX / DRAG_PX_PER_STEP ? (max - min) / DRAG_RANGE_PX : step / DRAG_PX_PER_STEP);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (disabled || editing || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = value ?? (finite ? min : 0);
    drag.current = { y: event.clientY, start, moved: false, last: start };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    event.stopPropagation();
    const dy = state.y - event.clientY;
    if (!state.moved && Math.abs(dy) < 2) return;
    if (!state.moved) {
      state.moved = true;
      setDragging(true);
    }
    const next = clamp(state.start + dy * perPx * (event.shiftKey ? 0.1 : 1));
    if (next !== state.last) {
      state.last = next;
      onChange(next);
    }
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (state?.moved && state.last !== state.start) onCommit?.(state.last);
  };
  const set = (next: number) => {
    onChange(next);
    onCommit?.(next);
  };
  const startTyping = () => {
    if (disabled) return;
    setDraft(value === null ? "" : String(value));
    setEditing(true);
  };
  const commitTyping = () => {
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) set(clamp(parsed));
    setEditing(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (delta) {
      event.preventDefault();
      event.stopPropagation();
      set(clamp((value ?? 0) + delta * step * (event.shiftKey ? 10 : 1)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      startTyping();
    }
  };

  // Bar fill: from the left, or from zero for a bipolar range (transpose).
  const style: CSSProperties = { width };
  if (bar && finite && value !== null) {
    const at = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
    const origin = min < 0 && max > 0 ? at(0) : 0;
    const position = at(value);
    const vars = style as Record<string, string>;
    vars["--ui-fill-from"] = `${Math.min(origin, position) * 100}%`;
    vars["--ui-fill"] = `${Math.abs(position - origin) * 100}%`;
  }

  return (
    <div
      data-control
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-valuenow={value ?? undefined}
      aria-valuemin={Number.isFinite(min) ? min : undefined}
      aria-valuemax={Number.isFinite(max) ? max : undefined}
      aria-disabled={disabled || undefined}
      title={title ? `${title} · drag or double-click to type` : "drag or double-click to type"}
      className={["ui-number", bar ? "is-bar" : "", dragging ? "is-dragging" : "", disabled ? "is-disabled" : "", value === null ? "is-mixed" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={startTyping}
      onKeyDown={onKeyDown}
    >
      {editing ? (
        <input
          className="ui-number__input"
          autoFocus
          value={draft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitTyping}
          onPointerDown={stopPointer}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") commitTyping();
            if (event.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="ui-number__value">{shown}</span>
      )}
    </div>
  );
}

// ---------- Chooser ----------

export interface ChooserOption {
  value: string;
  label: string;
  /** Rendered dimmer (a remembered port that is not connected, "none"). */
  muted?: boolean;
  /** A separator above this option. */
  divider?: boolean;
}

export interface ChooserProps {
  value: string;
  options: ChooserOption[];
  onChange: (value: string) => void;
  /** Called as the list opens: refresh ports, project names. */
  onOpen?: () => void;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  width?: number;
  className?: string;
}

/**
 * A flat dropdown. The list renders in a portal on document.body (the runner
 * shapes clip their content), positioned under the button, and closes on a
 * choice, Escape, an outside press, or any scroll/wheel.
 */
export function Chooser({ value, options, onChange, onOpen, placeholder = "—", title, disabled, width, className }: ChooserProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  const close = useCallback(() => setOpen(false), []);
  const openList = () => {
    if (disabled) return;
    onOpen?.();
    setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setHighlight(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const choose = (option: ChooserOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
    buttonRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("wheel", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("wheel", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => (index + delta + options.length) % Math.max(1, options.length));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[highlight];
      if (option) choose(option);
    }
  };

  const listStyle: CSSProperties = rect
    ? (() => {
        const below = window.innerHeight - rect.bottom;
        const maxHeight = Math.min(320, Math.max(below, rect.top) - 8);
        const top = below >= Math.min(160, options.length * 22 + 8) || below >= rect.top ? rect.bottom + 2 : undefined;
        return {
          left: rect.left,
          minWidth: rect.width,
          maxHeight,
          top,
          bottom: top === undefined ? window.innerHeight - rect.top + 2 : undefined,
        };
      })()
    : {};

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-control
        className={["ui-chooser", open ? "is-open" : "", current?.muted || !current ? "is-muted" : "", className ?? ""].filter(Boolean).join(" ")}
        style={{ width }}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onPointerDown={stopPointer}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            openList();
          }
        }}
      >
        <span className="ui-chooser__label">{current?.label ?? placeholder}</span>
        <Icon name="chevronDown" size={10} />
      </button>
      {open
        ? createPortal(
            <div
              ref={listRef}
              className="ui-chooser__list"
              role="listbox"
              tabIndex={-1}
              style={listStyle}
              onKeyDown={onListKey}
              onPointerDown={stopPointer}
              onWheel={stopPointer}
            >
              {options.length === 0 ? <div className="ui-chooser__empty">nothing to choose</div> : null}
              {options.map((option, index) => (
                <div
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  className={[
                    "ui-chooser__option",
                    option.value === value ? "is-selected" : "",
                    index === highlight ? "is-highlighted" : "",
                    option.muted ? "is-muted" : "",
                    option.divider ? "has-divider" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onPointerEnter={() => setHighlight(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ---------- TextField ----------

/** A flat single-line text field. Keys stay inside it (tldraw never sees them). */
export function TextField({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  title,
  width,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter (and blur when given). */
  onCommit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  title?: string;
  width?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <input
      data-control
      className={["ui-text", className ?? ""].filter(Boolean).join(" ")}
      type="text"
      value={value}
      placeholder={placeholder}
      title={title}
      style={{ width }}
      autoFocus={autoFocus}
      spellCheck={false}
      onPointerDown={stopPointer}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit?.();
        }
        if (event.key === "Escape") onCancel?.();
      }}
    />
  );
}

/** A labelled cell: a small muted caption next to (or above) a control. */
export function Field({ label, children, title, stacked }: { label: ReactNode; children: ReactNode; title?: string; stacked?: boolean }) {
  return (
    <div className={`ui-field${stacked ? " is-stacked" : ""}`} title={title}>
      <span className="ui-field__label">{label}</span>
      {children}
    </div>
  );
}

/** A status lamp: a dot in a tone, for MIDI/save/mode readouts. */
export function Lamp({ tone, pulse }: { tone: Tone | "off" | "warn"; pulse?: boolean }) {
  return <span className={`ui-lamp ui-lamp--${tone}${pulse ? " is-pulsing" : ""}`} aria-hidden="true" />;
}
