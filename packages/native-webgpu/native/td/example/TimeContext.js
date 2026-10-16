// No imports needed: the plugin bundles the canonical core-timing library.
let host, clock, frameClock;
let ticks=0, frames=0, phase=0, running=false, start=0;
function startClock(){
  if(running)return;
  running=true;
  clock=host.timing.launch(async ctx=>{
    try {
      while(true){
        await ctx.waitSec(1/60);
        ticks++;
        // Last cooked CHOP snapshot; missing names return zero.
        phase+=0.025+host.chop('amount')/10000;
      }
    }finally{running=false;}
  },{seed:'TimeContext example',debugName:'independent clock'});
}
function setup(p,h){
  host=h;start=performance.now();p.textSize(18);startClock();
  frameClock=h.timing.launchBrowser(async ctx=>{
    while(true){await ctx.waitFrame();frames++;}
  });
}
function onPulse(name){
  // Set Event Name to Trigger, start, stop, or reset, then press Send Pulse.
  if(name==='Trigger'){if(running)clock.cancel();else startClock();}
  else if(name==='start')startClock();
  else if(name==='stop')clock?.cancel();
  else if(name==='reset'){ticks=0;frames=0;phase=0;start=performance.now();}
}
function draw(p,frame){
  p.background(16,23,38);p.noStroke();p.fill(80,210,220);
  p.circle(p.width/2+Math.sin(phase)*p.width*.3,p.height*.72,48);
  p.fill(245);p.text('TimeContext: '+(running?'running':'stopped'),18,32);
  p.text('Realtime ticks: '+ticks,18,62);
  p.text('TD frames: '+frames,18,92);
  p.text('Wall seconds: '+((performance.now()-start)/1000).toFixed(1),18,122);
  p.text('Pause TD, wait, then resume.',18,152);
  p.text('Timers continue; frame waits pause.',18,182);
  // Headless checks read these small corner markers.
  p.fill(ticks%256,frames%256,running?255:0);p.rect(0,0,8,8);
}
