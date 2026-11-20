// Boundary Planet (Cloudflare Worker)
// Serves the game at access.tesseros.com/boundary-planet/ and runs the multiplayer rooms.
//
// How a room works: each room code is one Durable Object (Room). Everyone in the room
// connects to it with a WebSocket. The first person in is the host: their browser runs
// the game and sends a snapshot about 12 times a second. Everyone else sends only their
// own planet's position and spin. The Room just passes messages along; it doesn't run
// the game itself.

import { DurableObject } from "cloudflare:workers";

const BASE = "/boundary-planet";
const MAX_PLAYERS = 3;
const MAX_MESSAGE = 200_000; // bytes; a snapshot is a few KB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const ws = url.pathname.match(/^\/boundary-planet\/ws\/([A-Za-z0-9]{4,8})$/);
    if (ws) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 });
      }
      // Only pages on this site may open a room.
      const origin = request.headers.get("Origin");
      if (origin && new URL(origin).host !== url.host) {
        return new Response("Forbidden", { status: 403 });
      }
      const room = env.ROOMS.get(env.ROOMS.idFromName(ws[1].toUpperCase()));
      return room.fetch(request);
    }

    if (url.pathname === BASE) {
      return Response.redirect(url.origin + BASE + "/" + url.search, 301);
    }
    // Always check for the newest version of the game page, so a reload picks up changes.
    const res = await env.ASSETS.fetch(request);
    if (!(res.headers.get("Content-Type") || "").includes("text/html")) return res;
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-cache");
    return out;
  },
};

export class Room extends DurableObject {
  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernation API: the room can sleep between messages without dropping anyone.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), name: "", slot: -1, joined: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Everyone seated, oldest first. The oldest is the host.
  seated(except) {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except)
      .map((ws) => ({ ws, a: ws.deserializeAttachment() }))
      .filter((p) => p.a && p.a.slot >= 0)
      .sort((x, y) => x.a.joined - y.a.joined);
  }

  broadcastPlayers(except) {
    const seated = this.seated(except);
    const msg = JSON.stringify({
      t: "players",
      hostId: seated[0] ? seated[0].a.id : null,
      players: seated.map(({ a }) => ({ id: a.id, name: a.name, slot: a.slot })),
    });
    for (const { ws } of seated) safeSend(ws, msg);
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();

    if (m.t === "hello") {
      if (me.slot >= 0) return;
      if (await this.ctx.storage.get("inGame")) {
        safeSend(ws, JSON.stringify({ t: "busy" }));
        ws.close(1000, "busy");
        return;
      }
      const used = new Set(this.seated().map((p) => p.a.slot));
      const slot = [...Array(MAX_PLAYERS).keys()].find((s) => !used.has(s));
      if (slot === undefined) {
        safeSend(ws, JSON.stringify({ t: "full" }));
        ws.close(1000, "full");
        return;
      }
      const name = String(m.name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16) || "Player";
      Object.assign(me, { name, slot, joined: Date.now() });
      ws.serializeAttachment(me);
      safeSend(ws, JSON.stringify({ t: "welcome", id: me.id, slot }));
      this.broadcastPlayers();
      return;
    }

    if (me.slot < 0) return;
    const seated = this.seated();
    const host = seated[0] && seated[0].ws;

    // A player's own planet goes to the host only, tagged with their seat.
    if (m.t === "input") {
      if (host && host !== ws) {
        safeSend(host, JSON.stringify({ t: "input", slot: me.slot, x: m.x, y: m.y, rot: m.rot }));
      }
      return;
    }

    // Everything else comes from the host and goes to everyone else.
    if (ws !== host) return;
    if (m.t === "start") await this.ctx.storage.put("inGame", true);
    if (m.t === "end") await this.ctx.storage.put("inGame", false);
    if (m.t === "start" || m.t === "state" || m.t === "end") {
      for (const p of seated) if (p.ws !== ws) safeSend(p.ws, raw);
    }
  }

  async webSocketClose(ws) {
    await this.left(ws);
    try { ws.close(1000, "bye"); } catch {}
  }

  async webSocketError(ws) {
    await this.left(ws);
  }

  async left(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.slot < 0) return;
    ws.serializeAttachment({ ...a, slot: -1 });
    const rest = this.seated(ws);
    const wasHost = !rest.length || a.joined <= rest[0].a.joined;
    // If the host leaves, that season can't go on; the next person becomes host.
    if (wasHost || !rest.length) await this.ctx.storage.put("inGame", false);
    this.broadcastPlayers(ws);
  }
}

function safeSend(ws, msg) {
  try { ws.send(msg); } catch {}
}
