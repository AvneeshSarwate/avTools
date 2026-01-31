export type WindowEvent =
  | { type: "key"; key: string; down: boolean }
  | { type: "mouse_move"; x: number; y: number }
  | { type: "mouse_button"; button: number; down: boolean; x: number; y: number }
  | { type: "scroll"; dx: number; dy: number }
  | { type: "resize"; width: number; height: number }
  | { type: "close" };
