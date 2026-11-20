import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { outputLevel, sixSines, warmEngines } from "./audio/engine";
import "./styles.css";

if (import.meta.env.DEV) Object.assign(window, { fmLevel: outputLevel, fmSixSines: sixSines });

// Load both worklets and the Six Sines wasm while the first page is being read.
warmEngines();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
