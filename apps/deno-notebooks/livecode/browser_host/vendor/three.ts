// Repo-resident re-export shim: bundle entry stubs are written outside the
// repo, and an npm bare specifier only resolves from a file that can reach
// the repo's node_modules by walk-up. See ALIAS_ENTRIES in
// ../build_host_assets.ts.
export * from "three";
