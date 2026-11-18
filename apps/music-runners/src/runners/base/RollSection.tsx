import { Icon } from "../../ui/controls/icons";

export function RollSection({
  title,
  open,
  onToggle,
  extra,
  tools,
  toolsRef,
  onResizeStart,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
  /** The section's own controls, right-aligned in its header. */
  tools?: React.ReactNode;
  /** Header slot a roll renders its tool row into (only while open). */
  toolsRef?: (el: HTMLElement | null) => void;
  /** Drag bar along the bottom edge that resizes the section's roll. */
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`runner-section ${open ? "runner-section--open" : ""}`}>
      <div className="runner-section__header">
        <button type="button" data-control className="runner-section__toggle" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
          <span className="runner-section__title">{title}</span>
        </button>
        {extra ? <span className="runner-section__extra">{extra}</span> : null}
        <span className="runner-section__tools">
          {tools}
          {open && toolsRef ? <span ref={toolsRef} className="runner-section__toolbar" /> : null}
        </span>
      </div>
      {open ? <div className="runner-section__body">{children}</div> : null}
      {open && onResizeStart ? (
        <div className="runner-section__resize" data-control title="drag to resize the roll" onPointerDown={onResizeStart} />
      ) : null}
    </section>
  );
}
