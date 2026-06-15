# Beam — Direct Browser-to-Browser File Transfer

A lightweight, decentralized peer-to-peer file sharing web app. Drop a file to
get a share link; whoever opens the link connects **directly to your browser**
over WebRTC and streams the file down. A small Node.js signaling server only
brokers the initial handshake — it never reads, processes, or stores any file
data.

Built for **MARS · Open Projects 2026**.

---

## How it works

```
   Sender browser                Signaling server               Receiver browser
   --------------                ----------------               ----------------
   pick file ───────────────────▶ create room ─────────────────▶ (share the link)
                                  relay offer / answer / ICE
   read + hash + encrypt ◀══════ (handshake only, no file) ═════▶ verify + reassemble
            │                                                              ▲
            └──────────── encrypted chunks · direct WebRTC P2P ───────────┘
                          (the signaling server is NOT in this path)
```

1. The sender reads the file with the `FileReader` / `File.arrayBuffer()` API,
   computes a SHA-256 of the whole file and of every 64 KB chunk (the integrity
   manifest), and creates a room on the signaling server.
2. The receiver opens the share link and joins the room. The two browsers
   exchange a WebRTC offer/answer and ICE candidates **through the server**.
3. Once the `RTCDataChannel` opens, the server's job is done. Chunks flow
   **directly between the two browsers**.
4. Each chunk is encrypted in the browser (AES-GCM) before sending and verified
   against its SHA-256 after receipt. The receiver reassembles the chunks,
   re-checks the whole-file hash, and the download starts automatically.

---

## Features

### Core
- **Share room creation** — drag-and-drop zone, 50 MB limit, unique room link.
- **Signaling handshake** — Node.js + Express + Socket.io coordinate the
  WebRTC offer/answer/ICE exchange.
- **Direct P2P transfer** — file is read with the browser File API and streamed
  over a WebRTC data channel with backpressure handling.
- **Chunk integrity verification** — SHA-256 per chunk and for the whole file,
  computed before sending and verified after receipt.
- **Progress, speed, and status** — live percentage, MB/s, ETA, and a
  connection-status pill.
- **Graceful disconnect handling** — if a peer closes the tab or drops, the
  remaining user sees a clear notice; nothing crashes or freezes.
- **Auto-download** — verified chunks are reassembled and downloaded
  automatically on completion.

### Advanced (implemented)
- **Zero-knowledge encryption** — every chunk is AES-GCM encrypted with the Web
  Crypto API. The key is generated in the browser and passed **only in the URL
  hash** (`/#/r/<roomId>/k/<key>`), which browsers never transmit over the
  network. The signaling server therefore never has access to the key or the
  plaintext.
- **Connection-churn auto-resume** — the receiver tracks the last verified
  chunk and keeps verified chunks in memory. If the connection drops
  mid-transfer, the peers re-handshake and the transfer **resumes from the last
  verified chunk** rather than restarting from 0%.

---

## Tech stack

| Layer              | Technology                          |
| ------------------ | ----------------------------------- |
| Frontend           | React + Vite, Tailwind CSS          |
| P2P communication  | WebRTC (`RTCPeerConnection`, data channels) |
| Backend signaling  | Node.js + Express + Socket.io       |
| Crypto / integrity | Web Crypto API (AES-GCM, SHA-256)   |
| Hosting            | Vercel / Netlify (client), Render / Railway (server) |

No P2P wrapper library is used — WebRTC is wired directly so the handshake and
data-channel logic are visible and easy to follow.

---

## Project structure

```
direct-browser-file-transfer/
├── server/                 Signaling server (no file data ever passes through)
│   └── index.js
└── client/
    └── src/
        ├── lib/
        │   ├── protocol.js   constants + binary frame pack/unpack
        │   ├── crypto.js     AES-GCM key gen, URL-hash key, encrypt/decrypt
        │   ├── hash.js       SHA-256 helper
        │   ├── signaling.js  Socket.io client wrapper (stable id + rejoin)
        │   ├── webrtc.js     RTCPeerConnection + data channel wrapper
        │   ├── sender.js     read, hash, encrypt, send (resumable)
        │   └── receiver.js   verify, reassemble, auto-download (resumable)
        ├── hooks/useTransfer.js   orchestration + state machine
        └── components/            DropZone, RoomPanel, ProgressBar, etc.
```

---

## Run locally

You need two terminals. Node 18+ required.

**1. Signaling server**
```bash
cd server
npm install
cp .env.example .env       # optional; defaults are fine for local dev
npm run dev                # starts on http://localhost:4000
```

**2. Client**
```bash
cd client
npm install
cp .env.example .env       # VITE_SIGNALING_URL=http://localhost:4000
npm run dev                # starts on http://localhost:5173
```

Open `http://localhost:5173` in one browser window, drop a file, copy the link,
and open it in a second window (or another device on the same network). The
file transfers directly between them.

> WebRTC requires a secure context. `localhost` counts as secure, so local
> development works without HTTPS. In production the client must be served over
> HTTPS (Vercel/Netlify do this automatically).

### Run the protocol test
```bash
node test.mjs   # round-trips a file through both engines + tests resume
```

---

## Deploy

**Server (Render or Railway)**
- New web service from this repo, root directory `server`.
- Build command: `npm install` · Start command: `npm start`.
- Set `CLIENT_ORIGIN` to your deployed client URL.

**Client (Vercel or Netlify)**
- New project from this repo, root directory `client`.
- Build command: `npm run build` · Output directory: `dist`.
- Set `VITE_SIGNALING_URL` to your deployed server URL.

Deployment links:
- Client: `<add your Vercel/Netlify URL>`
- Server: `<add your Render/Railway URL>`

---

## A note on NAT traversal

This project uses free public **STUN** servers, which works on most home and
office networks. Strict or symmetric NATs (some corporate/mobile networks) need
a **TURN** relay to fall back to. A commented config slot is provided in
`client/src/lib/webrtc.js` — add TURN credentials there if a direct connection
can't be established.

---

## Demo video script (~3 minutes)

1. **(0:00) Intro** — "This is a peer-to-peer file transfer app. The file goes
   directly browser-to-browser; the server only helps them shake hands."
2. **(0:20) Send** — Open the app, drag in a file, show the share link appear.
   Mention the key lives in the URL hash and never reaches the server.
3. **(0:45) Receive** — Open the link in a second window. Show the connection
   status go from connecting to transferring, the live percentage, MB/s, and
   the file auto-downloading. Open the downloaded file to prove it's intact.
4. **(1:30) Integrity** — Briefly show the "verified ✓" badge and explain the
   per-chunk + whole-file SHA-256 checks.
5. **(1:50) Auto-resume** — Start a larger transfer, then in the receiver's
   browser DevTools toggle the network to "Offline" for a few seconds and back.
   Show the status switch to "Reconnecting → Resuming" and the progress
   continue from where it paused rather than restarting.
6. **(2:30) Graceful disconnect** — Close one tab; show the other window display
   a clean "the other person left" notice instead of freezing.
7. **(2:50) Wrap** — Recap: decentralized, encrypted, resumable.

Upload the recording to Google Drive or YouTube and add the link here:
`<demo video link>`
