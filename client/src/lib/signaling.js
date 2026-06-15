/**
 * Thin wrapper around the Socket.io client.
 *
 * Gives each browser a stable `clientId` (persisted for the session) so that if
 * the socket reconnects after a network blip, the server recognises it as the
 * same participant and lets it rejoin the same room — the foundation for
 * auto-resume.
 */

import { io } from "socket.io-client";

export function createSignaling(url) {
  // Stable per-session identity. Survives socket reconnects (not full reloads).
  let clientId = sessionStorage.getItem("dbft-client-id");
  if (!clientId) {
    clientId = crypto.randomUUID();
    sessionStorage.setItem("dbft-client-id", clientId);
  }

  const socket = io(url, { reconnection: true, reconnectionDelay: 800 });
  const handlers = {};
  let roomId = null;
  let role = null;

  // On a reconnect (not the first connect), transparently rejoin the room.
  let hasConnectedOnce = false;
  socket.on("connect", () => {
    if (hasConnectedOnce && roomId && role) {
      socket.emit("rejoin", { roomId, clientId, role }, () => {});
    }
    hasConnectedOnce = true;
  });

  socket.on("signal", ({ data }) => handlers.signal?.(data));
  socket.on("peer-joined", () => handlers.peerJoined?.());
  socket.on("peer-rejoined", () => handlers.peerRejoined?.());
  socket.on("peer-disconnected", () => handlers.peerDisconnected?.());

  return {
    clientId,
    get role() {
      return role;
    },
    get roomId() {
      return roomId;
    },

    createRoom() {
      return new Promise((resolve, reject) => {
        socket.emit("create-room", { clientId }, (res) => {
          if (res?.roomId) {
            roomId = res.roomId;
            role = "sender";
            resolve(res.roomId);
          } else reject(new Error(res?.error || "Could not create room"));
        });
      });
    },

    joinRoom(id) {
      return new Promise((resolve, reject) => {
        socket.emit("join-room", { roomId: id, clientId }, (res) => {
          if (res?.ok) {
            roomId = id;
            role = "receiver";
            resolve();
          } else reject(new Error(res?.error || "Could not join room"));
        });
      });
    },

    sendSignal(data) {
      socket.emit("signal", { data });
    },

    /** Register an event handler. evt: signal|peerJoined|peerRejoined|peerDisconnected */
    on(evt, cb) {
      handlers[evt] = cb;
    },

    disconnect() {
      socket.disconnect();
    },
  };
}
