import type {Setup, Draw} from '@avtools/native-webgpu/td-sketch';
import type {ParameterDefinitions} from '@avtools/native-webgpu/td-parameters';
import {
  bakeDrawingDocument, createEmptyDrawingDocument, sampleCurveSegments,
  type FlattenedStrokeGroup, type FlattenedStroke,
} from '../../../packages/drawing-document/mod.ts';
import {subscribeDrawing} from '../shared/subscribe.ts';

export const parameters = {
  Server: {type: 'string', label: 'Drawing URL', default: 'ws://127.0.0.1:5177/canvas?drawing=main'},
  Weight: {type: 'float', label: 'Line Weight', default: 3, min: 0.5, max: 16},
} as const satisfies ParameterDefinitions;

let drawing = bakeDrawingDocument(createEmptyDrawingDocument());
let polygons: Array<Array<{x: number; y: number}>> = [];

export const setup: Setup<typeof parameters> = (_p, host) => {
  // Changing Server requires Reset. A disconnect preserves the last drawing.
  subscribeDrawing(host, host.params.Server, document => {
    drawing = bakeDrawingDocument(document);
    // Curve sampling belongs to the edit callback, not every rendered frame.
    polygons = drawing.polygon.map(shape => shape.segments
      ? sampleCurveSegments(shape.segments) : shape.points);
  }, status => console.log('Canvas:', status));
};

export const draw: Draw<typeof parameters> = (p, frame) => {
  p.background(20, 28, 35);
  p.push();
  p.scale(frame.width / 1280, frame.height / 720);
  p.noFill();
  p.stroke(96, 215, 180);
  p.strokeWeight(frame.params.Weight);

  function stroke(shape: FlattenedStroke | FlattenedStrokeGroup) {
    if (shape.type === 'strokeGroup') { for (const child of shape.children) stroke(child); return; }
    p.beginShape();
    for (const point of shape.points) p.vertex(point.x, point.y);
    p.endShape();
  }
  for (const group of drawing.freehand) stroke(group);
  for (const points of polygons) {
    p.beginShape();
    for (const point of points) p.vertex(point.x, point.y);
    p.endShape(p.CLOSE);
  }
  for (const circle of drawing.circle) {
    p.push();
    p.translate(circle.center.x, circle.center.y);
    p.rotate(circle.rotation);
    p.ellipse(0, 0, circle.rx * 2, circle.ry * 2);
    p.pop();
  }
  p.pop();
};
