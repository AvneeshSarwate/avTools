## static code analysis => visual node linking

this could be another "big idea" to investigate, as big as the
time-visualization stuff

- example: for piano rolls, you have the library call in the function that
  referces a piano roll, and the piano rolls visible in the UI. need to add
  static analysis that looks at what pianoRoll ids are explicitly detected in
  module code, and if an instance of that piano roll is open in the UI, draws a
  little connector line from the code to the UI.
  - don't need to worry about complex code cases with constructed piano roll ids
    or such
  - need to think about what to do if there are multiple views of same piano
    roll - link all? or just grab nearest one

## initial architecture idea - no blessed orchestrators

All "loops" besides module-launch should be done "in app". For example, for an
audiovisual sketch you want to livecode, all of the shared state (definitions
and variables) are a single module in tldrawy, the window managment and draw
loop is another (just reads shared state), slider definitions can be another
(write to shared state), and then all dynamic processes just write to shared
state too.

some core things that need to be worked out for this

- tldraw modules need to be able to import each other - can't just have them
  write to temp files?
  - this immediately might mean you need to init a project directory for a
    session to not totally spam your repo?
- need to work out some necessary execution order related things for "app level
  singletons"
  - eg, maybe need to init a window context before you can start the draw loop?
    is this an issue if you don't have them in the same module?
  - could have a pattern like in the initial browser sketches - eg, shared state
    definition module is intialized first, and includes a handle to
    webGPU-device (inits as none). actual initialzer module runs and writes to
    it. other draw modules can pull it as necessary (but ideally, shouldn't need
    this much)
  - ideally, most of the work during performance is just modifying modules that
    read/write shared state
- might need some kind of clean "restart all" for when you need to change the
  shape of your shared state (will need to kill/restart drawloop with new state,
  or worse, kill/restart windows?)

## view vs edit mode of modules

much like for the sonar_sketch editor, you could have tldraw code modules be
either in edit or run/view mode. when you execute a module, it could switch to
view mode and cease to be editable until stopped. then in view mode, you could
do all kinds of run-time data code-view augmentation (eg, like in sonar_sketch,
inject slider values over the variables where they are used). View mode could
also help solve the problem of the user not knowing whether the version of code
in a buffer is currently running or not. if tldraw code modules can import other
modules, you could even see about doing this transitiviely? eg if the run-loop
module imports the state module, then hitting run on the run-loop also makes the
state module view-mode. You'd still have live-codeable modules that modify
state, but then those would see a view-only state module so you know what shape
you're dealing with

## general todos and smaller ideas

- module structure and relationships need to be cleaned up - module level
  instantiations (eg, piano roll store, midi init) should happen in a unified
  way (how is tbd). maybe force editor scripts to init the modules via an
  idempotent module level init func. editor scripts are modules so have access
  to top level await and can `await init()` before defining their `run()`
  function - the small amount of boiler plate is worth it for "no magic"
  understandability
- figure out some solution for persistence keys for the UI (quick flag to allow
  refreshes while developing stuff), and then also file-system data saving for
  "projects"
- add the ability to have agent send commands to running UI to steer it (eg,
  create piano roll with id, add/modify ntoes in piano roll, create code block,
  start/stop code block)
- add known data ids into text editors so you can use playwrite or something
  like that to add the code back to the editors?
- maybe refactor piano roll client/server websocket sync libs so that old ones
  for notebook sync and apps/scene-inspector can also be used with the
  livecode-tldraw one
