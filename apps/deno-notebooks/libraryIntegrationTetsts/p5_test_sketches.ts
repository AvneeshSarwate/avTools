/// <reference lib="dom" />

export interface DrawingAPI {
  background(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void;
  clear(): void;

  fill(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void;
  noFill(): void;
  stroke(v1: unknown, v2?: unknown, v3?: unknown, a?: unknown): void;
  noStroke(): void;
  strokeWeight(weight: number): void;
  strokeCap(cap: number): void;
  strokeJoin(join: number): void;

  rect(x: number, y: number, w: number, h?: number, tl?: number, tr?: number, br?: number, bl?: number): void;
  square(x: number, y: number, s: number, tl?: number, tr?: number, br?: number, bl?: number): void;
  ellipse(x: number, y: number, w: number, h?: number): void;
  circle(x: number, y: number, d: number): void;
  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;
  quad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
  arc(x: number, y: number, w: number, h: number, start: number, stop: number, mode?: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  point(x: number, y: number): void;
  bezier(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
  curve(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
  curveTightness(amount: number): void;

  beginShape(kind?: number): void;
  endShape(mode?: number): void;
  vertex(x: number, y: number): void;
  curveVertex(x: number, y: number): void;
  bezierVertex(x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
  quadraticVertex(cx: number, cy: number, x3: number, y3: number): void;
  beginContour(): void;
  endContour(): void;

  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(s: number, sy?: number): void;
  rectMode(mode: number): void;
  ellipseMode(mode: number): void;
  text(str: unknown, x: number, y: number, maxWidth?: number, maxHeight?: number): void;
  textFont(font?: unknown, size?: number): unknown;
  textSize(size?: number): unknown;
  textLeading(leading?: number): unknown;
  textStyle(style?: unknown): unknown;
  textWeight(weight?: number): unknown;
  textAlign(horiz?: unknown, vert?: unknown): unknown;
  textWrap(style?: unknown): unknown;
  textDirection(direction?: unknown): unknown;
  textWidth(text: unknown): number;
  fontWidth(text: unknown): number;
  fontAscent(): number;
  fontDescent(): number;
  textAscent(text?: unknown): number;
  textDescent(text?: unknown): number;
  textBounds(str: unknown, x: number, y: number, maxWidth?: number, maxHeight?: number): { x: number; y: number; w: number; h: number };
  fontBounds(str: unknown, x: number, y: number, maxWidth?: number, maxHeight?: number): { x: number; y: number; w: number; h: number };

  readonly CORNER: number;
  readonly CORNERS: number;
  readonly CENTER: number;
  readonly RADIUS: number;
  readonly LEFT: unknown;
  readonly RIGHT: unknown;
  readonly TOP: unknown;
  readonly BOTTOM: unknown;
  readonly BASELINE: unknown;
  readonly NORMAL: unknown;
  readonly ITALIC: unknown;
  readonly BOLD: unknown;
  readonly BOLDITALIC: unknown;
  readonly WORD: unknown;
  readonly CHAR: unknown;
  readonly ROUND: number;
  readonly SQUARE: number;
  readonly PROJECT: number;
  readonly MITER: number;
  readonly BEVEL: number;
  readonly OPEN: number;
  readonly CHORD: number;
  readonly PIE: number;
  readonly CLOSE: number;

  readonly PI: number;
  readonly TWO_PI: number;
  readonly HALF_PI: number;
}

export interface TestSketch {
  name: string;
  phase: number;
  width: number;
  height: number;
  draw: (api: DrawingAPI) => void;
}

export const P5_TEST_SKETCHES: TestSketch[] = [
  {
    name: "basic-filled-shapes",
    phase: 1,
    width: 420,
    height: 320,
    draw(p) {
      p.background(220);
      p.noStroke();

      p.fill(235, 56, 45);
      p.rect(24, 24, 110, 80);

      p.fill(41, 98, 255);
      p.ellipse(305, 96, 120, 74);

      p.fill(0, 160, 95);
      p.triangle(210, 40, 180, 130, 265, 122);

      p.fill(255, 184, 77);
      p.quad(58, 210, 170, 192, 190, 276, 78, 296);

      p.fill(82, 54, 171, 180);
      p.circle(310, 236, 104);
    },
  },
  {
    name: "modes-and-transforms",
    phase: 1,
    width: 420,
    height: 320,
    draw(p) {
      p.background(248, 247, 241);

      p.rectMode(p.CENTER);
      p.noStroke();
      p.fill(255, 137, 81);
      p.rect(78, 70, 90, 58);

      p.ellipseMode(p.CORNER);
      p.fill(46, 196, 182, 210);
      p.ellipse(28, 112, 104, 70);

      p.push();
      p.translate(220, 156);
      p.rotate(0.48);
      p.fill(60, 88, 196, 170);
      p.stroke(255);
      p.strokeWeight(3);
      p.rect(-62, -36, 124, 72);
      p.pop();

      p.rectMode(p.CORNER);
      p.ellipseMode(p.CENTER);
      p.stroke(37, 37, 37);
      p.strokeWeight(4);
      p.noFill();
      p.circle(328, 220, 92);

      p.noStroke();
      p.fill(0, 0, 0, 65);
      p.square(298, 46, 72);
    },
  },
  {
    name: "alpha-overlap",
    phase: 1,
    width: 360,
    height: 280,
    draw(p) {
      p.background(24, 24, 30);
      p.noStroke();

      p.fill(255, 0, 64, 165);
      p.circle(120, 140, 150);

      p.fill(64, 255, 160, 165);
      p.circle(180, 140, 150);

      p.fill(64, 140, 255, 165);
      p.circle(150, 86, 150);

      p.fill(255, 214, 10, 124);
      p.rect(226, 36, 100, 190);

      p.fill(255);
      p.circle(280, 224, 20);
    },
  },
  {
    name: "stroke-caps-and-joins",
    phase: 2,
    width: 460,
    height: 300,
    draw(p) {
      p.background(246);
      p.noFill();
      p.stroke(35);

      p.strokeWeight(18);
      p.strokeCap(p.ROUND);
      p.line(34, 56, 158, 56);

      p.strokeCap(p.SQUARE);
      p.line(34, 106, 158, 106);

      p.strokeCap(p.PROJECT);
      p.line(34, 156, 158, 156);

      p.strokeJoin(p.MITER);
      p.rect(210, 36, 90, 90);

      p.strokeJoin(p.BEVEL);
      p.rect(320, 36, 90, 90);

      p.strokeJoin(p.ROUND);
      p.rect(265, 156, 90, 90);

      p.strokeWeight(10);
      p.point(44, 236);
      p.point(84, 236);
      p.point(124, 236);
    },
  },
  {
    name: "arcs-and-rounded-rects",
    phase: 3,
    width: 460,
    height: 300,
    draw(p) {
      p.background(252);

      p.fill(249, 195, 77);
      p.stroke(72, 56, 24);
      p.strokeWeight(3);
      p.rect(32, 32, 140, 100, 18);

      p.fill(255, 92, 92, 170);
      p.arc(246, 92, 138, 138, 0, p.HALF_PI + 0.55, p.CHORD);

      p.fill(61, 167, 245, 180);
      p.arc(246, 92, 138, 138, p.HALF_PI + 0.2, p.PI + 1.2, p.PIE);

      p.noFill();
      p.strokeWeight(9);
      p.stroke(45, 95, 180);
      p.arc(390, 88, 90, 90, -0.3, p.PI + 0.5, p.OPEN);

      p.strokeWeight(5);
      p.stroke(14, 128, 75);
      p.rect(32, 160, 160, 104, 8, 34, 8, 34);

      p.noStroke();
      p.fill(120, 90, 255, 130);
      p.circle(292, 216, 112);

      p.fill(16, 16, 16, 110);
      p.square(350, 172, 84, 14);
    },
  },
  {
    name: "curves-standalone",
    phase: 4,
    width: 480,
    height: 320,
    draw(p) {
      p.background(247);
      p.noFill();

      p.stroke(36, 92, 180);
      p.strokeWeight(6);
      p.curveTightness(0);
      p.curve(48, 230, 108, 90, 228, 250, 314, 80);
      p.curve(108, 90, 228, 250, 314, 80, 430, 210);

      p.stroke(206, 69, 71);
      p.strokeWeight(4);
      p.bezier(40, 64, 150, 10, 210, 140, 300, 78);
      p.bezier(300, 78, 348, 48, 412, 180, 452, 132);

      p.stroke(20, 140, 88);
      p.strokeWeight(5);
      p.curveTightness(0.8);
      p.curve(24, 312, 98, 200, 214, 300, 306, 174);
      p.curve(98, 200, 214, 300, 306, 174, 436, 298);

      p.noStroke();
      p.fill(36, 92, 180, 60);
      p.circle(108, 90, 14);
      p.circle(228, 250, 14);
      p.circle(314, 80, 14);
      p.fill(206, 69, 71, 60);
      p.circle(40, 64, 12);
      p.circle(300, 78, 12);
      p.circle(452, 132, 12);
    },
  },
  {
    name: "curves-vertex-shapes",
    phase: 4,
    width: 480,
    height: 340,
    draw(p) {
      p.background(244);

      p.noFill();
      p.stroke(42, 114, 201);
      p.strokeWeight(6);
      p.curveTightness(0);
      p.beginShape();
      p.curveVertex(56, 196);
      p.curveVertex(56, 196);
      p.curveVertex(136, 100);
      p.curveVertex(236, 236);
      p.curveVertex(346, 106);
      p.curveVertex(428, 210);
      p.curveVertex(428, 210);
      p.endShape();

      p.fill(255, 170, 78, 170);
      p.stroke(67, 47, 23);
      p.strokeWeight(3);
      p.beginShape();
      p.vertex(78, 292);
      p.bezierVertex(130, 206, 212, 328, 264, 262);
      p.bezierVertex(320, 224, 372, 300, 410, 288);
      p.vertex(146, 316);
      p.endShape(p.CLOSE);

      p.noFill();
      p.stroke(148, 55, 184);
      p.strokeWeight(4);
      p.beginShape();
      p.vertex(72, 246);
      p.quadraticVertex(158, 164, 246, 256);
      p.quadraticVertex(330, 334, 420, 238);
      p.endShape();

      p.noFill();
      p.stroke(148, 55, 184);
      p.strokeWeight(4);
      p.curveTightness(-0.7);
      p.beginShape();
      p.curveVertex(42, 42);
      p.curveVertex(42, 42);
      p.curveVertex(104, 58);
      p.curveVertex(184, 38);
      p.curveVertex(262, 68);
      p.curveVertex(336, 44);
      p.curveVertex(428, 76);
      p.curveVertex(428, 76);
      p.endShape();
    },
  },
  {
    name: "text-basic",
    phase: 5,
    width: 500,
    height: 300,
    draw(p) {
      p.background(245);
      p.noStroke();
      p.fill(18);
      p.textFont("Noto Sans");
      p.textSize(34);
      p.textAlign(p.LEFT, p.BASELINE);
      p.text("Hello, text()", 26, 72);

      p.textSize(18);
      p.fill(58, 96, 196);
      p.text("Baseline alignment", 28, 112);

      const label = "tight width";
      const w = p.textWidth(label);
      const bx = 30;
      const by = 172;
      p.fill(30);
      p.textSize(28);
      p.text(label, bx, by);

      p.noFill();
      p.stroke(220, 64, 64);
      p.strokeWeight(2);
      p.rect(bx, by - p.textAscent(label), w, p.textAscent(label) + p.textDescent(label));

      p.noStroke();
      p.fill(40, 140, 80);
      p.textSize(15);
      p.text(`w=${w.toFixed(1)}`, bx + w + 10, by);
    },
  },
  {
    name: "text-wrap-align",
    phase: 5,
    width: 520,
    height: 320,
    draw(p) {
      p.background(252);
      p.textFont("Noto Sans");
      p.textSize(18);
      p.textLeading(23);
      p.textWrap(p.WORD);

      p.noFill();
      p.stroke(210);
      p.strokeWeight(1.5);
      p.rect(20, 24, 190, 150);
      p.rect(250, 24, 240, 120);
      p.rect(250, 172, 240, 120);

      p.noStroke();
      p.fill(22);
      p.textAlign(p.LEFT, p.TOP);
      p.text(
        "Word wrapping should break at spaces and respect the top-left anchor.",
        20,
        24,
        190,
        150,
      );

      p.fill(40, 92, 205);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(
        "Centered block\nwith explicit line break",
        250,
        24,
        240,
        120,
      );

      p.fill(194, 76, 55);
      p.textAlign(p.RIGHT, p.BOTTOM);
      p.text(
        "Bottom-right\naligned text",
        250,
        172,
        240,
        120,
      );
    },
  },
  {
    name: "text-style-weight",
    phase: 5,
    width: 520,
    height: 320,
    draw(p) {
      p.background(24, 26, 34);
      p.textFont("Inter");
      p.textAlign(p.LEFT, p.TOP);
      p.noStroke();
      p.textSize(30);
      const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
      const maybeFontWidth = (p as unknown as { fontWidth?: (text: unknown) => number }).fontWidth;

      p.fill(235);
      p.textStyle(p.NORMAL);
      if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 300);
      p.text("Weight 300", 28, 24);

      p.textStyle(p.NORMAL);
      if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 600);
      p.text("Weight 600", 28, 74);

      p.textStyle(p.ITALIC);
      if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 700);
      p.text("Italic 700", 28, 124);

      p.textStyle(p.BOLDITALIC);
      if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 850);
      p.text("Bold Italic 850", 28, 176);

      p.textStyle(p.NORMAL);
      if (typeof maybeTextWeight === "function") maybeTextWeight.call(p, 450);
      p.textSize(16);
      p.fill(142, 172, 255);
      const sample = "fontWidth vs textWidth";
      const fw = typeof maybeFontWidth === "function" ? maybeFontWidth.call(p, sample) : p.textWidth(sample);
      const tw = p.textWidth(sample);
      p.text(`${sample}`, 28, 248);
      p.text(`fontWidth=${fw.toFixed(1)} textWidth=${tw.toFixed(1)}`, 28, 274);
    },
  },
  {
    name: "text-style-family-probe",
    phase: 6,
    width: 980,
    height: 360,
    draw(p) {
      p.background(247);
      p.textAlign(p.LEFT, p.TOP);
      p.noStroke();

      const columns = [
        { family: "Noto Sans", x: 20, accent: [45, 88, 190] as const },
        { family: "Inter", x: 340, accent: [12, 124, 88] as const },
        { family: "Inter Variable", x: 660, accent: [166, 76, 36] as const },
      ];

      for (const column of columns) {
        p.noFill();
        p.stroke(212);
        p.strokeWeight(1.5);
        p.rect(column.x, 18, 300, 324);

        p.noStroke();
        p.fill(column.accent[0], column.accent[1], column.accent[2]);
        p.textFont(column.family);
        p.textSize(20);
        p.textStyle(p.NORMAL);
        p.text(column.family, column.x + 14, 28);

        p.fill(22);
        p.textSize(34);
        p.textStyle(p.NORMAL);
        p.text("Normal", column.x + 14, 66);
        p.textStyle(p.BOLD);
        p.text("Bold", column.x + 14, 116);
        p.textStyle(p.ITALIC);
        p.text("Italic", column.x + 14, 166);
        p.textStyle(p.BOLDITALIC);
        p.text("Bold Italic", column.x + 14, 216);

        const sample = "Sphinx of black quartz";
        p.textSize(14);
        p.textStyle(p.NORMAL);
        const normalW = p.textWidth(sample);
        p.textStyle(p.BOLD);
        const boldW = p.textWidth(sample);
        p.textStyle(p.ITALIC);
        const italicW = p.textWidth(sample);
        p.fill(70, 70, 78);
        p.text(`N=${normalW.toFixed(1)} B=${boldW.toFixed(1)} I=${italicW.toFixed(1)}`, column.x + 14, 284);
      }
    },
  },
  {
    name: "text-weight-api-probe",
    phase: 6,
    width: 1160,
    height: 350,
    draw(p) {
      p.background(20, 24, 34);
      p.textAlign(p.LEFT, p.TOP);
      const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
      const supportsTextWeight = typeof maybeTextWeight === "function";
      const weights = [300, 450, 600, 750, 900];
      const families = [
        { name: "Inter", x: 24, accent: [62, 198, 140] as const },
        { name: "Inter Variable", x: 590, accent: [142, 172, 255] as const },
      ];

      for (const family of families) {
        p.noFill();
        p.stroke(54);
        p.strokeWeight(1.2);
        p.rect(family.x - 6, 18, 542, 314);

        p.noStroke();
        p.fill(family.accent[0], family.accent[1], family.accent[2]);
        p.textSize(24);
        p.textStyle(p.NORMAL);
        p.text(family.name, family.x, 26);

        p.fill(232);
        p.textFont(family.name);
        p.textSize(30);
        p.textStyle(p.NORMAL);
        let y = 60;
        const widthSamples: string[] = [];
        for (const weight of weights) {
          p.textStyle(p.NORMAL);
          if (supportsTextWeight) {
            maybeTextWeight.call(p, weight);
          }
          const label = `w${weight}  The quick brown fox`;
          p.text(label, family.x, y);
          widthSamples.push(`${weight}:${p.textWidth("The quick brown fox").toFixed(1)}`);
          y += 44;
        }

        p.textStyle(p.BOLD);
        p.text("BOLD style control", family.x, 280);
        p.textStyle(p.NORMAL);
        p.textSize(16);
        p.fill(140, 172, 255);
        p.text(`textWeight() support: ${supportsTextWeight ? "yes" : "no"}`, family.x, 314);
        p.text(widthSamples.join("  "), family.x, 334);
      }
    },
  },
  {
    name: "text-weight-api-probe-alt-font",
    phase: 6,
    width: 1160,
    height: 350,
    draw(p) {
      p.background(20, 24, 34);
      p.textAlign(p.LEFT, p.TOP);
      const maybeTextWeight = (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
      const supportsTextWeight = typeof maybeTextWeight === "function";
      const weights = [300, 450, 600, 750, 900];
      const families = [
        { name: "Inter Variable", x: 24, accent: [142, 172, 255] as const },
        { name: "Roboto Flex", x: 590, accent: [255, 176, 66] as const },
      ];

      for (const family of families) {
        p.noFill();
        p.stroke(54);
        p.strokeWeight(1.2);
        p.rect(family.x - 6, 18, 542, 314);

        p.noStroke();
        p.fill(family.accent[0], family.accent[1], family.accent[2]);
        p.textSize(24);
        p.textStyle(p.NORMAL);
        p.text(family.name, family.x, 26);

        p.fill(232);
        p.textFont(family.name);
        p.textSize(30);
        p.textStyle(p.NORMAL);
        let y = 60;
        const widthSamples: string[] = [];
        for (const weight of weights) {
          p.textStyle(p.NORMAL);
          if (supportsTextWeight) {
            maybeTextWeight.call(p, weight);
          }
          const label = `w${weight}  The quick brown fox`;
          p.text(label, family.x, y);
          widthSamples.push(`${weight}:${p.textWidth("The quick brown fox").toFixed(1)}`);
          y += 44;
        }

        p.textStyle(p.BOLD);
        p.text("BOLD style control", family.x, 280);
        p.textStyle(p.NORMAL);
        p.textSize(16);
        p.fill(140, 172, 255);
        p.text(`textWeight() support: ${supportsTextWeight ? "yes" : "no"}`, family.x, 314);
        p.text(widthSamples.join("  "), family.x, 334);
      }
    },
  },
  {
    name: "text-lfo-perf-frame0",
    phase: 6,
    width: 1280,
    height: 720,
    draw(p) {
      const textSize = 40;
      const gridCols = 80;
      const charCount = 900;
      const base =
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Morbi sed finibus lacus, vel lacinia nisi. ";
      const source = base.repeat(Math.ceil(charCount / base.length)).slice(0, charCount);
      const chars = source.split("");

      p.background(15, 18, 26);
      p.noStroke();
      p.textAlign(p.LEFT, p.TOP);
      p.textWrap(p.CHAR);
      p.textFont("Inter Variable");
      p.textSize(textSize);
      p.textStyle(p.NORMAL);

      const maybeTextWeight =
        (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
      const supportsTextWeight = typeof maybeTextWeight === "function";
      if (supportsTextWeight) {
        maybeTextWeight.call(p, 400);
      }

      const metricProbeWidth = Number(p.textWidth("M"));
      const metricProbeAscent = Number(p.textAscent("Mg"));
      const metricProbeDescent = Number(p.textDescent("g"));
      const metricProbeLeading = Number(p.textLeading());
      const metricHeight = Number.isFinite(metricProbeLeading) && metricProbeLeading > 0
        ? metricProbeLeading
        : metricProbeAscent + metricProbeDescent;

      const cellW = Number.isFinite(metricProbeWidth) && metricProbeWidth > 0
        ? metricProbeWidth
        : textSize * 0.75;
      const cellH = Number.isFinite(metricHeight) && metricHeight > 0
        ? metricHeight
        : textSize * 1.3;

      const cols = Math.min(gridCols, chars.length);
      const rows = Math.ceil(chars.length / cols);
      const startX = Math.floor((p.width - cols * cellW) * 0.5);
      const startY = Math.floor((p.height - rows * cellH) * 0.4);
      const t = 0;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (i >= chars.length) break;

          const x = startX + col * cellW;
          const y = startY + row * cellH;
          const lfo = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 0.17);
          const weight = Math.round(300 + lfo * 600);
          if (supportsTextWeight) {
            maybeTextWeight.call(p, weight);
          } else {
            p.textStyle(weight >= 650 ? p.BOLD : p.NORMAL);
          }

          const c = Math.round(170 + lfo * 70);
          p.fill(c, c, c + 5);
          p.text(chars[i], x, y);
        }
      }

      if (supportsTextWeight) {
        maybeTextWeight.call(p, 400);
      }
      p.textStyle(p.NORMAL);
      p.textSize(18);
      p.fill(138, 170, 255);
      p.text("LFO weight modulation, manual character layout (Inter Variable)", 24, 20);
    },
  },
  {
    name: "text-anchor-weight-probe",
    phase: 6,
    width: 1200,
    height: 760,
    draw(p) {
      const maybeTextWeight =
        (p as unknown as { textWeight?: (weight: number) => unknown }).textWeight;
      const supportsTextWeight = typeof maybeTextWeight === "function";
      const token = "lI1gq|A";
      const samples = [
        { x: 170, y: 150, h: p.LEFT, v: p.TOP, weight: 300, label: "LEFT/TOP w300" },
        { x: 600, y: 150, h: p.CENTER, v: p.TOP, weight: 450, label: "CENTER/TOP w450" },
        { x: 1030, y: 150, h: p.RIGHT, v: p.TOP, weight: 600, label: "RIGHT/TOP w600" },
        { x: 170, y: 380, h: p.LEFT, v: p.BASELINE, weight: 450, label: "LEFT/BASELINE w450" },
        { x: 600, y: 380, h: p.CENTER, v: p.BASELINE, weight: 700, label: "CENTER/BASELINE w700" },
        { x: 1030, y: 380, h: p.RIGHT, v: p.BASELINE, weight: 850, label: "RIGHT/BASELINE w850" },
        { x: 170, y: 620, h: p.LEFT, v: p.BOTTOM, weight: 600, label: "LEFT/BOTTOM w600" },
        { x: 600, y: 620, h: p.CENTER, v: p.BOTTOM, weight: 750, label: "CENTER/BOTTOM w750" },
        { x: 1030, y: 620, h: p.RIGHT, v: p.BOTTOM, weight: 900, label: "RIGHT/BOTTOM w900" },
      ];

      p.background(14, 18, 28);
      p.noFill();
      p.stroke(54, 62, 88);
      p.strokeWeight(1.2);
      for (const sx of [20, 420, 820]) p.rect(sx, 60, 360, 660);

      p.textFont("Inter Variable");
      p.textWrap(p.WORD);
      p.textStyle(p.NORMAL);
      p.textSize(16);
      p.noStroke();
      p.fill(142, 172, 255);
      p.text("Anchor/weight probe (Inter Variable) token='lI1gq|A'", 24, 24);
      p.text(`textWeight() support: ${supportsTextWeight ? "yes" : "no"}`, 24, 44);

      for (const sample of samples) {
        p.textAlign(sample.h, sample.v);
        p.textSize(58);
        p.textStyle(p.NORMAL);
        if (supportsTextWeight) {
          maybeTextWeight.call(p, sample.weight);
        } else {
          p.textStyle(sample.weight >= 650 ? p.BOLD : p.NORMAL);
        }

        const w = p.textWidth(token);
        const asc = p.textAscent("Mg");
        const desc = p.textDescent("g");
        const h = asc + desc;

        let x0 = sample.x;
        if (sample.h === p.CENTER) x0 -= w * 0.5;
        else if (sample.h === p.RIGHT) x0 -= w;

        let y0 = sample.y;
        if (sample.v === p.BASELINE) y0 -= asc;
        else if (sample.v === p.BOTTOM) y0 -= h;

        p.noFill();
        p.stroke(255, 96, 96, 220);
        p.strokeWeight(1.2);
        p.rect(x0, y0, w, h);

        p.stroke(80, 244, 255, 220);
        p.strokeWeight(1.1);
        p.line(sample.x - 20, sample.y, sample.x + 20, sample.y);
        p.line(sample.x, sample.y - 20, sample.x, sample.y + 20);

        p.noStroke();
        p.fill(235);
        p.text(token, sample.x, sample.y);

        if (supportsTextWeight) {
          maybeTextWeight.call(p, 400);
        }
        p.textStyle(p.NORMAL);
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(14);
        p.fill(140, 172, 255);
        p.text(sample.label, sample.x - 56, sample.y - 44);
        p.fill(106, 122, 170);
        p.text(`w=${w.toFixed(1)} a=${asc.toFixed(1)} d=${desc.toFixed(1)}`, sample.x - 56, sample.y - 26);
      }
    },
  },
];
