# Optional AgentRuntime boundary trial

On Node 22+ with the project's development dependencies installed:

```sh
pnpm test:agent-boundary
```

This opt-in differential evaluation compiles the checkout's actual
`AgentRuntime`, context manager, permission engine, retry manager, pending
queue and recorder. It requires no API key, model, application setup or source
download. It is a development dependency trial; production runtime code is
not changed by this proposal.

The test supplies finite chunk-object iterables at the provider utility seam.
Application/provider utilities, prompt assembly, hooks, RAG, token counting and
store/service access are explicit stubs. The registered read tool only records
its input in memory. Network and unexpected MCP/store/skill/image access throw.
Unreviewed module imports fail the fixture build before evaluation.
This does **not** test the Tauri host, Rust SSE decoder, raw HTTP bytes, actual
MCP, note mutation, approval workflow, argument repair or desktop/mobile UI.

Each scenario runs natively and with an optional PSJ 0.6.1 preflight, for 24
cases. Healthy one/two-call controls require exact inputs, original result IDs
in the next request and the consumed final answer. Existing malformed-JSON,
transport-failure and user-stop controls require zero callbacks. Diagnostics
report each case's callback/request counts and error.

The guarded cases refuse closed JSON with `length`/`content_filter`, missing
finish evidence, a late provider-error chunk, duplicate original IDs,
schema-invalid input and a malformed sibling before any callback. This is an
explicit whole-batch/schema policy, not rollback across earlier turns. The
callback consumes an authority once, checking original ID, exact name and exact
input. Sequential binding is verified for these fixtures only.

Other native results are observations. A native refusal with no callback is
accepted so the trial does not require today's permissive behavior to survive
a future native fix. A native terminal/error check is also a valid approach;
the trial asks whether retaining this development comparison is useful.

The preflight is a finite-fixture helper, not a production streaming wrapper.
It cannot recover information discarded before the TypeScript chunk channel
or certify concurrent, approved or intentionally repaired calls. Running this
trial does not establish full application compatibility or production use.
