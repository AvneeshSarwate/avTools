# Global input events and parameter buttons

Contract agreed with the owner in September 2026: one engine-global registry,
`{type, body}` messages, and declarative `button({type, body})` entries alongside
inferred params. A button adds `body.state` (`down`/`up`). Entity association is
optional project payload data; handlers are never addressed by entity identity.

The implementation uses the existing EngineOp transport in every topology.
Button descriptors become durable metadata; event occurrences remain transient
explicit input actions, separate from conflating observation signals. Direct
`canvas-events` subscriptions in timed scopes receive the actual context via
analysis. Uninstrumented callers pass it explicitly. Context ownership handles
cancellation and natural completion without relying on reused module IDs.

No transform/pipeline migration is part of this change. The executable user
fixture is `feature-event-buttons`; current contracts live in `current/`.
