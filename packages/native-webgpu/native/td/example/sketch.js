// Embedded in Sketch.tox's `sketch` Text DAT. Edit that DAT to live-code.
let count = 0;
let radius = 5;

async function setup(p, host) {
  await host.device.queue.onSubmittedWorkDone();
  p.textSize(18);
}

function onPulse(name, p, frame) {
  if (name !== 'Trigger') return;
  // Read the CHOP snapshot at the pulse's cook; missing channels return zero.
  radius = Math.max(3, Math.min(18,
    frame.chop('amount') / 4 + frame.chop('missing_channel')));
}

function draw(p, frame) {
  count++;
  p.background(frame.chop('amount'), 80, count % 256);
  if (frame.top(0)) p.image(frame.top(0), 0, 0, 32, 32);
  p.noStroke();
  p.fill(255);
  p.text('Dawn + Rust', 36, 28);
  p.fill(255, 220, 50);
  p.circle(p.width - 32, p.height - 23, radius * 2);
  // Small TD-time marker, useful for checking that downstream frames advance.
  p.fill(frame.frame % 256, 0, 0);
  p.rect(p.width - 4, p.height - 4, 4, 4);
}
