/**
 * Typed IPC bridge — works in both Elektrobun (uses window.__elektrobun_bridge)
 * and the dev WebSocket server (devserver.ts).
 */

type EventHandler = (payload: unknown) => void;

const eventHandlers = new Map<string, Set<EventHandler>>();
let callId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

// ── WebSocket dev mode ──────────────────────────────────────────────────────

let ws: WebSocket | null = null;

function devSocket(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);
    if (msg.type === "event") {
      const handlers = eventHandlers.get(msg.event);
      if (handlers) for (const h of handlers) h(msg.payload);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  };
  return ws;
}

// ── Unified call ────────────────────────────────────────────────────────────

export function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  // Elektrobun exposes a global bridge
  if (typeof (window as any).__elektrobun_bridge !== "undefined") {
    return (window as any).__elektrobun_bridge.invoke(method, ...args);
  }

  // Dev WebSocket fallback
  return new Promise<T>((resolve, reject) => {
    const id = ++callId;
    pending.set(id, { resolve, reject });
    const socket = devSocket();
    const send = () => socket.send(JSON.stringify({ id, method, args }));
    if (socket.readyState === WebSocket.OPEN) send();
    else socket.addEventListener("open", send, { once: true });
  });
}

export function on(event: string, handler: EventHandler): () => void {
  if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
  eventHandlers.get(event)!.add(handler);

  // Elektrobun native event subscription
  if (typeof (window as any).__elektrobun_bridge !== "undefined") {
    (window as any).__elektrobun_bridge.on(event, handler);
  }

  return () => {
    eventHandlers.get(event)?.delete(handler);
    if (typeof (window as any).__elektrobun_bridge !== "undefined") {
      (window as any).__elektrobun_bridge.off(event, handler);
    }
  };
}
