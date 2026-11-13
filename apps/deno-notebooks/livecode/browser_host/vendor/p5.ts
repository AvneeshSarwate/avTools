// Repo-resident re-export shim: bundle entry stubs are written outside the
// repo, and an npm bare specifier only resolves from a file that can reach
// the repo's node_modules by walk-up. See ALIAS_ENTRIES in
// ../build_host_assets.ts. p5 is CJS; the default export is the whole API.
export { default } from "p5";
