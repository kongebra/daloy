/**
 * Node adapter: translates IncomingMessage/ServerResponse to web-standard
 * Request/Response. Includes graceful shutdown wired to SIGTERM/SIGINT.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";
import type { App } from "../app.js";
import {
  FrameSink,
  encodeFrame,
  encodeClosePayload,
  encodeSendPayload,
  validateUpgrade,
  validateSelectedSubprotocol,
  checkWebSocketOrigin,
  WS_OPCODE,
  WS_CLOSE_CODE,
  WS_READY_STATE,
  WS_MAX_CONTROL_PAYLOAD,
  WebSocketProtocolError,
  WebSocketPayloadTooLargeError,
  type NormalizedWebSocketOptions,
  type WebSocketConnection,
  type WebSocketContext,
  type WebSocketHandler,
} from "../websocket.js";

/** Options for the Node.js {@link serve} entry point. */
export interface NodeServerOptions {
  port?: number;
  hostname?: string;
  /** Connection-level timeout in ms. Default: 30000. */
  connectionTimeoutMs?: number;
  /** Drain timeout for graceful shutdown. Default: 10000. */
  shutdownTimeoutMs?: number;
  /** Listen for SIGTERM/SIGINT and shut down. Default: true. */
  handleSignals?: boolean;
  /** Maximum HTTP header size bytes (DoS protection). Default: 16 KiB. */
  maxHeaderBytes?: number;
  /**
   * When true, honor `x-forwarded-proto` and `x-forwarded-host` headers when
   * constructing the request URL. Enable this only when running behind a
   * trusted reverse proxy (e.g. a TLS-terminating load balancer); otherwise
   * clients can spoof the scheme/host. Default: false.
   */
  trustProxy?: boolean;
}

/** Handle returned by {@link serve} exposing the underlying Node `Server` plus a `close()` for graceful shutdown. */
export interface NodeServerHandle { server: Server; port: number; close(): Promise<void>; }

/** Start a Node.js HTTP (and optional WebSocket) server bound to the given {@link App}. */
export function serve(app: App, opts: NodeServerOptions = {}): NodeServerHandle {
  const trustProxy = opts.trustProxy === true;
  const server = createServer({ maxHeaderSize: opts.maxHeaderBytes ?? 16 * 1024 }, async (req, res) => {
    try {
      const request = await toWebRequest(req, trustProxy);
      const response = await app.fetch(request);
      await sendWebResponse(response, res);
    } catch (e) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/problem+json");
        res.end(
          JSON.stringify({
            type: "https://daloyjs.dev/errors/internal",
            title: "Internal Server Error",
            status: 500,
          })
        );
      } else {
        res.destroy(e as Error);
      }
    }
  });

  server.requestTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.headersTimeout = opts.connectionTimeoutMs ?? 30_000;
  server.keepAliveTimeout = 5_000;
  const wsSockets = new Set<Duplex>();
  if (app.webSocketRoutes.size > 0) {
    server.on("upgrade", (req, socket, head) => {
      wsSockets.add(socket as Duplex);
      (socket as Duplex).on("close", () => wsSockets.delete(socket as Duplex));
      void handleUpgrade(app, req, socket as Duplex, head, trustProxy);
    });
  }
  const port = opts.port ?? 3000;
  server.listen(port, opts.hostname ?? "0.0.0.0");
  // Kill idle keep-alive sockets immediately when draining begins.
  // In-flight requests keep their socket because Node's
  // `closeIdleConnections()` is a no-op for sockets with an in-flight request.
  app._registerIdleConnectionCloseHook(() => {
    const s = server as Server & { closeIdleConnections?: () => void };
    if (typeof s.closeIdleConnections === "function") {
      s.closeIdleConnections();
    }
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.shutdown(opts.shutdownTimeoutMs ?? 10_000);
    for (const sock of wsSockets) sock.destroy();
    wsSockets.clear();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  };
  if (opts.handleSignals !== false) {
    const onSignal = (sig: string) => { app.log.info({ sig }, "DaloyJS received signal, shutting down"); void close().then(() => process.exit(0)); };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  }
  return { server, port, close }; }
async function toWebRequest(
  req: IncomingMessage,
  trustProxy: boolean,
): Promise<Request> {
  const forwardedHost = trustProxy
    ? firstHeader(req.headers["x-forwarded-host"])
    : undefined;
  const host = forwardedHost ?? req.headers.host ?? "localhost";
  const forwardedProto = trustProxy
    ? firstHeader(req.headers["x-forwarded-proto"])
    : undefined;
  const proto =
    forwardedProto ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = `${proto}://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) headers.set(k, v.join(", "));
    else headers.set(k, String(v));
  }
  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    (init as any).body = Readable.toWeb(req) as ReadableStream;
    (init as any).duplex = "half";
  }
  return new Request(url, init);
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === undefined) return undefined;
  const comma = raw.indexOf(",");
  return (comma === -1 ? raw : raw.slice(0, comma)).trim() || undefined;
}

async function sendWebResponse(
  res: Response,
  out: ServerResponse,
): Promise<void> {
  out.statusCode = res.status;
  res.headers.forEach((v, k) => out.setHeader(k, v));
  if (!res.body) {
    out.end();
    return;
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) out.write(value);
  }
  out.end();
}

// ---------- WebSocket upgrade ----------

async function handleUpgrade(
  app: App,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  trustProxy: boolean,
): Promise<void> {
  const forwardedHost = trustProxy
    ? firstHeader(req.headers["x-forwarded-host"])
    : undefined;
  const host = forwardedHost ?? req.headers.host ?? "localhost";
  const forwardedProto = trustProxy
    ? firstHeader(req.headers["x-forwarded-proto"])
    : undefined;
  const proto =
    forwardedProto ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const url = new URL(`${proto}://${host}${req.url ?? "/"}`);
  const match = app.webSocketRoutes.find(url.pathname);
  if (!match) {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const result = await validateUpgrade(headers);
  if (!result.ok) {
    writeUpgradeError(socket, result.status, result.reason);
    return;
  }

  const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method: "GET",
    headers,
  });
  const ctx: WebSocketContext = {
    request,
    params: match.params as any,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries(headers.entries()),
    state: match.handler.createState() as any,
    protocols: result.protocols,
  };

  const handler = match.handler.handler as WebSocketHandler<any, any, any>;
  const originCheck = checkWebSocketOrigin(request, handler.allowedOrigins);
  if (!originCheck.ok) {
    writeUpgradeError(socket, 403, originCheck.reason);
    return;
  }
  let chosenProtocol = "";
  try {
    const decision = await handler.beforeUpgrade?.(request, ctx);
    if (decision instanceof Response) {
      writeRejection(socket, decision);
      return;
    }
    if (typeof decision === "string")
      chosenProtocol = validateSelectedSubprotocol(decision, result.protocols);
  } catch (err) {
    if (err instanceof WebSocketProtocolError) {
      writeUpgradeError(socket, 400, err.message);
      return;
    }
    app.log.error({ err }, "WebSocket beforeUpgrade hook failed");
    writeUpgradeError(socket, 500, "Internal Server Error");
    return;
  }

  // Send the 101 response.
  const responseLines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${result.acceptKey}`,
  ];
  if (chosenProtocol)
    responseLines.push(`Sec-WebSocket-Protocol: ${chosenProtocol}`);
  socket.write(responseLines.join("\r\n") + "\r\n\r\n");

  (socket as unknown as { setNoDelay: (b: boolean) => void }).setNoDelay(true);

  const routeOptions = match.handler.options;
  const conn = new NodeWebSocketConnection(
    socket,
    handler,
    chosenProtocol,
    app,
    routeOptions,
  );
  (socket as unknown as { setTimeout: (n: number, cb?: () => void) => void }).setTimeout(
    routeOptions.idleTimeout * 1000,
    () => conn.close(WS_CLOSE_CODE.GOING_AWAY, "idle timeout"),
  );
  // If the upgrade arrived with extra bytes already in the buffer, feed them first.
  if (head.length > 0) conn._ingest(head);

  socket.on("data", (chunk: Buffer) => conn._ingest(chunk));
  socket.on("close", () => conn._handleSocketClose());
  socket.on("error", (err: Error) => conn._handleSocketError(err));

  try {
    await handler.open?.(conn, ctx);
  } catch (err) {
    app.log.error({ err }, "WebSocket open() handler failed");
    conn._invokeError(err);
    conn.terminate();
  }
}

function writeUpgradeError(
  socket: Duplex,
  status: number,
  reason: string,
): void {
  const body = `${status} ${reason}`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Content-Type: text/plain; charset=utf-8\r\n\r\n" +
      body,
  );
}

function writeRejection(socket: Duplex, res: Response): void {
  const lines = [
    `HTTP/1.1 ${res.status} ${res.statusText || "Error"}`,
    "Connection: close",
    "Content-Length: 0",
  ];
  res.headers.forEach((v, k) => lines.push(`${k}: ${v}`));
  socket.end(lines.join("\r\n") + "\r\n\r\n");
}

class NodeWebSocketConnection implements WebSocketConnection {
  readyState: 0 | 1 | 2 | 3 = WS_READY_STATE.OPEN;
  readonly extensions = "";
  binaryType: "arraybuffer" | "nodebuffer" = "nodebuffer";
  data: unknown = undefined;
  private sink: FrameSink;
  private closeHandled = false;

  constructor(
    private socket: Duplex,
    private handler: WebSocketHandler<any, any, any>,
    readonly protocol: string,
    private app: App,
    private options: NormalizedWebSocketOptions,
  ) {
    this.sink = new FrameSink({
      requireMask: true,
      maxPayloadLength: options.maxPayloadLength,
      onMessage: (ev) => {
        if (ev.isBinary && this.binaryType === "arraybuffer") {
          const buf = ev.data as Uint8Array;
          const ab =
            buf.buffer instanceof ArrayBuffer
              ? buf.buffer.slice(
                  buf.byteOffset,
                  buf.byteOffset + buf.byteLength,
                )
              : new Uint8Array(buf).buffer;
          void this._invokeMessage(ab, true);
        } else {
          void this._invokeMessage(ev.data, ev.isBinary);
        }
      },
      onPing: (payload) => {
        // Auto-pong per RFC 6455 §5.5.2.
        this._writeFrame(WS_OPCODE.PONG, payload);
      },
      onPong: () => {
        /* application-level latency tracking is out of scope */
      },
      onClose: (code, reason) => {
        if (this.readyState === WS_READY_STATE.OPEN) {
          // Echo close per RFC 6455 §5.5.1.
          this.readyState = WS_READY_STATE.CLOSING;
          this._writeFrame(WS_OPCODE.CLOSE, encodeClosePayload(code, reason));
        }
        this.readyState = WS_READY_STATE.CLOSED;
        this._fireClose(code, reason);
        this.socket.end();
      },
      onProtocolError: (err) => {
        this._invokeError(err);
        this.close(
          err instanceof WebSocketPayloadTooLargeError
            ? WS_CLOSE_CODE.MESSAGE_TOO_BIG
            : WS_CLOSE_CODE.PROTOCOL_ERROR,
          err.message,
        );
      },
    });
  }

  get bufferedAmount(): number {
    return (this.socket as { writableLength?: number }).writableLength ?? 0;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== WS_READY_STATE.OPEN) return;
    const { opcode, payload } = encodeSendPayload(
      data as string | ArrayBuffer | ArrayBufferView,
    );
    this._writeFrame(opcode, payload);
  }

  close(code: number = WS_CLOSE_CODE.NORMAL_CLOSURE, reason = ""): void {
    if (this.readyState >= WS_READY_STATE.CLOSING) return;
    this.readyState = WS_READY_STATE.CLOSING;
    this._writeFrame(WS_OPCODE.CLOSE, encodeClosePayload(code, reason));
    this._fireClose(code, reason);
    this.socket.end();
  }

  ping(data?: string | ArrayBufferLike | ArrayBufferView): void {
    this._controlFrame(WS_OPCODE.PING, data);
  }

  pong(data?: string | ArrayBufferLike | ArrayBufferView): void {
    this._controlFrame(WS_OPCODE.PONG, data);
  }

  terminate(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this.socket.destroy();
  }

  // --- internals ---

  _ingest(chunk: Buffer): void {
    if (this.readyState === WS_READY_STATE.CLOSED) return;
    this.sink.push(
      new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    );
  }

  _handleSocketClose(): void {
    this.readyState = WS_READY_STATE.CLOSED;
    this._fireClose(WS_CLOSE_CODE.ABNORMAL_CLOSURE, "");
  }

  _handleSocketError(err: Error): void {
    this._invokeError(err);
    this.readyState = WS_READY_STATE.CLOSED;
    this.socket.destroy();
  }

  private _controlFrame(
    opcode: number,
    data?: string | ArrayBufferLike | ArrayBufferView,
  ): void {
    if (this.readyState !== WS_READY_STATE.OPEN) return;
    let payload: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    if (data !== undefined) {
      payload = encodeSendPayload(data as any).payload;
      if (payload.length > WS_MAX_CONTROL_PAYLOAD) {
        throw new WebSocketProtocolError(
          "Control frame payload exceeds 125 bytes",
        );
      }
    }
    this._writeFrame(opcode, payload);
  }

  private _writeFrame(opcode: number, payload: Uint8Array): void {
    const frame = encodeFrame({ opcode, payload });
    const flushed = this.socket.write(
      Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength),
    );
    if (!flushed) {
      this.socket.once("drain", () =>
        this._invokeHandler("WebSocket drain() handler threw", () =>
          this.handler.drain?.(this),
        ),
      );
    }
    if (
      this.options.closeOnBackpressureLimit &&
      this.readyState === WS_READY_STATE.OPEN &&
      this.bufferedAmount > this.options.backpressureLimit
    ) {
      this.close(WS_CLOSE_CODE.MESSAGE_TOO_BIG, "backpressure limit exceeded");
    }
  }

  _invokeError(err: unknown): void {
    this._invokeHandler("WebSocket error() handler threw", () =>
      this.handler.error?.(this, err),
    );
  }

  private async _invokeMessage(
    data: string | Uint8Array | ArrayBuffer,
    isBinary: boolean,
  ): Promise<void> {
    try {
      await this.handler.message?.(this, data, isBinary);
    } catch (err) {
      this.app.log.error({ err }, "WebSocket message() handler failed");
      this._invokeError(err);
    }
  }

  private _fireClose(code: number, reason: string): void {
    if (this.closeHandled) return;
    this.closeHandled = true;
    this._invokeHandler("WebSocket close() handler threw", () =>
      this.handler.close?.(this, code, reason),
    );
  }

  private _invokeHandler(
    label: string,
    run: () => void | Promise<void> | undefined,
  ): void {
    try {
      const result = run();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch((err) => {
          this.app.log.error({ err }, label);
        });
      }
    } catch (err) {
      this.app.log.error({ err }, label);
    }
  }
}
