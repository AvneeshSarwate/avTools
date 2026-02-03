import { AudioContext, OscillatorNode, GainNode } from "node-web-audio-api";

const audioContext = new AudioContext();

console.log("Web Audio API test - playing random tones for 5 seconds...");
console.log(`Sample rate: ${audioContext.sampleRate}`);

const interval = setInterval(() => {
  const now = audioContext.currentTime;
  const frequency = 200 + Math.random() * 2800;

  const env = new GainNode(audioContext, { gain: 0 });
  env.connect(audioContext.destination);
  env.gain
    .setValueAtTime(0, now)
    .linearRampToValueAtTime(0.2, now + 0.02)
    .exponentialRampToValueAtTime(0.0001, now + 1);

  const osc = new OscillatorNode(audioContext, { frequency });
  osc.connect(env);
  osc.start(now);
  osc.stop(now + 1);
}, 80);

// Stop after 5 seconds
setTimeout(() => {
  clearInterval(interval);
  // Allow final notes to ring out before closing
  setTimeout(async () => {
    await audioContext.close();
    console.log("Done!");
  }, 1500);
}, 5000);
