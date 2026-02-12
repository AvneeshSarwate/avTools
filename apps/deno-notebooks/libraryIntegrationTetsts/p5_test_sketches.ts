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

  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(s: number, sy?: number): void;
  rectMode(mode: number): void;
  ellipseMode(mode: number): void;

  readonly CORNER: number;
  readonly CORNERS: number;
  readonly CENTER: number;
  readonly RADIUS: number;
  readonly ROUND: number;
  readonly SQUARE: number;
  readonly PROJECT: number;
  readonly MITER: number;
  readonly BEVEL: number;
  readonly OPEN: number;
  readonly CHORD: number;
  readonly PIE: number;

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
];
