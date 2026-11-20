import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { outputLevel } from "./audio/engine";
import "./styles.css";

if (import.meta.env.DEV) (window as unknown as { fmLevel: () => number }).fmLevel = outputLevel;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
