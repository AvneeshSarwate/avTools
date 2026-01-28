export type PortInfo = {
  id: string;
  name: string;
};

export type CCEvent = {
  channel: number;
  ctrlNum: number;
  ctrlVal: number;
  tsUs: number;
};

export type PitchBendEvent = {
  channel: number;
  bend: number;
  tsUs: number;
};

export type ChannelPressureEvent = {
  channel: number;
  pressure: number;
  tsUs: number;
};

export type PolyPressureEvent = {
  channel: number;
  noteNum: number;
  pressure: number;
  tsUs: number;
};

export type ProgramChangeEvent = {
  channel: number;
  program: number;
  tsUs: number;
};

export type NoteOnEvent = {
  channel: number;
  noteNum: number;
  velocity: number;
  tsUs: number;
};

export type NoteOffEvent = {
  channel: number;
  noteNum: number;
  velocity: number;
  tsUs: number;
};

export type NoteEvent = {
  channel: number;
  noteNum: number;
  on: boolean;
  velocity: number;
  tsUs: number;
};

export type TickPayload = {
  tsUs: number;
  droppedRaw: number;
  droppedNote: number;
  ccChanges: CCEvent[];
  pbChanges: PitchBendEvent[];
  chPressureChanges: ChannelPressureEvent[];
  polyPressureChanges: PolyPressureEvent[];
  programChanges: ProgramChangeEvent[];
  noteEvents: NoteEvent[];
};
