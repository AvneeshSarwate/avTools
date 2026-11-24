// The landing page: a link to every sketch in the registry.
import { SKETCHES } from "./sketches/registry";
import "./landing.css";

const list = document.getElementById("sketches")!;
for (const sketch of SKETCHES) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `./${sketch.slug}/`;
  link.textContent = sketch.title;
  const description = document.createElement("p");
  description.textContent = sketch.description;
  item.append(link, description);
  list.append(item);
}
