import { useEffect, useRef } from "react";
import { audio } from "../audio/engine";

const INK = "#e8e4d8";
const GRID = "#3a3a36";

function fit(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
  if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
  const g = canvas.getContext("2d")!;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { g, w, h };
}

/** Waveform, triggered on a rising zero crossing, showing a few periods of the last note. */
export function Scope({ noteHz, periods = 3 }: { noteHz: number; periods?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hz = useRef(noteHz);
  hz.current = noteHz;

  useEffect(() => {
    const { analyser, context } = audio();
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const { g, w, h } = fit(canvas);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = GRID;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, h / 2 + 0.5);
      g.lineTo(w, h / 2 + 0.5);
      g.stroke();

      analyser.getFloatTimeDomainData(data);
      const span = Math.min(Math.round((periods * context.sampleRate) / Math.max(hz.current, 20)), data.length / 2);
      // Trigger: the rising zero crossing with the steepest slope in the first half.
      let start = 0;
      let best = 0;
      for (let i = 1; i < data.length - span; i++) {
        if (data[i - 1] <= 0 && data[i] > 0) {
          const slope = data[i] - data[i - 1];
          if (slope > best) {
            best = slope;
            start = i;
          }
        }
      }
      let peak = 0.05;
      for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(data[i]));
      g.strokeStyle = INK;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const i = start + (x / w) * span;
        const lo = Math.floor(i);
        const v = data[lo] + (data[lo + 1] - data[lo]) * (i - lo);
        const y = h / 2 - (v / peak) * (h / 2 - 6);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [periods]);

  return <canvas ref={ref} className="plot" />;
}
