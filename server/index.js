/**
 * Direct Browser-to-Browser File Transfer — Signaling Server
 * -----------------------------------------------------------
 * Responsibilities (and ONLY these):
 *   1. Issue unique room IDs.
 *   2. Relay WebRTC handshake messages (SDP offer/answer + ICE candidates)
 *      between the two peers in a room.
 *   3. Notify a peer when the other peer joins, rejoins, or drops.
 *   4. Keep a room alive for a short grace period after a drop so the
 *      transfer can auto-resume when the peer reconnects.
 *
 * It NEVER sees file bytes, file names, hashes, or the encryption key —
 * all of that travels directly peer-to-peer over the WebRTC data channel.
 */

import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
// How long a room survives with no connected peers, so a dropped peer can resume.
const ROOM_GRACE_MS = 90 * 1000;

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

// Simple health check (useful for Render/Railway uptime probes).
app.get("/", (_req, res) => res.json({ status: "ok", service: "dbft-signaling" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

/**
 * rooms:   roomId -> { peers: Map<clientId, { socketId, role }>, ttl: Timeout|null }
 * sockets: socketId -> { roomId, clientId }   (reverse lookup on disconnect)
 *
 * We key peers by a stable, client-generated clientId rather than socket.id so
 * that a peer whose socket reconnects (e.g. brief network loss) is recognised
 * as the same participant and can rejoin the same room.
 */
const rooms = new Map();
const sockets = new Map();

/** Return the socketId of the OTHER connected peer in a room, or null. */
function otherPeerSocket(room, clientId) {
  for (const [cid, info] of room.peers) {
    if (cid !== clientId && info.socketId) return info.socketId;
  }
  return null;
}

/** Number of distinct participants currently holding a slot in the room. */
function peerCount(room) {
  return room.peers.size;
}

/** Cancel a pending room-expiry timer, if any. */
function clearRoomTtl(room) {
  if (room.ttl) {
    clearTimeout(room.ttl);
    room.ttl = null;
  }
}

io.on("connection", (socket) => {
  // --- Create a room (sender) -------------------------------------------
  socket.on("create-room", ({ clientId }, ack) => {
    const roomId = nanoid(10);
    const room = {
      peers: new Map([[clientId, { socketId: socket.id, role: "sender" }]]),
      ttl: null,
    };
    rooms.set(roomId, room);
    sockets.set(socket.id, { roomId, clientId });
    ack && ack({ roomId });
  });

  // --- Join a room (receiver) -------------------------------------------
  socket.on("join-room", ({ roomId, clientId }, ack) => {
    const room = rooms.get(roomId);
    if (!room) return ack && ack({ error: "Room not found or expired" });

    const known = room.peers.has(clientId);
    if (!known && peerCount(room) >= 2) {
      return ack && ack({ error: "Room is full" });
    }

    room.peers.set(clientId, { socketId: socket.id, role: "receiver" });
    sockets.set(socket.id, { roomId, clientId });
    clearRoomTtl(room);

    const target = otherPeerSocket(room, clientId);
    if (target) io.to(target).emit("peer-joined");
    ack && ack({ ok: true });
  });

  // --- Rejoin after a reconnect (either peer) ---------------------------
  socket.on("rejoin", ({ roomId, clientId, role }, ack) => {
    const room = rooms.get(roomId);
    if (!room) return ack && ack({ error: "Room expired" });

    const existing = room.peers.get(clientId) || {};
    room.peers.set(clientId, { socketId: socket.id, role: role || existing.role });
    sockets.set(socket.id, { roomId, clientId });
    clearRoomTtl(room);

    const target = otherPeerSocket(room, clientId);
    if (target) io.to(target).emit("peer-rejoined");
    ack && ack({ ok: true });
  });

  // --- Relay handshake signals (offer / answer / ICE) -------------------
  socket.on("signal", ({ data }) => {
    const meta = sockets.get(socket.id);
    if (!meta) return;
    const room = rooms.get(meta.roomId);
    if (!room) return;
    const target = otherPeerSocket(room, meta.clientId);
    if (target) io.to(target).emit("signal", { data });
  });

  // --- Handle drops -----------------------------------------------------
  socket.on("disconnect", () => {
    const meta = sockets.get(socket.id);
    if (!meta) return;
    sockets.delete(socket.id);

    const room = rooms.get(meta.roomId);
    if (!room) return;

    // Mark this participant's socket as gone (keep the slot for resume).
    const peer = room.peers.get(meta.clientId);
    if (peer) peer.socketId = null;

    // Tell the other peer so its UI can show "reconnecting" and pause.
    const target = otherPeerSocket(room, meta.clientId);
    if (target) io.to(target).emit("peer-disconnected");

    // If nobody is connected anymore, expire the room after the grace window.
    const anyConnected = [...room.peers.values()].some((p) => p.socketId);
    if (!anyConnected) {
      clearRoomTtl(room);
      room.ttl = setTimeout(() => rooms.delete(meta.roomId), ROOM_GRACE_MS);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[dbft] signaling server listening on :${PORT}`);
});
