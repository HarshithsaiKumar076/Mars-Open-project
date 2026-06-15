/**
 * WebRTC peer wrapper.
 *
 * Wraps an RTCPeerConnection plus a single ordered, reliable data channel, and
 * wires ICE/SDP through the signaling layer. The sender is the "initiator"
 * (creates the channel + offer); the receiver answers.
 *
 * For auto-resume we take the robust route: on a fresh join OR a rejoin we
 * rebuild the peer connection and data channel from scratch. The receiver keeps
 * its already-verified chunks in memory and simply asks the sender to continue
 * from the next missing chunk, so no data is re-sent unnecessarily.
 */

const ICE_CONFIG = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    // To support strict/symmetric NATs, add a TURN server here, e.g.:
    // { urls: "turn:your-turn-host:3478", username: "user", credential: "pass" },
  ],
};

export function createPeer({
  signaling,
  initiator,
  onChannelOpen,
  onChannelMessage,
  onChannelClose,
  onConnectionState,
}) {
  let pc = null;
  let dc = null;
  let pendingCandidates = [];

  function bindChannel(channel) {
    channel.binaryType = "arraybuffer";
    channel.onopen = () => onChannelOpen?.(channel);
    channel.onmessage = (e) => onChannelMessage?.(e.data, channel);
    channel.onclose = () => onChannelClose?.();
  }

  function setup() {
    pc = new RTCPeerConnection(ICE_CONFIG);
    pendingCandidates = [];

    pc.onicecandidate = (e) => {
      if (e.candidate) signaling.sendSignal({ type: "ice", candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => onConnectionState?.(pc.connectionState);

    if (initiator) {
      dc = pc.createDataChannel("file", { ordered: true });
      bindChannel(dc);
    } else {
      pc.ondatachannel = (e) => {
        dc = e.channel;
        bindChannel(dc);
      };
    }
  }

  async function makeOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.sendSignal({ type: "offer", sdp: pc.localDescription });
  }

  async function flushCandidates() {
    for (const c of pendingCandidates) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* ignore late/duplicate candidates */
      }
    }
    pendingCandidates = [];
  }

  // Incoming handshake messages from the other peer.
  signaling.on("signal", async (data) => {
    if (data.type === "offer") {
      // A fresh offer means first contact OR a resume after a drop. Either way,
      // build a clean connection to answer against.
      if (pc) close();
      setup();
      await pc.setRemoteDescription(data.sdp);
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signaling.sendSignal({ type: "answer", sdp: pc.localDescription });
    } else if (data.type === "answer") {
      if (!pc) return;
      await pc.setRemoteDescription(data.sdp);
      await flushCandidates();
    } else if (data.type === "ice") {
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* ignore late/duplicate candidates */
        }
      } else {
        pendingCandidates.push(data.candidate); // queue until remote desc is set
      }
    }
  });

  function close() {
    try {
      dc?.close();
    } catch {}
    try {
      pc?.close();
    } catch {}
    dc = null;
    pc = null;
  }

  return {
    /** Start a brand-new connection (first time the peers meet). */
    start() {
      setup();
      if (initiator) makeOffer();
    },
    /** Tear down and rebuild — used by the initiator to resume after a drop. */
    restart() {
      close();
      setup();
      if (initiator) makeOffer();
    },
    close,
    get channel() {
      return dc;
    },
    get connection() {
      return pc;
    },
  };
}
