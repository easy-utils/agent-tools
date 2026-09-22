// Transport + typed client factory over the latest @abcp/agent-sdk
// (agent.v1.AgentService, Connect protocol). The caller owns baseUrl + token;
// the client is rebuilt on backend switch.

import { AgentService } from '@abcp/agent-sdk'
import {
  type Client,
  createClient,
  type Interceptor,
} from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

export type AgentClient = Client<typeof AgentService>

function bearerInterceptor(token: string): Interceptor {
  return next => async req => {
    if (token) req.header.set('Authorization', `Bearer ${token}`)
    return await next(req)
  }
}

export function trimBase(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

/** A fresh Connect-web client bound to one backend (baseUrl + bearer). */
export function createAgentClient(baseUrl: string, token: string): AgentClient {
  const transport = createConnectTransport({
    baseUrl: trimBase(baseUrl),
    // BINARY protobuf, not Connect-JSON. JSON encodes every `bytes` field as
    // base64, and @bufbuild/protobuf falls back to a char-by-char string
    // concatenation when the runtime lacks the native Uint8Array.toBase64
    // (Chrome/Safari today) — that made file uploads (IngestFile) take seconds
    // for a few MB. Binary carries the raw bytes with no base64 at all.
    useBinaryFormat: true,
    interceptors: [bearerInterceptor(token)],
  })
  return createClient(AgentService, transport)
}
