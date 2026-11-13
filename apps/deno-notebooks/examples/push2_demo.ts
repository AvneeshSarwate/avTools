import { Push2 } from "../push2/push2.ts";
import { COLOR } from "../push2/constants.ts";

// run with deno run --unstable-webgpu --unstable-ffi --allow-all examples/push2_demo.ts from deno-notebooks dir

const push = Push2.create();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// How much a single encoder tick changes the 0-1 value.
// Push 2 encoders send delta ±1..±63 per tick depending on rotation speed.
const ENCODER_SENSITIVITY = 0.01;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const encoderValues: Record<string, number> = {};
for (let t = 1; t <= 8; t++) encoderValues[`Track${t}`] = 0;

const encoderTouched: Record<string, boolean> = {};

let lastPadText = "Hello Push 2";

// ---------------------------------------------------------------------------
// Button events
// ---------------------------------------------------------------------------

push.onButtonPressed("Play", () => {
  console.log("Play pressed!");
  push.setButtonColor("Play", COLOR.RED);
});

push.onButtonReleased("Play", () => {
  push.setButtonColor("Play", COLOR.BLACK);
});

push.onAnyButtonPressed((name) => {
  console.log(`Button: ${name}`);
});

// ---------------------------------------------------------------------------
// Pad events
// ---------------------------------------------------------------------------

push.onPadPressed((padN, [i, j], velocity) => {
  console.log(`Pad (${i},${j}) pressed, velocity: ${velocity}`);
  push.setPadColor(padN, COLOR.BLUE);
  lastPadText = `Pad (${i},${j}) vel:${velocity}`;
});

push.onPadReleased((padN, [_i, _j]) => {
  push.setPadColor(padN, COLOR.BLACK);
});

push.onPadAftertouch((padN, [_i, _j], pressure) => {
  const color = pressure > 64 ? COLOR.RED : COLOR.BLUE;
  push.setPadColor(padN, color);
});

// ---------------------------------------------------------------------------
// Encoder events — infinite rotation mapped to 0-1 range
// ---------------------------------------------------------------------------

push.onAnyEncoderRotated((name, delta) => {
  if (!(name in encoderValues)) return;
  const prev = encoderValues[name];
  encoderValues[name] = Math.max(
    0,
    Math.min(1, prev + delta * ENCODER_SENSITIVITY),
  );
  console.log(`${name}: ${encoderValues[name].toFixed(3)}`);
});

push.onAnyEncoderTouched((name) => {
  encoderTouched[name] = true;
  console.log(`${name} touched`);
});

push.onAnyEncoderReleased((name) => {
  encoderTouched[name] = false;
  console.log(`${name} released`);
});

// ---------------------------------------------------------------------------
// Touchstrip
// ---------------------------------------------------------------------------

push.onTouchstrip((value) => {
  console.log(`Touchstrip: ${value}`);
});

// ---------------------------------------------------------------------------
// Display — 960x160 at ~20fps
// ---------------------------------------------------------------------------

await push.startDisplay((p5) => {
  p5.background(0);

  // Title
  p5.fill(255);
  p5.textSize(28);
  p5.textAlign("center", "top");
  p5.text("Deno Push 2", 480, 4);

  // Last pad event
  p5.textSize(16);
  p5.fill(100, 200, 255);
  p5.text(lastPadText, 480, 38);

  // Encoder visualization — one column per Track1-8
  const barW = 80;
  const barH = 80;
  const barY = 70;
  const gap = (960 - barW * 8) / 9;

  for (let t = 1; t <= 8; t++) {
    const name = `Track${t}`;
    const val = encoderValues[name];
    const touched = encoderTouched[name] ?? false;
    const x = gap + (t - 1) * (barW + gap);

    // Background bar
    p5.noStroke();
    p5.fill(30);
    p5.rect(x, barY, barW, barH);

    // Filled portion (bottom-up)
    const fillH = val * barH;
    if (touched) { p5.fill(255, 60, 60); } else { p5.fill(100, 200, 100); }
    p5.rect(x, barY + barH - fillH, barW, fillH);

    // Value text
    p5.textAlign("center", "top");
    p5.textSize(14);
    if (touched) { p5.fill(255, 80, 80); } else { p5.fill(255); }
    p5.text(val.toFixed(2), x + barW / 2, barY + barH + 2);

    // Label
    p5.fill(120);
    p5.textSize(10);
    p5.text(name, x + barW / 2, barY - 12);
  }
});

// Keep alive
console.log("Push 2 demo running. Press Ctrl+C to exit.");
await new Promise(() => {});
