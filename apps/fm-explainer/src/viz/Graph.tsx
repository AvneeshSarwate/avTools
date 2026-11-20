// Operator diagram in the DX convention: audible operators along the bottom,
// modulators stacked above the operator they feed.

export interface GraphOp {
  /** Number shown in the box (1-based). */
  number: number;
  ratio: string;
  audible: boolean;
  feedback?: string;
  note?: string;
}

export interface GraphEdge {
  from: number;
  to: number;
  label: string;
  /** 0..1, drawn as line weight. */
  weight: number;
  dashed?: boolean;
  muted?: boolean;
}

const BOX_W = 62;
const BOX_H = 38;
const GAP_X = 26;
const GAP_Y = 44;

export function Graph({ ops, edges }: { ops: GraphOp[]; edges: GraphEdge[] }) {
  // Row: 0 for audible operators, otherwise one above the highest thing it feeds.
  const row = new Map<number, number>();
  const sorted = [...ops].sort((a, b) => b.number - a.number);
  for (const o of sorted) {
    const targets = edges.filter((e) => e.from === o.number).map((e) => row.get(e.to) ?? 0);
    row.set(o.number, o.audible || targets.length === 0 ? 0 : Math.max(...targets) + 1);
  }
  // Column: a modulator sits over the lowest-numbered operator it feeds, shifted if taken.
  const col = new Map<number, number>();
  const taken = new Set<string>();
  let nextCol = 0;
  const place = (o: GraphOp, wanted: number) => {
    let c = wanted;
    while (taken.has(`${c},${row.get(o.number)}`)) c++;
    taken.add(`${c},${row.get(o.number)}`);
    col.set(o.number, c);
    nextCol = Math.max(nextCol, c + 1);
  };
  for (const o of [...ops].sort((a, b) => (row.get(a.number)! - row.get(b.number)!) || a.number - b.number)) {
    if (row.get(o.number) === 0) place(o, nextCol);
    else {
      const below = edges
        .filter((e) => e.from === o.number && col.has(e.to))
        .sort((a, b) => row.get(b.to)! - row.get(a.to)! || a.to - b.to)[0];
      place(o, below ? col.get(below.to)! : nextCol);
    }
  }
  const rows = Math.max(...row.values(), 0) + 1;
  // Edges between operators on the same row arc over the boxes between them.
  const span = (e: GraphEdge) => Math.abs(col.get(e.to)! - col.get(e.from)!);
  const sameRow = (e: GraphEdge) => row.get(e.from) === row.get(e.to);
  const arcHeight = (e: GraphEdge) => 12 + 13 * span(e);
  const topPad = 12 + Math.max(0, ...edges.filter(sameRow).map(arcHeight));
  const width = nextCol * (BOX_W + GAP_X) + GAP_X + 30;
  const height = topPad + rows * (BOX_H + GAP_Y) - GAP_Y + 30;
  const x = (n: number) => GAP_X + col.get(n)! * (BOX_W + GAP_X);
  const y = (n: number) => topPad + (rows - 1 - row.get(n)!) * (BOX_H + GAP_Y);

  return (
    <svg className="graph" viewBox={`0 0 ${width} ${height}`} style={{ width: Math.min(width, 640), maxWidth: "100%" }}>
      {edges.map((e, i) => {
        const x1 = x(e.from) + BOX_W / 2;
        const x2 = x(e.to) + BOX_W / 2;
        let d: string;
        let lx: number;
        let ly: number;
        let anchor: "start" | "middle" = "start";
        if (sameRow(e)) {
          // Leave from the right half of the source, arrive on the left half of the target.
          const sx = x1 + 10;
          const tx = x2 - 10;
          const top = y(e.from) - arcHeight(e);
          d = `M ${sx} ${y(e.from)} C ${sx} ${top}, ${tx} ${top}, ${tx} ${y(e.to)}`;
          lx = (sx + tx) / 2;
          ly = y(e.from) - arcHeight(e) * 0.75 - 2;
          anchor = "middle";
        } else {
          const y1 = y(e.from) + BOX_H;
          const y2 = y(e.to);
          d = `M ${x1} ${y1} C ${x1} ${y1 + GAP_Y * 0.6}, ${x2} ${y2 - GAP_Y * 0.6}, ${x2} ${y2}`;
          lx = x1 + 5;
          ly = y1 + 12;
        }
        return (
          <g key={i} className={e.muted ? "edge muted" : "edge"}>
            <path d={d} strokeWidth={1 + 3 * Math.min(1, e.weight)} strokeDasharray={e.dashed ? "4 3" : undefined} />
            <text x={lx} y={ly} textAnchor={anchor}>{e.label}</text>
          </g>
        );
      })}
      {ops.map((o) => (
        <g key={o.number} className={o.audible ? "op audible" : "op"}>
          <rect x={x(o.number)} y={y(o.number)} width={BOX_W} height={BOX_H} />
          <text className="op-number" x={x(o.number) + 6} y={y(o.number) + 13}>{o.number}</text>
          <text className="op-ratio" x={x(o.number) + BOX_W / 2} y={y(o.number) + 25} textAnchor="middle">{o.ratio}</text>
          {o.note && (
            <text className="op-note" x={x(o.number) + BOX_W / 2} y={y(o.number) + 35} textAnchor="middle">{o.note}</text>
          )}
          {o.feedback && (
            <text className="op-fb" x={x(o.number) + BOX_W / 2} y={y(o.number) + BOX_H + 24} textAnchor="middle">
              fb {o.feedback}
            </text>
          )}
          {o.audible && (
            <path className="out" d={`M ${x(o.number) + BOX_W / 2} ${y(o.number) + BOX_H} v 12`} />
          )}
        </g>
      ))}
    </svg>
  );
}
