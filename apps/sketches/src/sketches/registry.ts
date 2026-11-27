// The sketches in this app. Each one is a page at <slug>/index.html (the Vite
// build picks up every such folder) and gets a link on the landing page.
export interface SketchEntry {
  slug: string;
  title: string;
  description: string;
}

export const SKETCHES: SketchEntry[] = [
  {
    slug: "split-sweep",
    title: "split · sweep",
    description: "A 16:9 canvas cut into regions; each drones a Six Sines voice and sweeps between two colours and two notes.",
  },
  {
    slug: "pointer-pressure",
    title: "pointer · pressure",
    description: "Shows the pressure, tilt, twist and contact size a pen, finger or mouse reports, and inks smooth pressure-width spline strokes (three.js ink, p5.js readout).",
  },
];
