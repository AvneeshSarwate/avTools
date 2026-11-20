import { useEffect, useRef } from "react";
import { audio } from "../audio/engine";
import type { Partial } from "./bessel";

const INK = "#e8e4d8";
const GRID = "#3a3a36";
const LABEL = "#8f8c82";
const PREDICT = "#e2703a";
const FLOOR_DB = -72;

/**
 * Spectrum with the horizontal axis in multiples of the played note, so that
 * harmonic partials land on the integer ticks whatever key is held.
 */
export function Spectrum({
  noteHz,
  maxRatio = 16,
  predicted,
  hidden,
}: {
  noteHz: number;
  maxRatio?: number;
  predicted?: Partial[];
  hidden?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ noteHz, maxRatio, predicted, hidden });
  state.current = { noteHz, maxRatio, predicted, hidden };

  useEffect(() => {
    const { analyser, context } = audio();
    const bins = new Float32Array(analyser.frequencyBinCount);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * ratio)) canvas.width = Math.round(w * ratio);
      if (canvas.height !== Math.round(h * ratio)) canvas.height = Math.round(h * ratio);
      const g = canvas.getContext("2d")!;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, w, h);

      const s = state.current;
      const base = h - 16;
      const top = 6;
      const xOf = (r: number) => (r / s.maxRatio) * w;
      const yOf = (db: number) => base - Math.max(0, (db - FLOOR_DB) / -FLOOR_DB) * (base - top);

      g.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      g.textAlign = "center";
      const every = s.maxRatio > 24 ? 4 : s.maxRatio > 12 ? 2 : 1;
      for (let r = 0; r <= s.maxRatio; r++) {
        const x = Math.round(xOf(r)) + 0.5;
        g.strokeStyle = GRID;
        g.beginPath();
        g.moveTo(x, r % every === 0 ? top : base - 4);
        g.lineTo(x, base);
        g.stroke();
        if (r % every === 0 && r > 0) {
          g.fillStyle = LABEL;
          g.fillText(String(r), x, h - 3);
        }
      }
      g.strokeStyle = GRID;
      g.beginPath();
      g.moveTo(0, base + 0.5);
      g.lineTo(w, base + 0.5);
      g.stroke();

      if (s.hidden) {
        g.fillStyle = LABEL;
        g.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
        g.fillText("answer the question to see the spectrum", w / 2, h / 2);
        return;
      }

      analyser.getFloatFrequencyData(bins);
      const hzPerBin = context.sampleRate / analyser.fftSize;
      g.strokeStyle = INK;
      g.lineWidth = 1.25;
      g.beginPath();
      let loudest = -200;
      for (let x = 0; x <= w; x++) {
        const hz = (x / w) * s.maxRatio * s.noteHz;
        const lo = Math.max(Math.floor(hz / hzPerBin), Math.ceil(25 / hzPerBin));
        const hi = Math.max(lo + 1, Math.floor((((x + 1) / w) * s.maxRatio * s.noteHz) / hzPerBin));
        let db = -200;
        for (let i = lo; i < hi && i < bins.length; i++) db = Math.max(db, bins[i]);
        loudest = Math.max(loudest, db + 12);
        const y = yOf(db + 12);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();

      if (s.predicted) {
        // Predicted partials, with the strongest one level with the loudest measured peak.
        const strongest = Math.max(...s.predicted.map((p) => p.amplitude), 1e-6);
        const reference = Math.max(Math.min(loudest, 0), -40);
        g.fillStyle = PREDICT;
        for (const p of s.predicted) {
          if (p.ratio > s.maxRatio) continue;
          const db = 20 * Math.log10(p.amplitude / strongest) + reference;
          const x = xOf(p.ratio);
          const y = yOf(db);
          g.fillRect(Math.round(x) - 1, y, 2, base - y);
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className="plot" />;
}
