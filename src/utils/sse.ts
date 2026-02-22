import type { Response } from "express";

export interface SSEWriter {
  /** Push an event to the queue (never writes directly to res). */
  send(event: string, data: object): void;
  /** Stop the drain interval, flush remaining events, end the response. */
  close(): void;
  /** Register a parallel agent — SSE won't auto-close until all agents resolve. */
  registerAgent(): void;
  /** Mark one agent as resolved. When all agents have resolved, auto-closes. */
  resolveAgent(): void;
}

interface QueueItem {
  event: string;
  data: object;
}

const DRAIN_INTERVAL_MS = 50;

export function initSSE(res: Response): SSEWriter {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const queue: QueueItem[] = [];
  let agentCount = 0;
  let closed = false;

  function drain() {
    if (!queue.length) return;
    while (queue.length > 0) {
      const item = queue.shift()!;
      const payload = `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`;
      res.write(payload);
    }
    // Force flush — needed to push data through any buffering layers
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  }

  const interval = setInterval(drain, DRAIN_INTERVAL_MS);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    drain(); // flush remaining
    res.end();
  }

  // Clean up if client disconnects (tab close, network drop)
  res.on("close", close);

  return {
    send(event: string, data: object) {
      if (closed) return;
      queue.push({ event, data });
    },

    close,

    registerAgent() {
      agentCount++;
    },

    resolveAgent() {
      agentCount = Math.max(0, agentCount - 1);
      if (agentCount === 0) {
        // Small delay to let any final events get queued
        setTimeout(close, DRAIN_INTERVAL_MS * 2);
      }
    },
  };
}
