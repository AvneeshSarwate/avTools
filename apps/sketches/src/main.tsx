import ReactDOM from "react-dom/client";
import "./styles.css";
import { SplitSweepApp } from "./sketches/splitSweep/App";

// One sketch so far; add entries here and pick with ?sketch=<name>.
const sketches: Record<string, () => React.ReactElement> = {
  "split-sweep": () => <SplitSweepApp />,
};
const name = new URLSearchParams(location.search).get("sketch") ?? "split-sweep";
const Sketch = sketches[name] ?? sketches["split-sweep"];

ReactDOM.createRoot(document.getElementById("root")!).render(<Sketch />);
