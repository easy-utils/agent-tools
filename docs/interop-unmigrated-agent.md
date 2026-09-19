# Browser interop with an unmigrated (Connect) agent — CORS

easy-rpc speaks the Connect wire protocol (spec: `easy-rpc-spec/README.md`), and
`abcp-sdk/agent` serves the **same** `agent.v1.AgentService` through
`@connectrpc/connect`. So our clients interoperate with the upstream agent with
**no server change** — except for one browser-only CORS gap.

## Result

| Client / transport | Agent not migrated (standard Connect) |
|--------------------|----------------------------------------|
| native (Node/Go/Rust/Swift/SwiftUI/Kotlin-JVM) | **works** (proto + JSON, unary + stream) |
| browser (webui / Flutter web / Compose wasm) unary | **works** |
| browser server-stream | **blocked by CORS** unless the agent exposes the header below |

Verified live against `abcp-agent` (cluster, `AGENT_AUTH_MODE=required`):

- our generated client (`@easy-utils/agent-sdk-typescript` + easy-rpc) →
  `Health`, `ListSessions` (proto), `WatchSessions` (server-stream proto),
  JSON equivalents, and error mapping (`code 16` for a bad/missing token);
- a real Chromium page → unary `200`; server-stream fails preflight with
  `Request header field connect-accept-encoding is not allowed by
  Access-Control-Allow-Headers`.

## Root cause

The easy-rpc / `connect-web` fetch transport sets `Connect-Accept-Encoding: gzip`
on **every streaming POST** (`easy-rpc-ts/src/bridge_fetch.ts`). The agent's CORS
preflight reply is a static list that omits it:

```
Access-Control-Allow-Headers: content-type, connect-protocol-version,
  connect-timeout-ms, grpc-timeout, x-grpc-web, x-user-agent, authorization
```

The browser therefore refuses the request before it is sent. (Unary is
unaffected: `Accept-Encoding` is a forbidden header and is set by the user
agent, not by the fetch transport.)

Secondary: `connect-code` / `connect-error` (and `trailer-*`) are not exposed,
so a browser can read the JSON error body but not the header-borne code — fine
for easy-rpc (it parses the body), but worth exposing for completeness.

## Fix (agent-side, one line of config; not an easy-rpc migration)

We no longer run our own agent backend (we consume `abcp-sdk/agent` unchanged),
so this is a finding to report upstream. The ready-to-apply patch for
`abcp-sdk/agent` is `docs/abcp-agent-cors.patch`:

```ts
'Access-Control-Allow-Headers':
  'content-type, connect-protocol-version, connect-timeout-ms, ' +
  'connect-accept-encoding, connect-content-encoding, ' +
  'grpc-timeout, x-grpc-web, x-user-agent, authorization',
'Access-Control-Expose-Headers':
  'grpc-status, grpc-message, connect-protocol-version, ' +
  'connect-code, connect-error, ' +
  'connect-accept-encoding, connect-content-encoding, *',
```

After the change, a real browser page gets `200` on **both** unary and
server-stream (proven with Chromium).
