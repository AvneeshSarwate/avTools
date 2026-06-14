- module structure and relationships need to be cleaned up - module level instantiations (eg, piano roll store, midi init) should happen in a unified way (how is tbd). maybe force editor scripts to init the modules via an idempotent module level init func. editor scripts are modules so have access to top level await and can `await init()` before defining their `run()` function - the small amount of boiler plate is worth it for "no magic" understandability
- figure out some solution for persistence keys for the UI (quick flag to allow refreshes while developing stuff), and then also file-system data saving for "projects"
- add the ability to have agent send commands to running UI to steer it (eg, create piano roll with id, add/modify ntoes in piano roll, create code block, start/stop code block) 
- add known data ids into text editors so you can use playwrite or something like that to add the code back to the editors?
- maybe refactor piano roll client/server websocket sync libs so that old ones for notebook sync and apps/scene-inspector can also be used with the livecode-tldraw one



## static code analysis => visual node linking
this could be another "big idea" to investigate, as big as the time-visualization stuff
- example for piano rolls, you have the library call in the function that referces a piano roll, and the piano rolls visible in the UI. need to add static analysis that looks at what pianoRoll ids are explicitly detected in module code, and if an instance of that piano roll is open in the UI, draws a little connector line from the code to the UI. 
  - don't need to worry about complex code cases with constructed piano roll ids or such
  - need to think about what to do if there are multiple views of same piano roll - link all? or just grab nearest one 