# MIDI Bridge Spec Gaps

## NRPN / RPN Multi-CC Sequences

NRPN (Non-Registered Parameter Number) and RPN use a sequence of CC messages that must be interpreted together:

1. CC 99 (NRPN MSB) - parameter number high byte
2. CC 98 (NRPN LSB) - parameter number low byte
3. CC 6 (Data Entry MSB) - value high byte
4. CC 38 (Data Entry LSB) - value low byte (optional, for 14-bit)

The coalescer treats each as an independent CC. If two different NRPN parameters are addressed between dispatch ticks:

```
CC 99=1, CC 98=0   -> select parameter 256
CC 6=100           -> set it to 100
CC 99=2, CC 98=5   -> select parameter 517
CC 6=50            -> set it to 50
```

The coalescer delivers: `CC 99=2, CC 98=5, CC 6=50` - the write to parameter 256 is lost entirely.

**Fix**: Detect CC 99/98/6/38 sequences in the coalescer and queue them as atomic multi-message events (like notes) rather than coalescing like plain CCs.

## 14-bit CC MSB/LSB Torn Reads

The convention where CC pairs (0+32, 1+33, etc.) form MSB+LSB for 14-bit resolution on a single parameter. If MSB and LSB update at different times relative to dispatch ticks, a stale MSB can be read with a new LSB (or vice versa), producing a glitched value for one tick.

**Severity**: Minor - only manifests at very low `rateHz` with 14-bit controllers.

## SysEx and System Messages Dropped

`input.rs:143` drops anything with `status >= 0xF0`. This filters out:

- SysEx (F0...F7) - no preset dumps, no device-specific control
- MIDI Clock (F8), Start (FA), Stop (FC), Continue (FB) - no transport/sync
- Active Sensing (FE), System Reset (FF)
- MTC Quarter Frame (F1), Song Position (F2), Song Select (F3)

This is intentional for the current artist-tool scope but blocks clock sync and device configuration use cases.

## MPE Channel Reuse Within a Dispatch Tick

When a note ends and a new note starts on the same MPE member channel within a single dispatch period (1/`rateHz` seconds), the TS MPE layer (`mpe.ts`) produces incorrect output. Example scenario:

```
t=0: CC74 ch2=120     (old note sliding)
t=1: NoteOff ch2 n=60
t=2: PB ch2=1024      (pre-note expression for new note)
t=3: CC74 ch2=64      (pre-note expression for new note)
t=4: NoteOn ch2 n=72
```

### Rust coalescer layer

CC74 coalesces to 64, PB to 1024. The old note's final CC74=120 is lost. Acceptable since the note is ending anyway.

### TS MPE layer bugs

The `#onTick` processing loop updates voice state in timestamp order:

1. NoteOff(ch2, n=60): `voice.ended = true`
2. PB/CC74 updates: `voice.dirty = true`, expression state overwritten
3. NoteOn(ch2, n=72): overwrites `voice.noteNum = 72`, `voice.started = true`

Then the dispatch phase runs checks in a fixed order (`started` → `dirty && !ended` → `ended`):

**Bug 1 — Wrong noteNum in onNoteEnd**: The voice's `noteNum` was overwritten to 72 by the new note-on before the end callback fires. `onNoteEnd` reports `noteNum: 72` instead of the correct `noteNum: 60`. Same problem for `velocity`.

**Bug 2 — Wrong event ordering**: `onNoteStart` fires before `onNoteEnd` because `started` is checked first. The listener sees note 72 start, then "note 72" end.

**Bug 3 — New note immediately killed**: Because `voice.ended` is true, `voice.noteNum` is set to null after the end callback. The note that just started (72) is immediately discarded from voice state.

### Net result

The listener sees: note 72 starts, note "72" immediately ends. The new note is stillborn and the old note (60) never gets a proper end event.

### Trigger conditions

Requires channel reuse within one dispatch period. At `rateHz: 200` that's a 5ms window — unlikely but possible with aggressive MPE controllers or channel-stealing scenarios (more active notes than available member channels). More likely at lower `rateHz` values.

**Fix**: The processing loop needs to handle the note-off before resetting voice state, either by splitting into two passes (end old notes first, then start new ones) or by saving the old note's identity before processing the note-on.

## Summary

| Issue | Severity | Likely to hit in practice? |
|---|---|---|
| NRPN multi-CC sequences coalesced away | Real bug | Only if you use NRPN hardware/software |
| 14-bit CC MSB/LSB torn reads | Minor glitch | Only at very low rateHz with 14-bit controllers |
| SysEx/system messages dropped | By design | Matters if you need clock sync or device config |
| MPE channel reuse within tick | Real bug | Aggressive MPE playing or low rateHz with channel stealing |
