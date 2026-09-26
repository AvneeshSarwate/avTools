/**
 * The comparison page `tools/worst_cases.ts` writes next to its images:
 * scene tabs, variant buttons with their timings, keys 1-9 to flick between
 * variants (space returns to the previous one), a wipe slider between any
 * two, and a 1:1 pixel mode. Self-contained; opens from the file system.
 */

export interface ViewerResult {
  scene: string;
  segments: number;
  variants: { name: string; file: string; ms: number | null; rms: number }[];
}

export function viewerHtml(results: ViewerResult[]): string {
  const data = JSON.stringify(results).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radiance cascades: worst cases</title>
<style>
  :root { color-scheme: light dark; --bg: #f5f5f4; --fg: #1c1917; --muted: #78716c; --panel: #fff; --line: #d6d3d1; --accent: #2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --fg: #e7e5e4; --muted: #a8a29e; --panel: #1c1917; --line: #3f3f46; --accent: #60a5fa; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 16px; margin: 0 12px 0 0; }
  .tabs, .variants { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  button[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  button small { color: var(--muted); margin-left: 6px; }
  main { padding: 12px 16px; display: grid; gap: 12px; }
  .stage { position: relative; width: min(100%, 1400px); aspect-ratio: 2 / 1; background: #000; border: 1px solid var(--line); overflow: hidden; }
  .stage img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .stage img.wipe { clip-path: inset(0 0 0 var(--wipe, 100%)); }
  .stage .divider { position: absolute; top: 0; bottom: 0; left: var(--wipe, 100%); width: 2px; background: #fff; mix-blend-mode: difference; pointer-events: none; }
  .stage .label { position: absolute; top: 8px; padding: 2px 8px; background: rgba(0,0,0,.6); color: #fff; border-radius: 4px; font-size: 12px; }
  .stage .label.a { left: 8px; } .stage .label.b { right: 8px; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; color: var(--muted); }
  .controls select, .controls input[type=range] { font: inherit; }
  .controls input[type=range] { width: 240px; }
  .thumbs { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; width: min(100%, 1400px); }
  .thumbs figure { margin: 0; cursor: pointer; }
  .thumbs img { width: 100%; aspect-ratio: 2 / 1; object-fit: cover; border: 2px solid transparent; border-radius: 4px; }
  .thumbs figure[aria-current="true"] img { border-color: var(--accent); }
  .thumbs figcaption { font-size: 12px; color: var(--muted); padding: 2px 0; }
  kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; }
  body.pixel .stage { width: 1000px; max-width: none; }
</style>
<header>
  <h1>Worst cases</h1>
  <nav class="tabs" id="tabs"></nav>
  <span class="variants" id="variants"></span>
</header>
<main>
  <div class="controls">
    <span>Keys <kbd>1</kbd>–<kbd>4</kbd> pick a variant, <kbd>space</kbd> flicks back to the previous one, <kbd>←</kbd> <kbd>→</kbd> change scene.</span>
    <label>Wipe against <select id="wipeSel"></select></label>
    <input type="range" id="wipe" min="0" max="100" value="50">
    <label><input type="checkbox" id="pixel"> 1:1 pixels</label>
  </div>
  <div class="stage" id="stage">
    <img id="imgA" alt="">
    <img id="imgB" class="wipe" alt="" hidden>
    <div class="divider" id="divider" hidden></div>
    <span class="label a" id="labelA"></span>
    <span class="label b" id="labelB" hidden></span>
  </div>
  <div class="thumbs" id="thumbs"></div>
</main>
<script>
const RESULTS = ${data};
let scene = 0, current = 1, previous = 0, wipeAgainst = -1;
const $ = (id) => document.getElementById(id);
const fmt = (v) => v.ms === null ? "256 rays/px" : v.ms.toFixed(1) + " ms, rms " + v.rms.toFixed(4);
function render() {
  const r = RESULTS[scene];
  $("tabs").innerHTML = RESULTS.map((s, i) =>
    '<button aria-pressed="' + (i === scene) + '" data-scene="' + i + '">' + s.scene + '<small>' + s.segments + ' seg</small></button>').join("");
  $("variants").innerHTML = r.variants.map((v, i) =>
    '<button aria-pressed="' + (i === current) + '" data-variant="' + i + '"><kbd>' + (i + 1) + '</kbd> ' + v.name + '<small>' + fmt(v) + '</small></button>').join("");
  $("wipeSel").innerHTML = '<option value="-1">nothing</option>' + r.variants.map((v, i) =>
    '<option value="' + i + '"' + (i === wipeAgainst ? " selected" : "") + '>' + v.name + '</option>').join("");
  $("imgA").src = r.variants[current].file;
  $("labelA").textContent = r.variants[current].name;
  const b = r.variants[wipeAgainst];
  $("imgB").hidden = !b; $("divider").hidden = !b; $("labelB").hidden = !b;
  if (b) { $("imgB").src = b.file; $("labelB").textContent = b.name; }
  $("thumbs").innerHTML = r.variants.map((v, i) =>
    '<figure aria-current="' + (i === current) + '" data-variant="' + i + '"><img src="' + v.file + '" alt=""><figcaption>' + v.name + ' · ' + fmt(v) + '</figcaption></figure>').join("");
}
function pick(i) { if (i === current || !RESULTS[scene].variants[i]) return; previous = current; current = i; render(); }
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-scene],[data-variant]");
  if (!t) return;
  if (t.dataset.scene !== undefined) { scene = +t.dataset.scene; current = Math.min(current, RESULTS[scene].variants.length - 1); render(); }
  else pick(+t.dataset.variant);
});
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
  if (e.key >= "1" && e.key <= "9") pick(+e.key - 1);
  else if (e.key === " ") { e.preventDefault(); pick(previous); }
  else if (e.key === "ArrowRight") { scene = (scene + 1) % RESULTS.length; render(); }
  else if (e.key === "ArrowLeft") { scene = (scene + RESULTS.length - 1) % RESULTS.length; render(); }
});
$("wipeSel").addEventListener("change", (e) => { wipeAgainst = +e.target.value; render(); });
$("wipe").addEventListener("input", (e) => $("stage").style.setProperty("--wipe", e.target.value + "%"));
$("pixel").addEventListener("change", (e) => document.body.classList.toggle("pixel", e.target.checked));
$("stage").style.setProperty("--wipe", "50%");
render();
</script>
</html>
`;
}
