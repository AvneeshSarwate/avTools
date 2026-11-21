import { besselJ } from "./bessel";

const W = 880;
const H = 250;
const LEFT = 34;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 26;
const MAX_INDEX = 10;
const Y_MIN = -0.45;
const Y_MAX = 1.05;
const ORDERS = [0, 1, 2, 3, 4, 5];
// Where each curve first peaks, for placing its name.
const PEAK = [0.35, 1.84, 3.05, 4.2, 5.32, 6.42];
const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅"];

const x = (index: number) => LEFT + (index / MAX_INDEX) * (W - LEFT - RIGHT);
const y = (value: number) => TOP + ((Y_MAX - value) / (Y_MAX - Y_MIN)) * (H - TOP - BOTTOM);

const CURVES = ORDERS.map((n) => {
  let d = "";
  for (let i = 0; i <= 200; i++) {
    const index = (i / 200) * MAX_INDEX;
    d += `${i ? "L" : "M"}${x(index).toFixed(1)} ${y(besselJ(n, index)).toFixed(1)} `;
  }
  return d;
});

/** The first six Bessel functions against the index, with the current index marked. */
export function BesselPlot({ index }: { index: number }) {
  const at = Math.min(index, MAX_INDEX);
  const values = ORDERS.map((n) => besselJ(n, at));
  return (
    <figure className="fig fig-wide">
      <svg className="bessel" viewBox={`0 0 ${W} ${H}`}>
        {[-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => (
          <g key={v}>
            <line className={v === 0 ? "axis" : "grid"} x1={LEFT} x2={W - RIGHT} y1={y(v)} y2={y(v)} />
            <text className="tick" x={LEFT - 6} y={y(v) + 3} textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}
        {Array.from({ length: MAX_INDEX + 1 }, (_, i) => (
          <text key={i} className="tick" x={x(i)} y={H - 8} textAnchor="middle">{i}</text>
        ))}
        {CURVES.map((d, n) => (
          <g key={n}>
            <path className="curve" d={d} />
            <text className="name" x={x(PEAK[n]) + (n === 0 ? 8 : 0)} y={y(besselJ(n, PEAK[n])) - 6} textAnchor={n === 0 ? "start" : "middle"}>
              J{SUBSCRIPT[n]}
            </text>
          </g>
        ))}
        <line className="marker" x1={x(at)} x2={x(at)} y1={TOP} y2={H - BOTTOM} />
        {values.map((v, n) => (
          <circle key={n} className="dot" cx={x(at)} cy={y(v)} r={3.5} />
        ))}
      </svg>
      <figcaption>
        The Bessel functions J₀ to J₅ against the index. At the present index of {at.toFixed(2)}:{" "}
        {values.map((v, n) => `J${SUBSCRIPT[n]} = ${v.toFixed(2)}`).join(", ")}. J₀ is the amplitude of the carrier and
        Jₙ that of the nth pair of sidebands.
      </figcaption>
    </figure>
  );
}
