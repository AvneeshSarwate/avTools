import { XMLParser } from "npm:fast-xml-parser@4.3.5";
import { AbletonClip, type AbletonNote, createCurveValue, type CurveValue } from "@avtools/music-types";

type ParsedClips = {
  byName: Map<string, AbletonClip>;
  byPosition: Map<string, AbletonClip>;
};

function arrayWrap<T>(maybeArray: T | T[] | undefined | null): T[] {
  if (maybeArray === undefined || maybeArray === null) return [];
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

async function gunzipToString(bytes: Uint8Array): Promise<string> {
  if ("DecompressionStream" in globalThis) {
    const ds = new DecompressionStream("gzip");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decompressed = await new Response(new Blob([buffer]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }

  const { ungzip } = await import("npm:pako@2.1.0");
  const result = ungzip(bytes);
  return new TextDecoder().decode(result);
}

function parseXmlNote(xmlNote: Record<string, string>, pitchStr: string): AbletonNote {
  const pitch = Number(pitchStr);
  const duration = Number(xmlNote["@_Duration"] ?? 0);
  const velocity = Number(xmlNote["@_Velocity"] ?? 0);
  const offVelocity = Number(xmlNote["@_OffVelocity"] ?? velocity);
  const probability = Number(xmlNote["@_Probability"] ?? 1);
  const isEnabled = !(xmlNote["@_IsEnabled"] === "false");
  const position = Number(xmlNote["@_Time"] ?? 0);
  const velocityDeviation = xmlNote["@_VelocityDeviation"] !== undefined
    ? Number(xmlNote["@_VelocityDeviation"])
    : undefined;
  const noteId = xmlNote["@_NoteId"] !== undefined ? String(xmlNote["@_NoteId"]) : undefined;

  return {
    pitch,
    duration,
    velocity,
    offVelocity,
    probability,
    position,
    isEnabled,
    noteId,
    velocityDeviation,
  };
}

function parseCurveValues(eventList: any): CurveValue[] {
  const events = arrayWrap(eventList?.Events?.PerNoteEvent);
  return events.map((evt) =>
    createCurveValue(
      Number(evt?.["@_TimeOffset"] ?? 0),
      Number(evt?.["@_Value"] ?? 0),
      Number(evt?.["@_CurveControl1X"] ?? 0.5),
      Number(evt?.["@_CurveControl1Y"] ?? 0.5),
      Number(evt?.["@_CurveControl2X"] ?? 0.5),
      Number(evt?.["@_CurveControl2Y"] ?? 0.5),
    )
  );
}

function applyCurveToNote(note: AbletonNote, cc: string, curveVals: CurveValue[]) {
  if (cc === "-1") note.pressureCurve = curveVals;
  else if (cc === "-2") note.pitchCurve = curveVals;
  else if (cc === "74") note.timbreCurve = curveVals;
}

export async function parseAbletonLiveSetDetailed(alsPath: string): Promise<ParsedClips> {
  const bytes = await Deno.readFile(alsPath);
  const xml = await gunzipToString(bytes);

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const clipMap = new Map<string, AbletonClip>();
  const positionMap = new Map<string, AbletonClip>();

  const tracks = arrayWrap(parsed?.Ableton?.LiveSet?.Tracks?.MidiTrack);
  tracks.forEach((track: any, trackIndex: number) => {
    const clipSlotList = arrayWrap(track?.DeviceChain?.MainSequencer?.ClipSlotList?.ClipSlot);
    clipSlotList.forEach((slot: any, slotIndex: number) => {
      const midiClip = slot?.ClipSlot?.Value?.MidiClip;
      if (!midiClip) return;
      const clip = Array.isArray(midiClip) ? midiClip[0] : midiClip;

      const keyTracks = arrayWrap(clip?.Notes?.KeyTracks?.KeyTrack);
      const notes: AbletonNote[] = [];
      const noteMap = new Map<string, AbletonNote>();

      keyTracks.forEach((keyTrack: any) => {
        if (!keyTrack) return;
        const pitchStr = keyTrack?.MidiKey?.["@_Value"];
        const xmlNotes = arrayWrap(keyTrack?.Notes?.MidiNoteEvent);
        xmlNotes.forEach((note: any) => {
          const parsedNote = parseXmlNote(note, pitchStr);
          notes.push(parsedNote);
          if (parsedNote.noteId) {
            noteMap.set(parsedNote.noteId, parsedNote);
          }
        });
      });

      const perNoteLists = arrayWrap(clip?.Notes?.PerNoteEventStore?.EventLists?.PerNoteEventList);
      perNoteLists.forEach((eventList: any) => {
        const noteId = String(eventList?.["@_NoteId"] ?? "");
        const cc = String(eventList?.["@_CC"] ?? "");
        if (!noteId || !cc) return;
        const curveVals = parseCurveValues(eventList);
        const note = noteMap.get(noteId);
        if (!note) return;
        applyCurveToNote(note, cc, curveVals);
      });

      notes.sort((a, b) => a.position - b.position);

      let clipName = clip?.Name?.["@_Value"] ?? "";
      if (clipName === "") {
        clipName = `clip_${trackIndex + 1}_${slotIndex + 1}`;
      }

      const duration = Number(clip?.CurrentEnd?.["@_Value"] ?? clip?.LoopEnd?.["@_Value"] ?? 0);
      const abletonClip = new AbletonClip(clipName, duration, notes);
      clipMap.set(clipName, abletonClip);
      positionMap.set(`${trackIndex + 1}-${slotIndex + 1}`, abletonClip);
    });
  });

  return { byName: clipMap, byPosition: positionMap };
}

export async function parseAbletonLiveSet(alsPath: string): Promise<Map<string, AbletonClip>> {
  const result = await parseAbletonLiveSetDetailed(alsPath);
  return result.byName;
}
