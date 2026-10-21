let ticks = 0, frames = 0;
console.info('TOP module loaded', {purpose: 'operator logging example'});
function setup(p) {
  console.log('TOP setup');
  p.textSize(24);
  function tick() {
    console.debug('TOP independent timer', ++ticks);
    setTimeout(tick, 250);
  }
  setTimeout(tick, 250);
}
function draw(p) {
  frames++;
  p.background(20, 28, 45);
  p.noStroke(); p.fill(255, 180, 70);
  p.circle(256 + Math.sin(frames / 40) * 150, 210, 100);
  p.fill(255); p.text('console → Info DAT', 45, 340);
  p.text('frames ' + frames + '   timer ' + ticks, 45, 380);
  if (frames % 60 === 1) console.info('TOP frame', frames);
}
function onPulse(name) {
  console.warn('TOP pulse', name, {ticks, frames});
  if (name === 'ErrorMessage') console.error(new Error('A console message; execution continues'));
  if (name === 'Throw') throw new Error('An actual thrown exception');
}
