import type {OnCook} from '@avtools/native-webgpu/td-chop';
// Four chained copies in the example demonstrate same-cook channel propagation.
export const onCook: OnCook = host => {
  host.outputs.set('value', host.inputs.get('value'));
};
