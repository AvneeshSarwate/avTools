import { launch, type DateTimeContext } from "@avtools/core-timing";
import { createOSCClient } from "@/tools/osc.ts";

const client = createOSCClient("127.0.0.1", 10000);

const baseRectangleConfig = [
  { yPos: 0.4, height: 0.1 },
  { yPos: 0.15, height: 0.15 },
  { yPos: -0.25, height: 0.25 },
]

client.send('yPos0', baseRectangleConfig[0].yPos)
client.send('height0', baseRectangleConfig[0].height)
client.send('yPos1', baseRectangleConfig[1].yPos)
client.send('height1', baseRectangleConfig[1].height)
client.send('yPos2', baseRectangleConfig[2].yPos)
client.send('height2', baseRectangleConfig[2].height)

const liveRectVals = baseRectangleConfig.map(o => ({...o}))

function choose2NoReplacement(N: number) {
  if (!Number.isInteger(N) || N < 2) {
    throw new Error("N must be an integer >= 2");
  }

  const a = Math.floor(Math.random() * N);
  const b = Math.floor(Math.random() * (N - 1));
  // Map b from [0..N-2] into [0..N-1] \ {a}
  const bMapped = b >= a ? b + 1 : b;

  return [a, bMapped];
}

const SWAP_TIME = 3
const BETWEEN_SWAP_TIME = 10

const lerp = (a: number, b: number, p: number) => b*p + a*(1-p)

launch(async (ctx: DateTimeContext) => {
  while (true) {

    const [iA, iB] = choose2NoReplacement(liveRectVals.length)

    ctx.branch(async ctx => {
      const lerpStartTime = ctx.beats
      const lrv = liveRectVals

      let yPosA = lerp(lrv[iA].yPos, lrv[iB].yPos, 0)
      let yPosB = lerp(lrv[iB].yPos, lrv[iA].yPos, 0)
      let heightA = lerp(lrv[iA].height, lrv[iB].height, 0)
      let heightB = lerp(lrv[iB].height, lrv[iA].height, 0)


      while (ctx.beats < lerpStartTime + SWAP_TIME) {
        const normProg = (ctx.beats - lerpStartTime) / SWAP_TIME
        
        yPosA = lerp(lrv[iA].yPos, lrv[iB].yPos, normProg)
        yPosB = lerp(lrv[iB].yPos, lrv[iA].yPos, normProg)
        heightA = lerp(lrv[iA].height, lrv[iB].height, normProg)
        heightB = lerp(lrv[iB].height, lrv[iA].height, normProg)

        client.send(`/yPos${iA}`, yPosA)
        client.send(`/height${iA}`, yPosB)
        client.send(`/yPos${iB}`, heightA)
        client.send(`/height${iB}`, heightB)
        console.log(yPosA, yPosB, heightA, heightB)
        await ctx.wait(0.016)
      }
      liveRectVals[iA].yPos = yPosA
      liveRectVals[iB].yPos = yPosB
      liveRectVals[iA].height = heightA
      liveRectVals[iA].height = heightB
    })


    // client.send("/hello", "world", ctx.beats);
    await ctx.wait(BETWEEN_SWAP_TIME);
  }
}, { bpm: 60 });
