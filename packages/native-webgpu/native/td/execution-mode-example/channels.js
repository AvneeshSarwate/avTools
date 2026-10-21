// Use this same script with Wait for Current Result either on or off.
function setup(host) {
  host.timing.launch(async context => {
    while (true) {
      await context.waitSec(0.01);
      host.outputs.set('ticks', host.outputs.get('ticks') + 1);
    }
  });
}
function onCook(host, frame) {
  const until = performance.now() + host.inputs.get('work_ms');
  while (performance.now() < until) {} // Intentional load for this example only.
  const value = host.inputs.get('value');
  host.outputs.set('value', value * 2);
  host.outputs.set('opposite', -value * 2);
  host.outputs.set('cooks', host.outputs.get('cooks') + 1);
  host.outputs.set('elapsed', host.outputs.get('elapsed') + frame.deltaSeconds);
}
function onPulse(name, host) {
  host.outputs.set('pulses', host.outputs.get('pulses') * 10 + (Number(name) || 1));
}
