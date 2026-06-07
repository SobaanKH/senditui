import { useState, useRef, useEffect, useCallback } from "react";
import { io } from "socket.io-client";
import "./TransferPage.css";

/* ─────────────────────────────────────────
   Constants
───────────────────────────────────────── */
const SOCKET_URL = "https://sendit-backend-production.up.railway.app";
const CHUNK_SIZE = 256 * 1024; // 256 KB

/* ─────────────────────────────────────────
   One socket per page mount
───────────────────────────────────────── */
function createSocket() {
  return io(SOCKET_URL, {
    transports: ["websocket"],
    autoConnect: true,
    reconnectionAttempts: 5,
  });
}

/* ─────────────────────────────────────────
   Utilities
───────────────────────────────────────── */
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}
function formatSpeed(bps) {
  if (!bps) return "—";
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " MB/s";
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " KB/s";
  return bps + " B/s";
}
function formatEta(totalBytes, sentBytes, bps) {
  if (!bps || sentBytes >= totalBytes) return "—";
  const secs = Math.ceil((totalBytes - sentBytes) / bps);
  if (secs < 60) return `~${secs}s`;
  return `~${Math.ceil(secs / 60)}m`;
}
function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
function fileEmoji(name = "") {
  const ext = name.split(".").pop().toLowerCase();
  if (["zip","rar","7z","tar","gz"].includes(ext))           return "🗜";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext))  return "🖼";
  if (["mp4","mov","avi","mkv"].includes(ext))                return "🎬";
  if (["mp3","wav","flac","aac"].includes(ext))               return "🎵";
  if (["pdf"].includes(ext))                                  return "📕";
  if (["doc","docx"].includes(ext))                           return "📝";
  if (["xls","xlsx"].includes(ext))                           return "📊";
  return "📄";
}

/* ─────────────────────────────────────────
   Toast hook
───────────────────────────────────────── */
function useToast() {
  const [toast, setToast] = useState({ msg: "", type: "success", show: false });
  const timerRef = useRef(null);
  const showToast = useCallback((msg, type = "success") => {
    clearTimeout(timerRef.current);
    setToast({ msg, type, show: true });
    timerRef.current = setTimeout(
      () => setToast((t) => ({ ...t, show: false })),
      3000
    );
  }, []);
  return { toast, showToast };
}

/* ─────────────────────────────────────────
   Rolling speed tracker
───────────────────────────────────────── */
function useSpeedTracker() {
  const samples = useRef([]);
  const record  = useCallback((bytes) => {
    const now = Date.now();
    samples.current.push({ bytes, ts: now });
    samples.current = samples.current.filter((s) => now - s.ts < 1500);
  }, []);
  const getSpeed  = useCallback(() => {
    const now    = Date.now();
    const window = samples.current.filter((s) => now - s.ts < 1000);
    return window.reduce((sum, s) => sum + s.bytes, 0);
  }, []);
  const resetSpeed = useCallback(() => { samples.current = []; }, []);
  return { record, getSpeed, resetSpeed };
}

/* ─────────────────────────────────────────
   SEND PANEL
───────────────────────────────────────── */
function SendPanel({ socket, showToast }) {
  const [phase, setPhase]         = useState("idle");
  const [file, setFile]           = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [sessionCode, setSessionCode] = useState("");
  const [timeLeft, setTimeLeft]   = useState(900);
  const [copied, setCopied]       = useState(false);
  const [sentBytes, setSentBytes] = useState(0);
  const [speed, setSpeed]         = useState(0);
  const [errorMsg, setErrorMsg]   = useState("");

  const countdownRef  = useRef(null);
  const speedInterval = useRef(null);

  const sessionCodeRef = useRef("");
  const phaseRef       = useRef("idle");
  const fileRef        = useRef(null);

  const { record, getSpeed, resetSpeed } = useSpeedTracker();

  const setPhaseSync = (p) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => { sessionCodeRef.current = sessionCode; }, [sessionCode]);
  useEffect(() => { fileRef.current = file; }, [file]);

  useEffect(() => {
    socket.on("room-created", ({ code }) => {
      setSessionCode(code);
      sessionCodeRef.current = code;
      setPhaseSync("session");
      setTimeLeft(900);

      countdownRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(countdownRef.current);
            handleExpired();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    });

    socket.on("receiver-joined", () => {
      clearInterval(countdownRef.current);
      startChunkedSend();
    });

    socket.on("peer-disconnected", () => {
      stopTransfer();
      setErrorMsg("Receiver disconnected mid-transfer.");
      setPhaseSync("error");
      showToast("⚠ Receiver disconnected", "error");
    });

    socket.on("transfer-cancelled", () => {
      stopTransfer();
      setErrorMsg("The receiver cancelled the transfer.");
      setPhaseSync("error");
      showToast("Transfer cancelled by receiver", "error");
    });

    return () => {
      socket.off("room-created");
      socket.off("receiver-joined");
      socket.off("peer-disconnected");
      socket.off("transfer-cancelled");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const stopTransfer = () => {
    clearInterval(countdownRef.current);
    clearInterval(speedInterval.current);
    resetSpeed();
  };

  const handleExpired = () => {
    stopTransfer();
    setPhaseSync("idle");
    setSessionCode("");
    sessionCodeRef.current = "";
    showToast("Session expired — create a new one", "error");
  };

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    fileRef.current = f;
    setPhaseSync("ready");
    setSentBytes(0);
    setErrorMsg("");
  };
  const handleFileInput = (e) => pickFile(e.target.files?.[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  };
  const removeFile = (e) => {
    e.stopPropagation();
    stopTransfer();
    setFile(null);
    fileRef.current = null;
    setPhaseSync("idle");
  };

  const handleCreateRoom = () => {
    setPhaseSync("creating");
    socket.emit("create-room");
  };

  const startChunkedSend = async () => {
    const f    = fileRef.current;
    const code = sessionCodeRef.current;
    if (!f || !code) return;

    const totalChunks = Math.ceil(f.size / CHUNK_SIZE);
    setPhaseSync("sending");
    setSentBytes(0);
    resetSpeed();

    speedInterval.current = setInterval(() => setSpeed(getSpeed()), 400);

    socket.emit("file-meta", {
      code,
      meta: { name: f.name, size: f.size, type: f.type, totalChunks },
    });

    for (let i = 0; i < totalChunks; i++) {
      if (phaseRef.current !== "sending") break;

      const start = i * CHUNK_SIZE;
      const end   = Math.min(start + CHUNK_SIZE, f.size);
      const chunk = await f.slice(start, end).arrayBuffer();

      socket.emit("file-chunk", { code, chunk, chunkIndex: i });

      setSentBytes(end);
      record(end - start);

      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (phaseRef.current !== "sending") return;

    socket.emit("file-done", { code });
    clearInterval(speedInterval.current);
    setSpeed(0);
    setPhaseSync("done");
    showToast("✓ File delivered!", "success");
  };

  const handleCancel = () => {
    if (sessionCodeRef.current) {
      socket.emit("transfer-cancelled", { code: sessionCodeRef.current });
    }
    stopTransfer();
    setFile(null);
    fileRef.current = null;
    setPhaseSync("idle");
    setSessionCode("");
    sessionCodeRef.current = "";
    setSentBytes(0);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sessionCode);
    setCopied(true);
    showToast("Session code copied!", "success");
    setTimeout(() => setCopied(false), 2000);
  };
  const handleShareLink = () => {
    const url = `${window.location.origin}?session=${sessionCode}`;
    if (navigator.share) navigator.share({ title: "Join my Sendit session", url });
    else { navigator.clipboard.writeText(url); showToast("Link copied!", "success"); }
  };

  const handleReset = () => {
    stopTransfer();
    setFile(null);
    fileRef.current = null;
    setPhaseSync("idle");
    setSessionCode("");
    sessionCodeRef.current = "";
    setSentBytes(0);
    setErrorMsg("");
  };

  const pct            = file ? Math.min(Math.round((sentBytes / file.size) * 100), 100) : 0;
  const isExpiringSoon = timeLeft <= 120;

  return (
    <div className="panel-card">

      {phase === "idle" && (
        <>
          <p className="panel-label">Step 1 — Choose your file</p>
          <div
            className={`drop-zone${dragOver ? " drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input type="file" onChange={handleFileInput} />
            <div className="dz-icon">☁</div>
            <div className="dz-title">Drop your file here</div>
            <div className="dz-sub">or click to browse — up to 2 GB, any format</div>
          </div>
        </>
      )}

      {phase === "ready" && file && (
        <>
          <p className="panel-label">Step 1 — File selected</p>
          <div className="file-preview">
            <div className="fp-icon">{fileEmoji(file.name)}</div>
            <div className="fp-meta">
              <div className="fp-name">{file.name}</div>
              <div className="fp-size">{formatBytes(file.size)}</div>
            </div>
            <button className="fp-remove" onClick={removeFile}>✕</button>
          </div>
          <div className="panel-divider" />
          <button className="action-btn primary" onClick={handleCreateRoom}>
            Generate session code →
          </button>
        </>
      )}

      {phase === "creating" && (
        <>
          <p className="panel-label">Creating your session…</p>
          <div className="connecting-state">
            <div className="connecting-spinner" />
            <span>Connecting to server</span>
          </div>
        </>
      )}

      {phase === "session" && file && (
        <>
          <p className="panel-label">Step 2 — Share your session code</p>
          <div className="file-preview">
            <div className="fp-icon">{fileEmoji(file.name)}</div>
            <div className="fp-meta">
              <div className="fp-name">{file.name}</div>
              <div className="fp-size">{formatBytes(file.size)}</div>
            </div>
          </div>
          <div className="session-display">
            <div className="sd-live"><span className="live-dot" />Waiting for receiver</div>
            <div className="sd-code">{sessionCode}</div>
            <div className="sd-actions">
              <button className={`sd-btn sd-btn-copy${copied ? " copied" : ""}`} onClick={handleCopyCode}>
                {copied ? "✓ Copied!" : "⎘ Copy code"}
              </button>
              <button className="sd-btn sd-btn-share" onClick={handleShareLink}>↗ Share link</button>
            </div>
            <div className={`sd-expire${isExpiringSoon ? " soon" : ""}`}>
              {isExpiringSoon ? "⚠" : "⏱"} Expires in {formatTime(timeLeft)}
            </div>
          </div>
          <p style={{ fontSize:"0.75rem", color:"rgba(255,255,255,0.22)", textAlign:"center", lineHeight:1.5 }}>
            Transfer starts automatically once the receiver joins.
          </p>
          <button className="action-btn danger" onClick={handleCancel}>Cancel session</button>
        </>
      )}

      {phase === "sending" && file && (
        <>
          <p className="panel-label">Sending…</p>
          <div className="file-preview">
            <div className="fp-icon">{fileEmoji(file.name)}</div>
            <div className="fp-meta">
              <div className="fp-name">{file.name}</div>
              <div className="fp-size">{formatBytes(file.size)}</div>
            </div>
            <span className="status-badge sending">Sending</span>
          </div>
          <div className="send-progress">
            <div className="sp-top">
              <span className="sp-label">Transfer progress</span>
              <span className="sp-pct">{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-card"><div className="stat-lbl">Speed</div><div className="stat-val purple">{formatSpeed(speed)}</div></div>
            <div className="stat-card"><div className="stat-lbl">Sent</div><div className="stat-val">{formatBytes(sentBytes)}</div></div>
            <div className="stat-card"><div className="stat-lbl">ETA</div><div className="stat-val green">{formatEta(file.size, sentBytes, speed)}</div></div>
          </div>
          <button className="action-btn danger" onClick={handleCancel}>Cancel transfer</button>
        </>
      )}

      {phase === "done" && file && (
        <>
          <div className="done-banner">
            <div className="done-icon">✅</div>
            <h4>File delivered!</h4>
            <p>{file.name} was transferred successfully.</p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Send another file</button>
        </>
      )}

      {phase === "error" && (
        <>
          <div className="error-banner">
            <div className="error-icon">⚠</div>
            <h4>Transfer failed</h4>
            <p>{errorMsg}</p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Try again</button>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   RECEIVE PANEL
───────────────────────────────────────── */
function ReceivePanel({ socket, showToast, initialCode, onCodeConsumed }) {
  const [phase, setPhase]               = useState("idle");
  const [code, setCode]                 = useState(initialCode || "");
  const [codeError, setCodeError]       = useState("");
  const [incomingFile, setIncomingFile] = useState(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [speed, setSpeed]               = useState(0);
  const [errorMsg, setErrorMsg]         = useState("");

  const chunksRef     = useRef([]);   // Array of ArrayBuffers indexed by chunkIndex
  const fileMetaRef   = useRef(null);
  const speedInterval = useRef(null);
  const phaseRef      = useRef("idle");
  const codeRef       = useRef("");

  const { record, getSpeed, resetSpeed } = useSpeedTracker();

  const setPhaseSync = (p) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => { codeRef.current = code; }, [code]);

  useEffect(() => {
    if (initialCode && initialCode.length >= 4) {
      const t = setTimeout(() => {
        setPhaseSync("joining");
        socket.emit("join-room", { code: initialCode });
        onCodeConsumed?.();
      }, 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    socket.on("join-success", () => {
      setPhaseSync("waiting");
      setCodeError("");
    });

    socket.on("join-error", ({ message }) => {
      setPhaseSync("idle");
      setCodeError(message || "Invalid or expired code.");
    });

    socket.on("file-meta", ({ meta }) => {
      fileMetaRef.current = meta;
      setIncomingFile(meta);
      // Pre-allocate chunk array
      chunksRef.current = new Array(meta.totalChunks).fill(null);
      setReceivedBytes(0);
      setPhaseSync("incoming");
    });

    socket.on("file-chunk", ({ chunk, chunkIndex }) => {
      if (phaseRef.current !== "receiving") return;

      // chunk arrives as ArrayBuffer
      const buf = chunk instanceof ArrayBuffer ? chunk : chunk.buffer ?? chunk;
      chunksRef.current[chunkIndex] = buf;

      const byteLen = buf.byteLength;
      setReceivedBytes((b) => b + byteLen);
      record(byteLen);
    });

    socket.on("file-done", () => {
      clearInterval(speedInterval.current);
      const meta = fileMetaRef.current;

      // Filter out any null slots (shouldn't happen, but safety net)
      const validChunks = chunksRef.current.filter(Boolean);
      const blob        = new Blob(validChunks, { type: meta.type || "application/octet-stream" });
      const url         = URL.createObjectURL(blob);
      const a           = document.createElement("a");
      a.href            = url;
      a.download        = meta.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 15_000);

      setPhaseSync("done");
      showToast("✓ Download started!", "success");
    });

    socket.on("peer-disconnected", () => {
      clearInterval(speedInterval.current);
      setErrorMsg("Sender disconnected. Transfer interrupted.");
      setPhaseSync("error");
      showToast("⚠ Sender disconnected", "error");
    });

    socket.on("transfer-cancelled", () => {
      clearInterval(speedInterval.current);
      setErrorMsg("The sender cancelled the transfer.");
      setPhaseSync("error");
      showToast("Transfer was cancelled", "error");
    });

    return () => {
      socket.off("join-success");
      socket.off("join-error");
      socket.off("file-meta");
      socket.off("file-chunk");
      socket.off("file-done");
      socket.off("peer-disconnected");
      socket.off("transfer-cancelled");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  /* ── Join room ── */
  const handleJoin = () => {
    const trimmed = code.trim().replace(/[·\s-]/g, "").toUpperCase();
    if (trimmed.length < 4) {
      setCodeError("Code looks too short — double check it.");
      return;
    }
    setPhaseSync("joining");
    socket.emit("join-room", { code: trimmed });
  };

  /* ── Accept: flip phase so file-chunk handler starts accumulating ── */
  const handleAccept = () => {
    setPhaseSync("receiving");
    resetSpeed();
    speedInterval.current = setInterval(() => setSpeed(getSpeed()), 400);
  };

  const handleDecline = () => {
    socket.emit("transfer-cancelled", { code: codeRef.current });
    handleReset();
  };

  const handleReset = () => {
    clearInterval(speedInterval.current);
    resetSpeed();
    chunksRef.current   = [];
    fileMetaRef.current = null;
    setCode("");
    codeRef.current = "";
    setCodeError("");
    setIncomingFile(null);
    setReceivedBytes(0);
    setSpeed(0);
    setErrorMsg("");
    setPhaseSync("idle");
  };

  const totalBytes = incomingFile?.size ?? 1;
  const pct        = Math.min(Math.round((receivedBytes / totalBytes) * 100), 100);

  return (
    <div className="panel-card">

      {(phase === "idle" || phase === "joining") && (
        <>
          <p className="panel-label">Step 1 — Enter the session code</p>
          <div className="code-input-wrap">
            <div className="code-input-row">
              <input
                className={`code-input${codeError ? " error" : ""}`}
                type="text"
                placeholder="XX·XX·XX"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 8)); setCodeError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                maxLength={8}
                autoFocus
                spellCheck={false}
                disabled={phase === "joining"}
              />
              <button
                className="join-btn"
                onClick={handleJoin}
                disabled={phase === "joining" || code.trim().length < 4}
              >
                {phase === "joining" ? "Joining…" : "Join →"}
              </button>
            </div>
            {codeError && <div className="code-error">⚠ {codeError}</div>}
          </div>
          <div className="panel-divider" />
          <p style={{ fontSize:"0.76rem", color:"rgba(255,255,255,0.22)", lineHeight:1.6, textAlign:"center" }}>
            Ask the sender for their 6-character session code.<br />
            Your file transfers directly — nothing is stored.
          </p>
        </>
      )}

      {phase === "waiting" && (
        <>
          <p className="panel-label">Connected — waiting for sender</p>
          <div className="connecting-state">
            <div className="connecting-spinner" />
            <span>Waiting for the sender to start the transfer</span>
          </div>
          <button className="action-btn danger" onClick={handleReset}>Leave session</button>
        </>
      )}

      {phase === "incoming" && incomingFile && (
        <>
          <p className="panel-label">Step 2 — Incoming file</p>
          <div className="incoming-card">
            <div className="ic-header">
              <div className="ic-icon">{fileEmoji(incomingFile.name)}</div>
              <div className="ic-meta">
                <div className="ic-name">{incomingFile.name}</div>
                <div className="ic-size">{formatBytes(incomingFile.size)}</div>
              </div>
            </div>
            <button className="receive-btn" onClick={handleAccept}>⬇ Accept &amp; download</button>
          </div>
          <button className="action-btn danger" onClick={handleDecline}>Decline</button>
        </>
      )}

      {phase === "receiving" && incomingFile && (
        <>
          <p className="panel-label">Receiving…</p>
          <div className="file-preview">
            <div className="fp-icon">{fileEmoji(incomingFile.name)}</div>
            <div className="fp-meta">
              <div className="fp-name">{incomingFile.name}</div>
              <div className="fp-size">{formatBytes(incomingFile.size)}</div>
            </div>
            <span className="status-badge receiving">Receiving</span>
          </div>
          <div className="send-progress">
            <div className="sp-top">
              <span className="sp-label">Download progress</span>
              <span className="sp-pct">{pct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-card"><div className="stat-lbl">Speed</div><div className="stat-val purple">{formatSpeed(speed)}</div></div>
            <div className="stat-card"><div className="stat-lbl">Received</div><div className="stat-val">{formatBytes(receivedBytes)}</div></div>
            <div className="stat-card"><div className="stat-lbl">ETA</div><div className="stat-val green">{formatEta(incomingFile.size, receivedBytes, speed)}</div></div>
          </div>
        </>
      )}

      {phase === "done" && incomingFile && (
        <>
          <div className="done-banner">
            <div className="done-icon">⬇</div>
            <h4>Download complete!</h4>
            <p>{incomingFile.name} has been saved to your device.</p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Receive another file</button>
        </>
      )}

      {phase === "error" && (
        <>
          <div className="error-banner">
            <div className="error-icon">⚠</div>
            <h4>Something went wrong</h4>
            <p>{errorMsg}</p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Try again</button>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   MAIN PAGE
   One socket created here, passed as a
   prop so both panels share it.
───────────────────────────────────────── */
function TransferPage({ initialCode, onCodeConsumed, initialTab }) {
  // If arriving via shared link, default to receive tab
  const [tab, setTab] = useState(initialCode ? "receive" : (initialTab || "send"));
  const { toast, showToast } = useToast();
  const socketRef            = useRef(null);

  if (!socketRef.current) {
    socketRef.current = createSocket();
  }

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  return (
    <main className="transfer-page">
      <div className="tp-grid" />
      <div className="tp-orb tp-orb-1" />
      <div className="tp-orb tp-orb-2" />

      <div className="tp-content">
        <div className="tp-heading">
          <h2>
            {tab === "send" ? <>Send a <span>file</span></> : <>Receive a <span>file</span></>}
          </h2>
          <p>
            {tab === "send"
              ? "Select a file, generate a code, share it with the receiver."
              : "Got a code from the sender? Enter it below to download."}
          </p>
        </div>

        <div className="tab-switcher">
          <button className={`tab-btn${tab === "send" ? " active" : ""}`} onClick={() => setTab("send")}>
            <span className="tab-icon">☁</span> Send
          </button>
          <button className={`tab-btn${tab === "receive" ? " active" : ""}`} onClick={() => setTab("receive")}>
            <span className="tab-icon">⬇</span> Receive
          </button>
        </div>

        {tab === "send"
          ? <SendPanel    key="send"    socket={socketRef.current} showToast={showToast} />
          : <ReceivePanel key="receive" socket={socketRef.current} showToast={showToast} initialCode={initialCode} onCodeConsumed={onCodeConsumed} />
        }
      </div>

      <div className={`toast${toast.show ? " show" : ""} ${toast.type}`}>
        {toast.msg}
      </div>
    </main>
  );
}

export default TransferPage;