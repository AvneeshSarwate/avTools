import { BaseBoxShapeUtil, createShapeId, T, type Editor, type TLShape } from "tldraw";
import { registerSixSinesEditor } from "../../../../packages/six-sines/ui/six-sines-editor.js";
import { listSixSines, SIX_SINES_TYPE } from "../store/sixSines";
import { SixSinesView } from "./SixSinesView";

import { instrumentPosition } from "./index";

registerSixSinesEditor();

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [SIX_SINES_TYPE]: { w: number; h: number; name: string; preset: string; parameters: Record<string, number> };
  }
}

export type SixSinesShape = TLShape<typeof SIX_SINES_TYPE>;

const WIDTH = 1260;
const HEIGHT = 1140;

export function createSixSinesShape(editor: Editor) {
  const id = createShapeId();
  const names = new Set(listSixSines(editor).map((shape) => shape.props.name));
  let index = 1;
  while (names.has(`Six Sines ${index}`)) index++;
  editor.markHistoryStoppingPoint("create Six Sines");
  editor.createShape<SixSinesShape>({
    id,
    type: SIX_SINES_TYPE,
    ...instrumentPosition(editor, WIDTH, HEIGHT),
    props: { name: `Six Sines ${index}` },
  });
  return id;
}

export class SixSinesShapeUtil extends BaseBoxShapeUtil<SixSinesShape> {
  static override type = SIX_SINES_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    name: T.string,
    preset: T.string,
    parameters: T.dict(T.string, T.number),
  };

  override getDefaultProps() {
    return { w: WIDTH, h: HEIGHT, name: "Six Sines", preset: "", parameters: {} };
  }

  override canScroll() {
    return true;
  }

  override component(shape: SixSinesShape) {
    return <SixSinesView shape={shape} />;
  }

  override getIndicatorPath(shape: SixSinesShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
