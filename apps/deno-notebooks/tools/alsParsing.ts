import { XMLParser } from "fast-xml-parser";
import { AbletonClip, type AbletonNote, createCurveValue, type CurveValue } from "@avtools/music-types";

type ParsedClips = {
  byName: Map<string, AbletonClip>;
  byPosition: Map<string, AbletonClip>;
};

type XmlNode = Record<string, unknown>;

function arrayWrap<T>(maybeArray: T | T[] | undefined | null): T[] {
  if (maybeArray === undefined || maybeArray === null) return [];
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

function asXmlNode(value: unknown): XmlNode | undefined {
  return value !== null && typeof value === "object" ? value as XmlNode : undefined;
}

function xmlPath(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    current = asXmlNode(current)?.[key];
    if (current === undefined) return undefined;
  }
  return current;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringOr(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

async function gunzipToString(bytes: Uint8Array): Promise<string> {
  if ("DecompressionStream" in globalThis) {
    const ds = new DecompressionStream("gzip");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decompressed = await new Response(new Blob([buffer]).stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(decompressed);
  }

  const { ungzip } = await import("pako");
  const result = ungzip(bytes);
  return new TextDecoder().decode(result);
}

function parseXmlNote(xmlNote: XmlNode, pitchValue: unknown): AbletonNote {
  const pitch = toNumber(pitchValue, 0);
  const duration = toNumber(xmlNote["@_Duration"], 0);
  const velocity = toNumber(xmlNote["@_Velocity"], 0);
  const offVelocity = toNumber(xmlNote["@_OffVelocity"], velocity);
  const probability = toNumber(xmlNote["@_Probability"], 1);
  const isEnabled = toStringOr(xmlNote["@_IsEnabled"], "true") !== "false";
  const position = toNumber(xmlNote["@_Time"], 0);
  const velocityDeviation = xmlNote["@_VelocityDeviation"] !== undefined
    ? toNumber(xmlNote["@_VelocityDeviation"], 0)
    : undefined;
  const noteId = xmlNote["@_NoteId"] !== undefined ? toStringOr(xmlNote["@_NoteId"]) : undefined;

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

function parseCurveValues(eventList: unknown): CurveValue[] {
  const events = arrayWrap(xmlPath(eventList, "Events", "PerNoteEvent"));
  return events.map((evt) =>
    createCurveValue(
      toNumber(xmlPath(evt, "@_TimeOffset"), 0),
      toNumber(xmlPath(evt, "@_Value"), 0),
      toNumber(xmlPath(evt, "@_CurveControl1X"), 0.5),
      toNumber(xmlPath(evt, "@_CurveControl1Y"), 0.5),
      toNumber(xmlPath(evt, "@_CurveControl2X"), 0.5),
      toNumber(xmlPath(evt, "@_CurveControl2Y"), 0.5),
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
  const parsed = parser.parse(xml) as unknown;

  const clipMap = new Map<string, AbletonClip>();
  const positionMap = new Map<string, AbletonClip>();

  const tracks = arrayWrap(xmlPath(parsed, "Ableton", "LiveSet", "Tracks", "MidiTrack"));
  tracks.forEach((track, trackIndex: number) => {
    const clipSlotList = arrayWrap(xmlPath(track, "DeviceChain", "MainSequencer", "ClipSlotList", "ClipSlot"));
    clipSlotList.forEach((slot, slotIndex: number) => {
      const midiClip = xmlPath(slot, "ClipSlot", "Value", "MidiClip");
      if (!midiClip) return;
      const clip = Array.isArray(midiClip) ? midiClip[0] : midiClip;

      const keyTracks = arrayWrap(xmlPath(clip, "Notes", "KeyTracks", "KeyTrack"));
      const notes: AbletonNote[] = [];
      const noteMap = new Map<string, AbletonNote>();

      keyTracks.forEach((keyTrack) => {
        if (!keyTrack) return;
        const pitchValue = xmlPath(keyTrack, "MidiKey", "@_Value");
        const xmlNotes = arrayWrap(xmlPath(keyTrack, "Notes", "MidiNoteEvent"));
        xmlNotes.forEach((note) => {
          const parsedNote = parseXmlNote(asXmlNode(note) ?? {}, pitchValue);
          notes.push(parsedNote);
          if (parsedNote.noteId) {
            noteMap.set(parsedNote.noteId, parsedNote);
          }
        });
      });

      const perNoteLists = arrayWrap(xmlPath(clip, "Notes", "PerNoteEventStore", "EventLists", "PerNoteEventList"));
      perNoteLists.forEach((eventList) => {
        const noteId = toStringOr(xmlPath(eventList, "@_NoteId"), "");
        const cc = toStringOr(xmlPath(eventList, "@_CC"), "");
        if (!noteId || !cc) return;
        const curveVals = parseCurveValues(eventList);
        const note = noteMap.get(noteId);
        if (!note) return;
        applyCurveToNote(note, cc, curveVals);
      });

      notes.sort((a, b) => a.position - b.position);

      let clipName = toStringOr(xmlPath(clip, "Name", "@_Value"), "");
      if (clipName === "") {
        clipName = `clip_${trackIndex + 1}_${slotIndex + 1}`;
      }

      const duration = toNumber(
        xmlPath(clip, "CurrentEnd", "@_Value") ?? xmlPath(clip, "LoopEnd", "@_Value"),
        0,
      );
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
