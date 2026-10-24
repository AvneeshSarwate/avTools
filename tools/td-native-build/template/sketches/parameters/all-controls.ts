import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';
import type {OnCook, OnPulse} from '@avtools/native-webgpu/td-chop';

// CHOP: Output Channels = value count x y z red alpha textlength pulses
// Output Samples = 1. Controls can also be driven by TD expressions/exports/binds.
export const parameters = {
  Gain: {type: 'float', default: 1, min: 0, max: 4},
  Count: {type: 'int', default: 3, min: 1, max: 20, clamp: true},
  Enabled: {type: 'toggle', default: true},
  Caption: {type: 'string', default: 'Hello TD'},
  Mode: {type: 'menu', options: ['multiply', 'add'], labels: ['Multiply', 'Add']},
  Position: {type: 'xy', default: [0.25, 0.75], page: 'Vectors'},
  Direction: {type: 'xyz', default: [0, 0, 1], min: -1, max: 1, page: 'Vectors'},
  Color: {type: 'rgb', default: [1, 0.4, 0.1], page: 'Vectors'},
  Tint: {type: 'rgba', default: [1, 1, 1, 0.5], page: 'Vectors'},
  Trigger: {type: 'pulse', label: 'Count Event'},
} as const satisfies ParameterDefinitions;
let pulses = 0;
export const onPulse: OnPulse<typeof parameters> = name => {
  if (name === 'Trigger') pulses++;
};
export const onCook: OnCook<typeof parameters> = host => {
  const p = host.params; // This callback's frozen snapshot; tuples are readonly.
  const input = host.inputs.get('value'); // Missing input = 0.
  host.outputs.set('value', !p.Enabled ? input : p.Mode === 'multiply' ? input * p.Gain : input + p.Gain);
  host.outputs.set('count', p.Count);
  host.outputs.set('x', p.Position[0]); host.outputs.set('y', p.Position[1]);
  host.outputs.set('z', p.Direction[2]); host.outputs.set('red', p.Color[0]);
  host.outputs.set('alpha', p.Tint[3]); host.outputs.set('textlength', p.Caption.length);
  host.outputs.set('pulses', pulses);
};
