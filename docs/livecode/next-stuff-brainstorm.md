
how would implementing something like midi-mapping for parameters via the GUI work?
- UI creates a binding that actually gets instantiated and persists in the server? 

how would implementing something like ableton clip-launcher style interface work?
- what's the desired patterns for UIs that would actually launch tasks rather than just write to data stores?

think of how to "bake" a project into something where the engine side can run in the browser (providing it's only using the broser compatibile libs, eg webgpu-graphics + soon-to-be-isomorphic midi). then find a way to set it up using Broadcast Message API so you can open control panel in one tab and engine in another