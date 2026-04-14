# animation-editor bridge — dense reference

Source: `../tools/animationEditorAdapter.ts` + `../tools/animationEditorWebSocketClient.ts`. Multi-animation keyframe editor that runs in its own native window (wry webview), bound to the sketch via WebSocket.

## One-time setup

```ts
const animationBridge = createAnimationEditorBridge({
  management: {
    trackInputs: paramSystem.trackInputs,
    syncRef,                    // { enabled: boolean }
    playbackRef: animationPlayback,
    snapshotCurrentState: (animationName, time) => {
      snapshotToAnimation(params, paramSystem.paramMeta, animationBridge.tracks, animationName, time);
    },
  },
});

animationBridge.tracks.setFromInputs("default", paramSystem.trackInputs);   // seed animation named "default"

const animationHandle = animationBridge.showBoundInWindow(renderWindow.window, "default", {
  title: "Animation Editor",
  panelWidth: 1100, panelHeight: 760,
});

animationHandle.setCallbacks(createAnimationCallbacks(
  params, paneBindings, paramSystem.paramMeta, paramSystem.actionMap, syncRef,
));
```

`showBoundInWindow(gpuWindow, animationName, options?)` opens a second native webview linked to the sketch's main window (cleanup ties to the main window's `close`). Use `showBound(name)` in a notebook context; `showBoundInWindow` is the standalone-sketch variant.

## Handle API (used every frame by the root loop)

```ts
interface AnimationEditorHandle {
  latestTracks: TrackData[] | undefined;
  client: AnimationEditorWebSocketClient | undefined;
  disconnect(): void;
  setLivePlayhead(position: number): void;        // visual cursor only
  scrubToTime(time: number): void;                 // set playhead; DO NOT apply values
  scrubAndEvaluate(time: number): void;            // set playhead AND apply values to params via callbacks
  setCallbacks(callbacks: TrackCallbacks): void;
}
```

Frame-loop usage pattern (see `sketch.ts` rootAnim):
```ts
if (lastAppliedTime === null || Math.abs(t - lastAppliedTime) > 1e-6) {
  animationHandle.scrubAndEvaluate(t);      // any change: evaluate & apply
  lastAppliedTime = t;
} else if (playbackSignature !== lastSignature) {
  animationHandle.scrubToTime(t);            // same time, but play/loop/speed changed
}
animationHandle.setLivePlayhead(t);
```

The "evaluate" pass calls `updateNumber`/`updateEnum`/`updateFunc` on the callbacks, which mutate `params`. Without `scrubAndEvaluate`, playhead moves visually but `params` doesn't change.

## AnimationPlaybackState

```ts
interface AnimationPlaybackState {
  playing: boolean;
  currentTime: number;
  duration: number;
  loop: boolean;
  speed: number;
}
```

Shared by the editor and the sketch. The editor's play/loop/duration/speed controls mutate this object; the sketch's root loop advances `currentTime` based on `playing`, `speed`, and `loop`, then pushes the new time back via `scrubAndEvaluate`.

Your root loop is the source of truth for `currentTime` advancement; the editor is the source of truth for the other fields.

## TrackMap (animationBridge.tracks)

```ts
bridge.tracks.setFromInputs(name, trackInputs, options?);   // create/replace animation from paramSystem output
bridge.tracks.set(name, tracks, trackOrder?, options?);     // raw TrackData[] set
bridge.tracks.get(name): TrackData[] | undefined;
bridge.tracks.getFull(name): { tracks, trackOrder } | undefined;
bridge.tracks.has(name);
bridge.tracks.delete(name, { disconnectBoundSessions? });
bridge.tracks.clear();
bridge.tracks.keys();
```

Track types are: `number` (interpolated), `enum` (stepped), `func` (callable at keyframe).

## TrackCallbacks (what playback fires)

```ts
interface TrackCallbacks {
  updateNumber(trackName: string, value: number): void;
  updateEnum(trackName: string, value: string): void;
  updateFunc(trackName: string, funcName: string): void;
}
```

`createAnimationCallbacks(params, paneBindings, paramMeta, actionMap, syncRef)` returns these with the right semantics — use it rather than rolling your own.

## Shutdown

```ts
function cleanup() {
  rootAnim.cancel();
  animationHandle.disconnect();
  animationBridge.shutdown();
  // …then dispose shader chain and p5…
}
```

`animationBridge.shutdown()` tears down the HTTP bridge server; it's idempotent across cell re-runs.

## Management options recap

`management` inside `createAnimationEditorBridge` tells the editor about the sketch-side state it can read/command:

- `trackInputs` — used to present the correct track shape when creating a new animation.
- `syncRef` — if `enabled`, param changes from playback also refresh the tweakpane UI.
- `playbackRef` — shared `AnimationPlaybackState`; editor sends `setPlaying`/`setCurrentTime`/`setLoop`/`setSpeed`/`setDuration` messages that mutate this object.
- `snapshotCurrentState(animationName, time)` — called when the editor's "snapshot" button fires; write param values as keyframes.

## Gotchas

- **Use `showBoundInWindow` in standalone sketch context**, `showBound` for Jupyter/notebook context.
- Always `animationHandle.setCallbacks(...)` after creation — the editor will send func-track triggers that no-op until callbacks are set.
- **Don't create new animations on every run** when a bound session is long-lived; call `tracks.setFromInputs` once and let it persist.
- `duration` of 0 is valid and causes the root loop to clamp `currentTime` to 0 and stop playback.
- Deleting a bound animation disconnects the webview unless `disconnectBoundSessions: false` is passed.
- `scrubAndEvaluate(t)` walks every track in the animation at `t`, firing callbacks. Calling it every frame is fine, but gate on "time actually changed" to skip redundant work.
