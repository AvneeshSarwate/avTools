(async()=>{
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1)};};
 for(const hz of [60,240,1000]){
  const samples=[],count=hz*2;const start=performance.now();
  await new Promise(resolve=>{
   let index=1;
   const tick=()=>{samples.push(performance.now()-(start+index*1000/hz));if(++index>count){resolve();return;}setTimeout(tick,Math.max(1,start+index*1000/hz-performance.now()));};
   setTimeout(tick,1000/hz);
  });
  console.log(JSON.stringify({suite:'timer-lateness',hz,milliseconds:summarize(samples),raw:samples}));
 }
 // Cancellation churn releases callback handles even for distant deadlines.
 for(let cycle=0;cycle<50;cycle++){for(let n=0;n<2000;n++){const id=setTimeout(()=>{throw Error('canceled callback fired');},60000);clearTimeout(id);}await sleep(1);}
 console.log(JSON.stringify({suite:'timer-churn',scheduled:100000,pass:true}));
})().catch(error=>{globalThis.failure=String(error.stack??error);console.error(failure);}).finally(()=>globalThis.done=true);
