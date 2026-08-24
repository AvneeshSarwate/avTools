# LLM Code De-Slop Checklist

The goal is **not** to make code look less AI-generated for cosmetic reasons. The goal is to remove code produced by plausible-but-shallow reasoning: unnecessary bulk, invented assumptions, cargo-cult architecture, and tests that merely bless the implementation.

## 0. human specified - watch out for these things
- useless or redundant comments that can be easily inferred from code
- local hacks to catch issues that should be addressed higher up at an architectural level
- pedanticness about edge or overly defensive use that are not actually relevant to the context of use of the system 
- lots of vestigal files and comments that are no longer needed as LLMs don't always delete things as necessary

## 1. Establish scope before touching anything

* Review the **diff against the actual base/default branch**, rather than blindly assuming `main`.
* Concentrate first on code introduced or substantially changed by the current work.
* Read the surrounding code before deciding something is slop.
* Search the repository for existing implementations of the same problem before creating a new helper, abstraction, schema, service, hook, or utility.
* Compare sibling modules that perform similar roles; LLMs commonly create near-twin implementations because they lack global repository context.
* Treat repository conventions as stronger evidence than generic “clean code” advice.

## 2. Preserve behavior

* Do not change externally observable behavior merely to make code prettier.
* Preserve public APIs, signatures, return types, side effects, ordering, error semantics, and compatibility unless a change is explicitly intended.
* Prefer small deletions and simplifications over broad rewrites.
* Do not introduce a dependency merely to make a refactor convenient.
* Do not convert a suspicious-looking construct until you understand why it exists.
* After cleanup, verify that complexity actually decreased rather than merely moving elsewhere.

## 3. Remove comment and documentation slop

* Delete comments that simply narrate the next line:

  * `// initialize array`
  * `// loop through users`
  * `// return result`
* Delete section banners around obvious groups of code.
* Remove docstrings/JSDoc that merely restate the function name, parameters, or return type.
* Remove comments containing model uncertainty such as:

  * “this should work”
  * “might need adjustment”
  * “probably”
  * speculative TODOs created without evidence.
* Remove unjustified claims such as “optimal,” “handles all edge cases,” or “thread-safe” unless verified.
* Keep comments that preserve actual institutional knowledge:

  * why a workaround exists
  * external API quirks
  * business invariants
  * security reasoning
  * counterintuitive implementation decisions.
* If code requires a long comment explaining *what* it does, first see whether naming or structure can make the code itself clear.

## 4. Remove defensive overkill

* Remove redundant null/None/nil checks where types or upstream logic already guarantee the value.
* Validate at trust boundaries rather than re-validating the same invariant in every internal helper.
* Remove `try/catch` or `try/except` that merely logs an error and immediately rethrows it unchanged.
* Remove catch blocks that add no recovery, context, translation, cleanup, or retry behavior.
* Remove fallback values for configuration or states that are supposed to be mandatory.
* Do not turn programming errors into fake success states.
* Remove optional chaining or `.get(..., default)` chains used merely to conceal an invariant the code should enforce.
* Avoid retry logic unless the operation is actually safe to retry.
* Avoid generic fallback ladders whose purpose is “make something work somehow.”
* Fail loudly where the contract says failure is exceptional.

### Do **not** de-slop away legitimate defenses

Keep:

* authentication and authorization
* resource ownership checks
* input validation at external boundaries
* schema validation of network/deserialized data
* SSRF/XSS/SQL-injection protections
* rate limits
* TLS/security configuration
* checks around third-party APIs
* concurrency and data-integrity safeguards.

“Defensive” is not synonymous with “slop.”

## 5. Fix type-system evasion

* Remove `any` introduced to silence TypeScript errors.
* Be suspicious of:

  * `as any`
  * `as unknown as Foo`
  * gratuitous non-null assertions
  * unsafe casts that bypass actual validation.
* Fix the underlying type mismatch instead.
* Remove redundant type annotations where inference is clearer.
* Avoid elaborate generic/type machinery that exists only because the agent generalized prematurely.
* Do not invent interfaces for values that have only one tiny local use unless they materially improve the contract.
* Keep explicit types at genuine API/public boundaries.

## 6. Collapse premature abstraction

Look for abstractions that cost more concepts than they remove.

* Wrapper functions that only forward arguments unchanged.
* Classes containing no meaningful state.
* `Service`, `Manager`, `Handler`, `Processor`, or `Provider` classes with one trivial operation.
* Abstract/base classes with exactly one implementation and no credible extension requirement.
* Factories that always return one concrete type.
* Interfaces mirroring a single implementation one-for-one.
* Helpers called exactly once where inline code is clearer.
* Separate modules containing one tiny type/helper solely because the model wanted “separation of concerns.”
* Dependency-injection frameworks around code that has no substitution requirement.
* Plugin/registry systems for one plugin.
* Config-driven generic engines replacing a handful of explicit cases.
* Layers that merely rename the API beneath them.

Prefer the simplest representation that fits the requirements **today**.

Do not remove an abstraction merely because it currently has one implementation if it provides a real testing boundary, isolates an external dependency, or is required by the framework.

## 7. Eliminate verbosity without playing code golf

* Remove temporary variables whose only purpose is immediate return.
* Replace `condition ? true : false` with the condition itself.
* Flatten deep nesting using guard clauses/early returns where that improves flow.
* Use the language's idiomatic collection/iteration primitives where clearer.
* Remove repeated conversions and unnecessary serialization/deserialization.
* Remove redundant async wrappers and unnecessary `Promise` construction.
* Collapse repeated branching whose cases perform the same operation.
* Prefer direct expressions over ceremony.
* Keep intermediate variables when they genuinely clarify domain meaning or debugging.

The target is **high information density**, not minimum character count.

## 8. Fix generic, context-free naming

Investigate vague names outside tiny scopes:

* `data`
* `result`
* `response`
* `item`
* `value`
* `info`
* `temp`
* `obj`
* `handler`
* `processor`
* `manager`
* `service`
* `utils`
* `helpers`
* `common`
* `misc`

Replace them with names that encode the domain or invariant.

Also inspect “junk drawer” modules such as `utils.ts`, `helpers.py`, or `common.rs`. If they mix unrelated concerns, split them by domain rather than creating another generic bucket.

## 9. Detect copied and near-copied logic

* Search for near-identical helper functions in different files.
* Compare sibling provider/integration/client modules.
* Find repeated validation rules.
* Find repeated parsing/formatting logic.
* Find registry implementations that differ only in nouns.
* Find copied API adapters with tiny changes.
* Find duplicated schemas and constants that can silently diverge.
* Check whether the agent implemented functionality already present elsewhere in the repository.
* Parameterize genuinely identical behavior when doing so remains simpler than duplication.

Do **not** force DRY when two pieces of code merely happen to look similar but are likely to evolve independently.

## 10. Hunt hallucinated surface area aggressively

Every plausible-looking external fact should be considered untrusted until grounded.

Verify:

* imports actually exist
* packages are installed
* methods exist on the installed library version
* function signatures match
* CLI commands and flags exist
* environment variables/config keys are real
* database fields exist
* API payload fields exist
* Terraform/provider arguments exist
* Helm values are actually consumed
* Kubernetes fields match the selected `apiVersion`
* framework hooks/components/options exist
* referenced files and directories exist.

Watch for mixing adjacent versions or ecosystems: the name often sounds right even when the API is from another release or another library.

Prefer local source/types/generated schemas/lockfiles/tool `--help` output and official documentation over model memory.

## 11. Remove stale or cargo-cult patterns

* Check whether the generated code copied an obsolete idiom.
* Check the actual runtime/language/framework version before “modernizing.”
* Remove compatibility shims for versions the project does not support.
* Remove patterns copied from another framework simply because they are familiar.
* Question retries, circuit breakers, caching layers, event buses, repositories, CQRS, factories, or observers that appeared without a requirement.
* Every architectural mechanism should answer: **what concrete problem in this repository requires this?**

If there is no good answer, simplify.

## 12. Detect cross-language and cross-framework leakage

Look for concepts or idioms imported from the wrong ecosystem:

* JavaScript-style operations in Python.
* Java-style abstractions in languages that do not need them.
* Python idioms awkwardly translated into TypeScript.
* React patterns copied into another frontend framework.
* ORM conventions from one ORM used with another.
* AWS terminology inserted into GCP/Azure code.
* Terraform arguments belonging to a neighboring resource/provider.
* API syntax from a newer or older library release.

Even compilable leakage can produce unnatural architecture, not just syntax errors.

## 13. Remove dependency creep

For every newly introduced dependency ask:

* Does the standard library/runtime already do this adequately?
* Does the repository already depend on something that does the same job?
* Is this package necessary for one trivial operation?
* Is the package maintained?
* Is the selected package/version compatible with the project?
* Did the agent add two libraries for the same concern?
* Did the dependency remain after the implementation changed?
* Did it modify the lockfile for something no longer used?

Delete unnecessary dependencies rather than normalizing them.

## 14. Find dead scaffolding

LLMs often build future-proofing for futures nobody requested.

Remove or question:

* unused interfaces
* dead branches
* placeholder implementations
* speculative feature flags
* unused dependency-injection hooks
* callbacks that are never supplied
* configuration options nobody reads
* exports with no consumers
* unused adapters
* migration compatibility code with no supported old version
* generated TODOs
* commented-out alternatives
* helpers introduced and then bypassed by the final implementation.

Do not preserve scaffolding merely because it “may be useful later.”

## 15. Audit error semantics, not just error syntax

* Never silently swallow unexpected errors.
* Avoid converting every exception into `null`, `false`, or an empty collection.
* Preserve the original cause/stack when translating errors.
* Add useful domain context when catching.
* Handle errors at the layer capable of making a meaningful decision.
* Ensure retries have:

  * bounded attempts
  * appropriate backoff
  * idempotency or other safety guarantees.
* Avoid generic `catch (e)` blocks whose only job is to make tests green.
* Make required state failures explicit instead of laundering them through defaults.

## 16. Detect “test theater”

Generated tests deserve their own de-slop pass.

Flag tests that:

* reproduce the implementation's control flow.
* assert private implementation details instead of observable behavior.
* mock every dependency and then assert only that mocks were called.
* test the mock rather than the production behavior.
* have enormous fixture setup for a trivial assertion.
* snapshot huge outputs with no semantic checks.
* produce impressive coverage while barely testing requirements.
* contain only happy-path cases.
* duplicate one test many times with superficial value changes.
* assert logs or internal function calls when those are not the contract.
* were generated from the finished implementation and would pass if implementation and test shared the same misconception.
* have no connection to a requirement, invariant, bug, boundary condition, or acceptance criterion.

Prefer tests derived from behavior/specification and failure modes.

Ask the key question:

**Could this implementation be meaningfully wrong and still pass this test?**

If yes, strengthen or delete the test.

## 17. Check edge cases the model probably hand-waved

Pay particular attention to:

* empty collections
* zero
* negative values
* duplicate requests
* missing configuration
* malformed external data
* Unicode/encoding
* time zones and DST
* integer/float precision
* very large inputs
* pagination boundaries
* partial failure
* cancellation
* retries
* race conditions
* ordering assumptions
* idempotency
* resource cleanup
* interrupted transactions
* network timeout/disconnect
* stale cache/state.

LLMs tend to produce a polished happy path and generic defensive code rather than reasoning through concrete failure modes.

## 18. Check state and concurrency assumptions

Look for:

* read-modify-write races
* check-then-act races
* unbounded parallel work
* duplicated event subscriptions
* missing cleanup/unsubscribe logic
* fire-and-forget promises
* non-idempotent retryable operations
* global mutable state added for convenience
* caches without invalidation strategy
* locks around the wrong scope
* state duplicated across layers
* client state that is merely a second copy of server/derived state.

Concurrency code that “looks reasonable” deserves runtime-level verification.

## 19. Check data-model and schema assumptions

* Remove guessed properties.
* Remove fields that exist only because the agent assumed they should.
* Verify nullability against the real schema.
* Verify enums against the actual accepted set.
* Do not silently coerce malformed values into defaults.
* Avoid passing whole ORM/domain objects where only a narrow DTO is needed.
* Ensure multi-tenant/resource queries include the appropriate ownership scope.
* Check that serializers do not leak internal or sensitive fields.
* Make schema conversions explicit when information can be lost.

## 20. Check performance slop

Look for:

* N+1 database/network requests
* repeated parsing or compilation
* repeated full-array scans
* repeated filesystem reads
* serial awaits that are independent
* unbounded `Promise.all`/task spawning
* unnecessary copies/clones
* needless deep cloning
* excessive serialization
* fetching entire records when a few fields suffice
* giant responses passed between server/client layers
* caching added without evidence it helps
* memoization whose invalidation costs exceed the saved computation.

Conversely, do not “optimize” something merely because the agent can imagine a performance issue.

## 21. Check security slop separately from stylistic slop

Generated code that is neat but insecure is still slop.

Check at minimum:

* authentication versus authorization
* resource ownership / IDOR / BOLA
* tenant isolation
* server-side validation
* SQL/query parameterization
* secret exposure
* path traversal
* command injection
* SSRF
* XSS/output encoding
* unsafe deserialization
* arbitrary file upload
* open redirects
* rate limiting where abuse is realistic
* missing token/cost limits on AI APIs
* sensitive error messages
* unsafe CORS
* weak default permissions.

Never simplify these protections merely to reduce line count.

## 22. Respect local architectural gravity

Before introducing something new, search for the repository's established:

* logging abstraction
* configuration loader
* error hierarchy
* schema validator
* database access layer
* HTTP client
* caching mechanism
* test fixtures
* component primitives
* state-management approach
* dependency-injection style
* observability conventions.

LLM code often works in isolation but creates a second miniature architecture beside the real one.

Prefer the project's existing path unless there is a concrete reason to change it.

## 23. Language-specific tells

### TypeScript / JavaScript

Check for:

* `any` / double casts
* redundant type annotations
* unnecessary classes for stateless operations
* `new Promise(async (...) => ...)`
* forgotten promise handling
* giant barrel files
* unnecessary client-side state
* unnecessary `useEffect`
* stale CommonJS inside ESM projects
* dependencies duplicating runtime/browser capabilities.

### Python

Check for:

* class-for-everything design
* broad/bare `except`
* catch-log-rethrow
* excessive runtime type checks contradicting annotations
* unnecessary `Any`
* Java-like object architecture
* manual collection building where comprehensions are clearer
* gratuitous inline imports unless needed for cycles/startup behavior.

### Rust

Check for:

* `.clone()` used simply to appease the borrow checker
* overly broad trait bounds
* unnecessary `unsafe`
* custom error hierarchies for every small module
* verbose `Option`/`Result` matching where established idioms are clearer.

### Shell

Check for:

* invented CLI flags
* `|| true` / `2>/dev/null` used to hide uncertainty
* manual status checks everywhere
* unquoted variables
* stale constructs
* unnecessary subprocesses for shell built-ins.

### Infrastructure as Code

Check for:

* invented resource arguments
* version/provider mismatch
* unnecessary modules around single trivial resources
* `ignore_errors` everywhere
* excessive `depends_on`
* `latest` image tags
* unpinned important dependencies/providers
* mismatched Kubernetes `apiVersion` and fields
* Helm values that no template actually reads.

## 24. Look for “agent residue”

After the functional code is done, inspect for artifacts of the generation process:

* temporary debugging prints
* exploratory files
* duplicate implementations produced during iteration
* abandoned helper functions
* unused imports
* temporary scripts
* generated markdown explaining implementation unnecessarily
* comments addressed to the user/reviewer
* TODOs describing things the agent chose not to finish
* backup files
* test fixtures no longer used
* lockfile churn
* accidental formatting of unrelated files.

The committed diff should represent the solution, not the conversation that produced it.

## 25. Final verification gate

Before declaring the code clean:

* Run the repository's formatter if appropriate.
* Run configured lint/static-analysis tools.
* Run type checking.
* Compile/build.
* Run relevant tests.
* Exercise the actual changed behavior where practical.
* Verify suspicious APIs against current local types/docs.
* Inspect the final diff again after automated tools make changes.
* Confirm no unrelated files changed.
* Confirm no new warnings were introduced.
* Confirm no security checks were mistakenly removed.
* Confirm the result is genuinely simpler.
* Confirm the result still looks like it belongs in **this repository**.

A passing linter is necessary evidence, not sufficient evidence.

## 26. The final five-question de-slop test

For every substantial addition, ask:

1. **Does this code exist because the requirement needs it, or because an LLM thought good software usually contains it?**
2. **Is every external API/schema/package assumption grounded in something real?**
3. **Is there a simpler implementation with fewer concepts and the same behavior?**
4. **Would the tests detect a plausible incorrect implementation, rather than merely confirming this implementation?**
5. **Does this change follow the patterns already used by competent code around it?**

If those five answers are good, most meaningful LLM slop has already been removed.
