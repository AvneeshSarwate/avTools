# feature-piano-roll-flows

Focused exercise of the named piano-roll store and its module helpers.

**Covers:** a module writing a roll into existence (`setPianoRollClip`
creates missing names), a read-transform-write module, a module that plays a
roll live and picks up GUI edits at loop boundaries (`playPianoRoll`),
multiple canvas views of one roll, and the entity CRUD flows
(create/duplicate/delete) through both the topbar and the raw HTTP surface.

## Opening it

Server (from `apps/deno-notebooks`):

```sh
deno run --unstable-webgpu --unstable-ffi --allow-all \
  livecode/visualizer/main.ts --host localhost --port 7777 --log-level debug
```

Client (from `apps/livecode-tldraw`): `npm run dev`, then open

```text
http://localhost:5173/?projectPath=<absolute path to this directory>
```

## Manual verification checklist

1. **Open.** Three code shapes and three roll views: two views of
   `rolls/loop` and one of `rolls/loop-echo`. All three show a waiting
   placeholder — the entities do not exist until something creates them.
2. **Run `seed the loop`.** It ends on its own after ~0.1 s and **both**
   `rolls/loop` views show the same four-note phrase: two views, one entity.
3. **Edit in one view, watch the other.** Drag or draw notes in the top loop
   view: the second view follows within a snapshot tick, while the view you
   are editing does not flicker (echo suppression is per shape).
4. **Run `echo writer`.** The echo view fills with the loop's notes an octave
   up and softer. Re-run it after more edits to refresh the copy.
5. **Run `loop player`.** With a MIDI output present (defaults to a name
   containing "IAC Driver Bus 1"; override with the `LIVECODE_MIDI_OUTPUT`
   env var on the server) you hear the loop at 0.25 s/beat; without MIDI it
   advances silently. Edit loop notes while it plays: the change lands at the
   next pass. Stop cleanly ends any sounding note.
6. **Gutter widgets.** Each `🎹 open rolls/…` widget selects/zooms the
   matching view, or creates one beside the code shape.
7. **Replace while running.** With the player running, change
   `secondsPerBeat: 0.25` to `0.125` in its source. The Run button now reads
   **Replace**; click it. The tempo doubles at the swap and the other modules
   are untouched.
8. **Entity CRUD from the topbar.** Select exactly one `rolls/loop` view:
   - **Duplicate entity** (prefilled `rolls/loop-copy`): a new view of the
     copy appears beside the source with the same notes.
   - **Delete entity** on the copy: the button rearms to
     `Really delete rolls/loop-copy?`; confirm. The copy's view stays and
     returns to its waiting placeholder — views outlive entities.
   - **New piano roll** with a brand-new name creates the entity plus a view;
     with an existing name it only adds another view (dual-mode).
9. **Entity CRUD over HTTP (agent surface).**

   ```sh
   curl -s -X POST localhost:7777/entities/create -H 'content-type: application/json' \
     -d '{"type":"pianoRoll","name":"rolls/scratch"}'
   curl -s -X POST localhost:7777/entities/duplicate -H 'content-type: application/json' \
     -d '{"type":"pianoRoll","name":"rolls/loop","targetName":"rolls/loop-copy2"}'
   curl -s -X POST localhost:7777/entities/delete -H 'content-type: application/json' \
     -d '{"type":"pianoRoll","name":"rolls/scratch"}'
   curl -s localhost:7777/piano-roll/list | head -c 500
   ```

   Creating an existing name returns 409; deleting a missing one returns 404.
10. **Optional: undo over HTTP.** GUI note edits are undoable server-side:

    ```sh
    curl -s -X POST localhost:7777/piano-roll/undo -H 'content-type: application/json' \
      -d '{"name":"rolls/loop"}'
    ```

    Module writes (`setPianoRollClip`) are non-undoable by default.

## Expected-state notes

- Nothing in this project persists across a server restart: the rolls exist
  only in server memory until an explicit project save. The save/restore loop
  is exercised in `feature-studio-combined` and `feature-signals-and-scopes`
  (restore side only).
- Deleting an entity never deletes its views, and deleting a view never
  deletes the entity — the two removals are separate gestures.
- Layout changes (moving views/modules) write back to the manifest after a
  one-second debounce; `git checkout` this directory to discard them.
