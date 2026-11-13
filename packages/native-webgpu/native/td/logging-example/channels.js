let ticks = 0, frames = 0;
console.info('CHOP module loaded', {purpose: 'operator logging example'});
function setup(host) {
  console.log('CHOP setup');
  function tick() {
    host.outputs.set('ticks', ++ticks);
    console.debug('CHOP independent timer', ticks);
    setTimeout(tick, 250);
  }
  setTimeout(tick, 250);
}
function onCook(host) {
  host.outputs.set('frames', ++frames);
  if (frames % 60 === 1) console.info('CHOP frame', frames);
}
function onPulse(name) {
  console.warn('CHOP pulse', name, {ticks, frames});
  if (name === 'ErrorMessage') console.error(new Error('A console message; execution continues'));
  if (name === 'Throw') throw new Error('An actual thrown exception');
}
