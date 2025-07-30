import { invoke } from '@tauri-apps/api/core';
import { ClientOptions } from '@tauri-apps/plugin-http';

const ERROR_REQUEST_CANCELLED = 'Request canceled';

async function fetch(input: string, init?: RequestInit & ClientOptions) {
  // abort early here if needed
  const signal = init?.signal;
  if (signal?.aborted) {
      throw new Error(ERROR_REQUEST_CANCELLED);
  }
  const maxRedirections = init?.maxRedirections;
  const connectTimeout = init?.connectTimeout;
  const proxy = init?.proxy;
  const danger = init?.danger;
  // Remove these fields before creating the request
  if (init) {
      delete init.maxRedirections;
      delete init.connectTimeout;
      delete init.proxy;
      delete init.danger;
  }
  const headers = init?.headers
      ? init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers)
      : new Headers();
  const req = new Request(input, init);
  const buffer = await req.arrayBuffer();
  const data = buffer.byteLength !== 0 ? Array.from(new Uint8Array(buffer)) : null;

  for (const [key, value] of req.headers) {
    if (!headers.get(key)) {
      headers.set(key, value);
    }
  }
  const headersArray = headers instanceof Headers
    ? Array.from(headers.entries())
    : Array.isArray(headers)
      ? headers
      : Object.entries(headers);
  const mappedHeaders = headersArray.map(([name, val]) => [
    name,
    typeof val === 'string' ? val : (val as string).toString()
  ]);
  if (signal?.aborted) {
      throw new Error(ERROR_REQUEST_CANCELLED);
  }
  const rid = await invoke('plugin:http|fetch', {
    clientConfig: {
      method: req.method,
      url: req.url,
      headers: mappedHeaders,
      data,
      maxRedirections,
      connectTimeout,
      proxy,
      danger
    }
  });
  const abort = () => invoke('plugin:http|fetch_cancel', { rid });
  if (signal?.aborted) {
    abort();
    throw new Error(ERROR_REQUEST_CANCELLED);
  }
  signal?.addEventListener('abort', () => void abort());
  const { status, statusText, url, headers: responseHeaders, rid: responseRid } = await invoke<{
    status: number;
    statusText: string;
    url: string;
    headers: [string, string][];
    rid: number;
  }>('plugin:http|fetch_send', {
    rid
  });
  const body = await invoke('plugin:http|fetch_read_body', {
    rid: responseRid
  });
  const res = new Response(body instanceof ArrayBuffer && body.byteLength !== 0
    ? body
    : body instanceof Array && body.length > 0
        ? new Uint8Array(body)
        : null, {
    status,
    statusText
  });

  Object.defineProperty(res, 'url', { value: url });

  const encodeHeaders = responseHeaders.map(header => [header[0], encodeURI(header[1])]) as [string, string][]

  Object.defineProperty(res, 'headers', {
    value: new Headers(encodeHeaders)
  });
  return res;
}

export { fetch };
