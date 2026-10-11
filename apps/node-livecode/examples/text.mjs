export default async function sketch(ctx, { p, present }) {
  for (let frame = 0; frame < 300; frame++) {
    p.beginFrame(); p.background(16, 24, 42); p.noStroke();
    p.fill(255, 140, 45); p.circle(80 + (frame * 2) % 480, 240, 90);
    p.fill(255); p.textSize(32); p.text('avTools · Node + Dawn', 30, 55);
    p.endFrame(); present(); await ctx.waitSec(1 / 60);
  }
}
