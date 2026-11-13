const launchParamKeys = ["hue", "randomColor", "duration", "radius", "waveAmp", "waveFreq"]
const launchTypes = ["up", "down", "left", "right", "cw", "ccw"]

function parseLaunchStringToLaunchConfig(launchString: string) {
  const lines = launchString.split('\n').filter(s => s.length > 0)
  const launchHits = lines.map(l => {
    const tokens = l.split(" ").filter(t => t.length > 0)
    if(tokens.length == 0) return

    const delay = parseFloat(tokens.shift()!)
    if(isNaN(delay)) return

    const launchType = tokens.shift()!
    if (!launchTypes.includes(launchType)) return
    
    if (tokens.length % 2 != 0) return
    const secondAreNumbers = tokens.map((t, i) => {
      if (i % 2 == 0) return true
      else return !isNaN(parseFloat(t))
    }).reduce((a, b) => a && b, true)
    
    if (!secondAreNumbers) return 
    
    const params: Record<string,  number> = {}
    for (let i = 0; i < tokens.length; i += 2) {
      params[tokens[i]] = parseFloat(tokens[i+1])
    }

    return {delay, launchType, params}
  })

  return launchHits
}


const string = `
0 cw randomColor 1
0 ccw randomColor 1
`

const parsed = parseLaunchStringToLaunchConfig(string)

console.log(parsed)