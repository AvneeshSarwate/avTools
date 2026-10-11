// Paste into a Text DAT and select it in avTools Sketch's Sketch DAT parameter.
// Event Name = Trigger; Send Pulse captures the current Controls CHOP's radius.
let radius = 40;
function setup(p) { p.textSize(28); }
function onPulse(name, p, frame) {
  if (name === 'Trigger') radius = frame.chop('radius') || 40;
}
function draw(p, frame) {
  p.background(15, 20, 40);
  if (frame.top(0)) p.image(frame.top(0), 0, 0, p.width, p.height);
  p.noStroke(); p.fill(255);
  p.circle(p.width / 2, p.height / 2, radius * 2);
  p.text('Dawn + Rust', 16, 40);
}
