import { assertEquals } from "jsr:@std/assert@1";
import { resolveContainedUrlPath } from "../visualizer/contained_path.ts";

Deno.test("contained URL paths reject traversal and prefix collisions", () => {
  const root = "/tmp/livecode-project";
  assertEquals(
    resolveContainedUrlPath(root, "modules%2Fsketch.ts"),
    "/tmp/livecode-project/modules/sketch.ts",
  );
  assertEquals(resolveContainedUrlPath(root, "%2e%2e%2Fsecret.ts"), null);
  assertEquals(
    resolveContainedUrlPath(root, "%2e%2e%2Flivecode-project-copy%2Fx.ts"),
    null,
  );
  assertEquals(resolveContainedUrlPath(root, "%E0%A4%A"), null);
  assertEquals(resolveContainedUrlPath(root, "%00secret.ts"), null);
});
