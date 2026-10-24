import type {Draw} from '@avtools/native-webgpu/td-sketch';

// TOP: wire an optional TOP to input 0. Select a CHOP with an optional `size`
// channel using the plugin's Controls CHOP parameter. No inputs are required.
export const draw: Draw = (p, frame) => {
  p.background(24);
  const input = frame.top(0);
  if (input) p.image(input, 0, 0, frame.width, frame.height);
  // Missing CHOP channels return zero; this example explicitly chooses a
  // fallback size. A legitimate size of zero also selects that fallback.
  const size = frame.chop('size') || 80;
  p.noStroke(); p.fill(255, 140, 40);
  p.circle(frame.width / 2, frame.height / 2, size);
};
