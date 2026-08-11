

I want to build a canvas based livecoding environment for music and graphics. The code editor is in the canvas, and uses projectional editting techniques to visualze code execution in a way that can help with both creative exploration and live performance. The canvas also acts as a game-engine like authoring environment, showing interactive views of live data (eg, a piano roll you can edit while a code-module is actively playing music from the melody-instance bound ot that piano roll view). I want to leverage typescript compiler extensions to allow for automatic instrumentation of different data structures or library usage patterns (eg, how the timing-library detection is done to drive wait-visualization) - this would allow the system to express constraints around library usage that could be helpful to the users, because there can be many state-mangling pitfalls in an open-ended livecoding environment. The system should also have some API that is accessible to a coding agent, so that it can both introspect live program state, and also write new modules in a "safe" and creative-context aware way.


want a canvas based tool so you can 
- look at multiple code modules at once (because their running might have interactions) 
- see code and visualizations/UI of underlying data at the same time 



