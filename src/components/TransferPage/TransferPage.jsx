import { useState, useRef, useEffect, useCallback } from "react";
import { io } from "socket.io-client";
import "./TransferPage.css";

/* ─────────────────────────────────────────
   Constants
───────────────────────────────────────── */
const SOCKET_URL = "http://localhost:3001";
const CHUNK_SIZE = 256 * 1024; // 256 KB

/* ─────────────────────────────────────────
   Singleton socket
───────────────────────────────────────── */
let _socket = null;

function getSocket() {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
      reconnectionAttempts: 5,
    });
  }
  return _socket;
}

function destroySocket() {
  if (_socket) { _socket.disconnect(); _socket = null; }
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
  if (!bps) return "— MB/s";
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " MB/s";
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " KB/s";
  return bps + " B/s";
}

function formatEta(totalBytes, sentBytes, bps) {
  if (!bps || sentBytes >= totalBytes) return "—";
  const secs = Math.ceil((totalBytes - sentBytes) / bps);
  if (secs < 60) return "~" + secs + "s";
  return "~" + Math.ceil(secs / 60) + "m";
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return m + ":" + s;
}

function fileEmoji(name) {
  if (!name) return "📄";
  const ext = name.split(".").pop().toLowerCase();
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "🗜";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "🖼";
  if (["mp4","mov","avi","mkv"].includes(ext)) return "🎬";
  if (["mp3","wav","flac","aac"].includes(ext)) return "🎵";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc","docx"].includes(ext)) return "📝";
  if (["xls","xlsx"].includes(ext)) return "📊";
  return "📄";
}

function sumSize(files) {
  return files.reduce(function(s, f) { return s + f.size; }, 0);
}

/* ─────────────────────────────────────────
   Toast hook
───────────────────────────────────────── */
function useToast() {
  const [toast, setToast] = useState({ msg: "", type: "success", show: false });
  const timerRef = useRef(null);
  const showToast = useCallback(function(msg, type) {
    if (!type) type = "success";
    clearTimeout(timerRef.current);
    setToast({ msg: msg, type: type, show: true });
    timerRef.current = setTimeout(function() {
      setToast(function(t) { return Object.assign({}, t, { show: false }); });
    }, 3000);
  }, []);
  return { toast: toast, showToast: showToast };
}

/* ─────────────────────────────────────────
   Speed tracker
───────────────────────────────────────── */
function useSpeedTracker() {
  const samples = useRef([]);
  const record = useCallback(function(bytes) {
    const now = Date.now();
    samples.current.push({ bytes: bytes, ts: now });
    samples.current = samples.current.filter(function(s) { return now - s.ts < 1500; });
  }, []);
  const getSpeed = useCallback(function() {
    const now = Date.now();
    return samples.current
      .filter(function(s) { return now - s.ts < 1000; })
      .reduce(function(sum, s) { return sum + s.bytes; }, 0);
  }, []);
  const reset = useCallback(function() { samples.current = []; }, []);
  return { record: record, getSpeed: getSpeed, reset: reset };
}

/* ─────────────────────────────────────────
   FileRow — shared by both panels
───────────────────────────────────────── */
function FileRow({ name, size, badge, badgeClass, onRemove }) {
  return (
    <div className="file-list-row">
      <div className="fp-icon">{fileEmoji(name)}</div>
      <div className="fp-meta">
        <div className="fp-name">{name}</div>
        <div className="fp-size">{formatBytes(size)}</div>
      </div>
      {badge && <span className={"status-badge " + (badgeClass || "")}>{badge}</span>}
      {onRemove && (
        <button className="fp-remove" onClick={onRemove} title="Remove">✕</button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   SEND PANEL
───────────────────────────────────────── */
function SendPanel({ showToast }) {
  const [phase, setPhase]               = useState("idle");
  const [files, setFiles]               = useState([]);
  const [dragOver, setDragOver]         = useState(false);
  const [sessionCode, setSessionCode]   = useState("");
  const [timeLeft, setTimeLeft]         = useState(900);
  const [copied, setCopied]             = useState(false);
  const [curFileIdx, setCurFileIdx]     = useState(0);
  const [curFileSent, setCurFileSent]   = useState(0);
  const [totalSent, setTotalSent]       = useState(0);
  const [speed, setSpeed]               = useState(0);
  const [errorMsg, setErrorMsg]         = useState("");

  const countdownRef   = useRef(null);
  const speedInterval  = useRef(null);
  const socketRef      = useRef(null);
  const filesRef       = useRef([]);
  const sessionCodeRef = useRef("");
  const { record, getSpeed, reset: resetSpeed } = useSpeedTracker();

  useEffect(function() { filesRef.current = files; }, [files]);

  useEffect(function() {
    socketRef.current = getSocket();
    return function() { cleanup(false); };
  }, []); // eslint-disable-line

  useEffect(function() {
    const socket = socketRef.current;
    if (!socket) return;

    function onRoomCreated({ code }) {
      sessionCodeRef.current = code;
      setSessionCode(code);
      setPhase("session");
      setTimeLeft(900);
      countdownRef.current = setInterval(function() {
        setTimeLeft(function(t) {
          if (t <= 1) { clearInterval(countdownRef.current); handleSessionExpired(); return 0; }
          return t - 1;
        });
      }, 1000);
    }

    function onReceiverJoined() {
      clearInterval(countdownRef.current);
      startChunkedSend();
    }

    function onPeerDisconnected() {
      cleanup(true);
      setErrorMsg("Receiver disconnected. Try again.");
      setPhase("error");
      showToast("⚠ Receiver disconnected", "error");
    }

    function onTransferCancelled() {
      cleanup(true);
      setErrorMsg("The receiver cancelled the transfer.");
      setPhase("error");
      showToast("Transfer cancelled by receiver", "error");
    }

    socket.on("room-created",       onRoomCreated);
    socket.on("receiver-joined",    onReceiverJoined);
    socket.on("peer-disconnected",  onPeerDisconnected);
    socket.on("transfer-cancelled", onTransferCancelled);

    return function() {
      socket.off("room-created",       onRoomCreated);
      socket.off("receiver-joined",    onReceiverJoined);
      socket.off("peer-disconnected",  onPeerDisconnected);
      socket.off("transfer-cancelled", onTransferCancelled);
    };
  }, []); // eslint-disable-line

  function cleanup(keepFiles) {
    clearInterval(countdownRef.current);
    clearInterval(speedInterval.current);
    resetSpeed();
    if (!keepFiles) { setFiles([]); filesRef.current = []; }
  }

  function handleSessionExpired() {
    cleanup(false);
    setPhase("idle");
    setSessionCode(""); sessionCodeRef.current = "";
    showToast("Session expired — create a new one", "error");
  }

  function mergeFiles(incoming) {
    const arr = Array.from(incoming);
    setFiles(function(prev) {
      const seen = new Set(prev.map(function(f) { return f.name + f.size; }));
      const added = arr.filter(function(f) { return !seen.has(f.name + f.size); });
      const next = prev.concat(added);
      if (next.length > 0) setPhase("ready");
      return next;
    });
    setErrorMsg("");
  }

  function handleFileInput(e) {
    if (e.target.files && e.target.files.length) mergeFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) mergeFiles(e.dataTransfer.files);
  }

  function removeFileAt(index) {
    setFiles(function(prev) {
      const next = prev.filter(function(_, i) { return i !== index; });
      if (next.length === 0) setPhase("idle");
      return next;
    });
  }

  function handleCreateRoom() {
    setPhase("creating");
    socketRef.current.emit("create-room");
  }

  async function startChunkedSend() {
    const socket      = socketRef.current;
    const code        = sessionCodeRef.current;
    const toSend      = filesRef.current;
    if (!toSend.length || !code) return;

    const allFilesMeta = toSend.map(function(f) { return { name: f.name, size: f.size }; });
    let   overallSent  = 0;

    setPhase("sending");
    setCurFileIdx(0); setCurFileSent(0); setTotalSent(0);
    resetSpeed();

    speedInterval.current = setInterval(function() { setSpeed(getSpeed()); }, 400);

    for (let fi = 0; fi < toSend.length; fi++) {
      const f           = toSend[fi];
      const totalChunks = Math.ceil(f.size / CHUNK_SIZE);

      setCurFileIdx(fi);
      setCurFileSent(0);

      socket.emit("file-meta", {
        code: code,
        meta: {
          name: f.name, size: f.size, type: f.type,
          totalChunks: totalChunks,
          fileIndex:   fi,
          totalFiles:  toSend.length,
          allFiles:    allFilesMeta,
        },
      });

      for (let i = 0; i < totalChunks; i++) {
        const start     = i * CHUNK_SIZE;
        const end       = Math.min(start + CHUNK_SIZE, f.size);
        const chunkSize = end - start;
        const chunk     = await f.slice(start, end).arrayBuffer();

        socket.emit("file-chunk", { code: code, chunk: chunk, chunkIndex: i });

        setCurFileSent(end);
        overallSent += chunkSize;
        setTotalSent(overallSent);
        record(chunkSize);

        if (i % 10 === 0) await new Promise(function(r) { setTimeout(r, 0); });
      }

      socket.emit("file-done", { code: code });

      if (fi < toSend.length - 1) {
        await new Promise(function(r) { setTimeout(r, 150); });
      }
    }

    clearInterval(speedInterval.current);
    setSpeed(0);
    setPhase("done");
    const n = toSend.length;
    showToast("✓ " + n + " file" + (n > 1 ? "s" : "") + " delivered!", "success");
  }

  function handleCancel() {
    const code = sessionCodeRef.current;
    if (code) socketRef.current && socketRef.current.emit("transfer-cancelled", { code: code });
    cleanup(false);
    setPhase("idle");
    setSessionCode(""); sessionCodeRef.current = "";
    setCurFileSent(0); setTotalSent(0);
  }

  function handleCopyCode() {
    navigator.clipboard.writeText(sessionCode);
    setCopied(true);
    showToast("Session code copied!", "success");
    setTimeout(function() { setCopied(false); }, 2000);
  }

  function handleShareLink() {
    const url = window.location.origin + "?session=" + sessionCode;
    if (navigator.share) navigator.share({ title: "Join my Sendit session", url: url });
    else { navigator.clipboard.writeText(url); showToast("Link copied!", "success"); }
  }

  function handleReset() {
    cleanup(false);
    setPhase("idle");
    setSessionCode(""); sessionCodeRef.current = "";
    setCurFileSent(0); setTotalSent(0); setErrorMsg("");
  }

  const grand       = sumSize(files) || 1;
  const curFile     = files[curFileIdx];
  const curPct      = curFile ? Math.min(Math.round(curFileSent / curFile.size * 100), 100) : 0;
  const overallPct  = Math.min(Math.round(totalSent / grand * 100), 100);
  const isExpiring  = timeLeft <= 120;

  return (
    <div className="panel-card">

      {/* ── Idle ── */}
      {phase === "idle" && (
        <>
          <p className="panel-label">Step 1 — Choose your files</p>
          <div
            className={"drop-zone" + (dragOver ? " drag-over" : "")}
            onDragOver={function(e) { e.preventDefault(); setDragOver(true); }}
            onDragLeave={function() { setDragOver(false); }}
            onDrop={handleDrop}
          >
            <input type="file" multiple onChange={handleFileInput} />
            <div className="dz-icon">☁</div>
            <div className="dz-title">Drop files here</div>
            <div className="dz-sub">or click to browse — multiple files, any format, up to 2 GB each</div>
          </div>
        </>
      )}

      {/* ── Ready ── */}
      {phase === "ready" && (
        <>
          <p className="panel-label">
            Step 1 — {files.length} file{files.length > 1 ? "s" : ""} selected
            <span className="panel-label-sub"> · {formatBytes(sumSize(files))}</span>
          </p>

          <div className="file-list">
            {files.map(function(f, i) {
              return (
                <FileRow
                  key={f.name + f.size + i}
                  name={f.name} size={f.size}
                  onRemove={function() { removeFileAt(i); }}
                />
              );
            })}
          </div>

          <div
            className={"drop-zone drop-zone-mini" + (dragOver ? " drag-over" : "")}
            onDragOver={function(e) { e.preventDefault(); setDragOver(true); }}
            onDragLeave={function() { setDragOver(false); }}
            onDrop={handleDrop}
          >
            <input type="file" multiple onChange={handleFileInput} />
            <span className="dz-mini-label">＋ Add more files</span>
          </div>

          <div className="panel-divider" />
          <button className="action-btn primary" onClick={handleCreateRoom}>
            Generate session code →
          </button>
        </>
      )}

      {/* ── Creating ── */}
      {phase === "creating" && (
        <>
          <p className="panel-label">Creating your session…</p>
          <div className="connecting-state">
            <div className="connecting-spinner" />
            <span>Connecting to server</span>
          </div>
        </>
      )}

      {/* ── Session live ── */}
      {phase === "session" && (
        <>
          <p className="panel-label">
            Step 2 — Share your code
            <span className="panel-label-sub"> · {files.length} file{files.length > 1 ? "s" : ""}, {formatBytes(sumSize(files))}</span>
          </p>

          <div className="file-list file-list-compact">
            {files.map(function(f, i) {
              return <FileRow key={f.name + f.size + i} name={f.name} size={f.size} />;
            })}
          </div>

          <div className="session-display">
            <div className="sd-live"><span className="live-dot" />Waiting for receiver</div>
            <div className="sd-code">{sessionCode}</div>
            <div className="sd-actions">
              <button className={"sd-btn sd-btn-copy" + (copied ? " copied" : "")} onClick={handleCopyCode}>
                {copied ? "✓ Copied!" : "⎘ Copy code"}
              </button>
              <button className="sd-btn sd-btn-share" onClick={handleShareLink}>↗ Share link</button>
            </div>
            <div className={"sd-expire" + (isExpiring ? " soon" : "")}>
              {isExpiring ? "⚠" : "⏱"} Expires in {formatTime(timeLeft)}
            </div>
          </div>

          <button className="action-btn danger" onClick={handleCancel}>Cancel session</button>
        </>
      )}

      {/* ── Sending ── */}
      {phase === "sending" && curFile && (
        <>
          <p className="panel-label">
            Sending file {curFileIdx + 1} of {files.length}…
          </p>

          <div className="file-list file-list-compact">
            {files.map(function(f, i) {
              const isDone   = i < curFileIdx;
              const isActive = i === curFileIdx;
              return (
                <FileRow
                  key={f.name + f.size + i}
                  name={f.name} size={f.size}
                  badge={isDone ? "Done" : isActive ? "Sending" : "Queued"}
                  badgeClass={isDone ? "done" : isActive ? "sending" : "queued"}
                />
              );
            })}
          </div>

          <div className="send-progress">
            <div className="sp-top">
              <span className="sp-label">{curFile.name}</span>
              <span className="sp-pct">{curPct}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: curPct + "%" }} />
            </div>
          </div>

          {files.length > 1 && (
            <div className="send-progress send-progress-overall">
              <div className="sp-top">
                <span className="sp-label">Overall</span>
                <span className="sp-pct">{overallPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill progress-fill-dim" style={{ width: overallPct + "%" }} />
              </div>
            </div>
          )}

          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-lbl">Speed</div>
              <div className="stat-val purple">{formatSpeed(speed)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-lbl">Sent</div>
              <div className="stat-val">{formatBytes(totalSent)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-lbl">ETA</div>
              <div className="stat-val green">{formatEta(grand, totalSent, speed)}</div>
            </div>
          </div>

          <button className="action-btn danger" onClick={handleCancel}>Cancel transfer</button>
        </>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <>
          <div className="done-banner">
            <div className="done-icon">✅</div>
            <h4>{files.length > 1 ? files.length + " files delivered!" : "File delivered!"}</h4>
            <p>
              {files.length > 1
                ? "All " + files.length + " files were transferred successfully."
                : (files[0] ? files[0].name : "Your file") + " was transferred successfully."}
            </p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Send more files</button>
        </>
      )}

      {/* ── Error ── */}
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
function ReceivePanel({ showToast }) {
  const [phase, setPhase]               = useState("idle");
  const [code, setCode]                 = useState("");
  const [codeError, setCodeError]       = useState("");
  const [batchFiles, setBatchFiles]     = useState([]);
  const [curFileIdx, setCurFileIdx]     = useState(0);
  const [curReceived, setCurReceived]   = useState(0);
  const [totalReceived, setTotalReceived] = useState(0);
  const [speed, setSpeed]               = useState(0);
  const [errorMsg, setErrorMsg]         = useState("");

  const socketRef        = useRef(null);
  const chunksRef        = useRef([]);
  const fileMetaRef      = useRef(null);
  const totalReceivedRef = useRef(0);
  const speedInterval    = useRef(null);
  const { record, getSpeed, reset: resetSpeed } = useSpeedTracker();

  useEffect(function() {
    socketRef.current = getSocket();
    return function() { clearInterval(speedInterval.current); resetSpeed(); };
  }, []); // eslint-disable-line

  useEffect(function() {
    const socket = socketRef.current;
    if (!socket) return;

    function onJoinSuccess() { setPhase("waiting"); setCodeError(""); }
    function onJoinError({ message }) { setPhase("idle"); setCodeError(message || "Invalid or expired code."); }

    function onFileMeta({ meta }) {
      fileMetaRef.current   = meta;
      chunksRef.current     = new Array(meta.totalChunks);
      setCurFileIdx(meta.fileIndex || 0);
      setCurReceived(0);

      if (!meta.fileIndex || meta.fileIndex === 0) {
        // First file — build the full batch list
        const src  = meta.allFiles || [{ name: meta.name, size: meta.size }];
        const list = src.map(function(f, i) {
          return { name: f.name, size: f.size, status: i === 0 ? "receiving" : "pending" };
        });
        setBatchFiles(list);
        setPhase("incoming");
      } else {
        // Subsequent file — update statuses
        setBatchFiles(function(prev) {
          return prev.map(function(f, i) {
            return Object.assign({}, f, {
              status: i < meta.fileIndex ? "done" : i === meta.fileIndex ? "receiving" : "pending"
            });
          });
        });
      }
    }

    function onFileChunk({ chunk, chunkIndex }) {
      // Always buffer — never gate on user acceptance
      chunksRef.current[chunkIndex] = chunk;
      const chunkBytes = chunk.byteLength || chunk.size || CHUNK_SIZE;
      setCurReceived(function(b) { return b + chunkBytes; });
      const newTotal = totalReceivedRef.current + chunkBytes;
      totalReceivedRef.current = newTotal;
      setTotalReceived(newTotal);
      record(chunkBytes);
    }

    function onFileDone() {
      const meta = fileMetaRef.current;
      if (!meta) return;

      const blob = new Blob(chunksRef.current, { type: meta.type || "application/octet-stream" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = meta.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 10000);

      setBatchFiles(function(prev) {
        return prev.map(function(f, i) {
          return i === meta.fileIndex ? Object.assign({}, f, { status: "done" }) : f;
        });
      });

      const isLast = (meta.fileIndex || 0) >= (meta.totalFiles || 1) - 1;
      if (isLast) {
        clearInterval(speedInterval.current);
        setPhase("done");
        const n = meta.totalFiles || 1;
        showToast("✓ " + n + " file" + (n > 1 ? "s" : "") + " downloaded!", "success");
      }
    }

    function onPeerDisconnected() {
      clearInterval(speedInterval.current);
      setErrorMsg("Sender disconnected. The transfer was interrupted.");
      setPhase("error");
      showToast("⚠ Sender disconnected", "error");
    }

    function onTransferCancelled() {
      clearInterval(speedInterval.current);
      setErrorMsg("The sender cancelled the transfer.");
      setPhase("error");
      showToast("Transfer was cancelled", "error");
    }

    socket.on("join-success",       onJoinSuccess);
    socket.on("join-error",         onJoinError);
    socket.on("file-meta",          onFileMeta);
    socket.on("file-chunk",         onFileChunk);
    socket.on("file-done",          onFileDone);
    socket.on("peer-disconnected",  onPeerDisconnected);
    socket.on("transfer-cancelled", onTransferCancelled);

    return function() {
      socket.off("join-success",       onJoinSuccess);
      socket.off("join-error",         onJoinError);
      socket.off("file-meta",          onFileMeta);
      socket.off("file-chunk",         onFileChunk);
      socket.off("file-done",          onFileDone);
      socket.off("peer-disconnected",  onPeerDisconnected);
      socket.off("transfer-cancelled", onTransferCancelled);
    };
  }, []); // eslint-disable-line

  function handleCodeChange(e) {
    setCode(e.target.value.toUpperCase().slice(0, 8));
    setCodeError("");
  }

  function handleJoin() {
    const trimmed = code.trim().replace(/[·\s]/g, "");
    if (trimmed.length < 4) { setCodeError("Code looks too short — double check it."); return; }
    setPhase("joining");
    socketRef.current.emit("join-room", { code: trimmed });
  }

  function handleAccept() {
    setPhase("receiving");
    resetSpeed();
    totalReceivedRef.current = 0;
    setTotalReceived(0);
    speedInterval.current = setInterval(function() { setSpeed(getSpeed()); }, 400);
  }

  function handleDecline() {
    if (socketRef.current) socketRef.current.emit("transfer-cancelled", { code: code });
    handleReset();
  }

  function handleReset() {
    clearInterval(speedInterval.current);
    resetSpeed();
    chunksRef.current = []; fileMetaRef.current = null;
    totalReceivedRef.current = 0;
    setCode(""); setCodeError(""); setBatchFiles([]);
    setCurFileIdx(0); setCurReceived(0);
    setTotalReceived(0); setSpeed(0); setErrorMsg("");
    setPhase("idle");
  }

  const grandTotal   = batchFiles.reduce(function(s, f) { return s + f.size; }, 0) || 1;
  const curFile      = batchFiles[curFileIdx];
  const curPct       = curFile ? Math.min(Math.round(curReceived / curFile.size * 100), 100) : 0;
  const overallPct   = Math.min(Math.round(totalReceived / grandTotal * 100), 100);
  const totalFiles   = batchFiles.length;

  return (
    <div className="panel-card">

      {/* ── Code entry ── */}
      {(phase === "idle" || phase === "joining") && (
        <>
          <p className="panel-label">Step 1 — Enter the session code</p>
          <div className="code-input-wrap">
            <div className="code-input-row">
              <input
                className={"code-input" + (codeError ? " error" : "")}
                type="text" placeholder="XX·XX·XX"
                value={code} onChange={handleCodeChange}
                onKeyDown={function(e) { if (e.key === "Enter") handleJoin(); }}
                maxLength={8} autoFocus spellCheck={false}
                disabled={phase === "joining"}
              />
              <button
                className="join-btn" onClick={handleJoin}
                disabled={phase === "joining" || code.trim().length < 4}
              >
                {phase === "joining" ? "Joining…" : "Join →"}
              </button>
            </div>
            {codeError && <div className="code-error">⚠ {codeError}</div>}
          </div>
          <div className="panel-divider" />
          <p style={{ fontSize: "0.76rem", color: "rgba(255,255,255,0.22)", lineHeight: 1.6, textAlign: "center" }}>
            Ask the sender for their session code.<br />Files transfer directly — nothing is stored.
          </p>
        </>
      )}

      {/* ── Waiting ── */}
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

      {/* ── Incoming batch ── */}
      {phase === "incoming" && (
        <>
          <p className="panel-label">
            Step 2 — Incoming {totalFiles > 1 ? totalFiles + " files" : "file"}
            <span className="panel-label-sub"> · {formatBytes(grandTotal)}</span>
          </p>

          <div className="file-list">
            {batchFiles.map(function(f, i) {
              return <FileRow key={f.name + f.size + i} name={f.name} size={f.size} />;
            })}
          </div>

          <div className="incoming-actions">
            <button className="receive-btn" onClick={handleAccept}>
              ⬇ Accept &amp; download{totalFiles > 1 ? " all " + totalFiles + " files" : ""}
            </button>
            <button className="action-btn danger" onClick={handleDecline}>Decline</button>
          </div>
        </>
      )}

      {/* ── Receiving ── */}
      {phase === "receiving" && (
        <>
          <p className="panel-label">
            Receiving file {curFileIdx + 1} of {totalFiles}…
          </p>

          <div className="file-list file-list-compact">
            {batchFiles.map(function(f, i) {
              return (
                <FileRow
                  key={f.name + f.size + i}
                  name={f.name} size={f.size}
                  badge={f.status === "done" ? "Done" : f.status === "receiving" ? "Receiving" : "Queued"}
                  badgeClass={f.status === "done" ? "done" : f.status === "receiving" ? "receiving" : "queued"}
                />
              );
            })}
          </div>

          {curFile && (
            <div className="send-progress">
              <div className="sp-top">
                <span className="sp-label">{curFile.name}</span>
                <span className="sp-pct">{curPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: curPct + "%" }} />
              </div>
            </div>
          )}

          {totalFiles > 1 && (
            <div className="send-progress send-progress-overall">
              <div className="sp-top">
                <span className="sp-label">Overall</span>
                <span className="sp-pct">{overallPct}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill progress-fill-dim" style={{ width: overallPct + "%" }} />
              </div>
            </div>
          )}

          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-lbl">Speed</div>
              <div className="stat-val purple">{formatSpeed(speed)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-lbl">Received</div>
              <div className="stat-val">{formatBytes(totalReceived)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-lbl">ETA</div>
              <div className="stat-val green">{formatEta(grandTotal, totalReceived, speed)}</div>
            </div>
          </div>
        </>
      )}

      {/* ── Done ── */}
      {phase === "done" && (
        <>
          <div className="done-banner">
            <div className="done-icon">⬇</div>
            <h4>{totalFiles > 1 ? totalFiles + " files downloaded!" : "Download complete!"}</h4>
            <p>
              {totalFiles > 1
                ? "All " + totalFiles + " files have been saved to your device."
                : (batchFiles[0] ? batchFiles[0].name : "Your file") + " has been saved to your device."}
            </p>
          </div>
          <button className="action-btn primary" onClick={handleReset}>Receive more files</button>
        </>
      )}

      {/* ── Error ── */}
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
───────────────────────────────────────── */
function TransferPage() {
  const [tab, setTab] = useState("send");
  const { toast, showToast } = useToast();
  useEffect(function() { return destroySocket; }, []);

  return (
    <main className="transfer-page">
      <div className="tp-grid" />
      <div className="tp-orb tp-orb-1" />
      <div className="tp-orb tp-orb-2" />

      <div className="tp-content">
        <div className="tp-heading">
          <h2>{tab === "send" ? <><span>Send</span> files</> : <><span>Receive</span> files</>}</h2>
          <p>
            {tab === "send"
              ? "Select one or more files, generate a code, share it with the receiver."
              : "Got a code from the sender? Enter it below to start downloading."}
          </p>
        </div>

        <div className="tab-switcher">
          <button className={"tab-btn" + (tab === "send" ? " active" : "")} onClick={function() { setTab("send"); }}>
            <span className="tab-icon">☁</span> Send
          </button>
          <button className={"tab-btn" + (tab === "receive" ? " active" : "")} onClick={function() { setTab("receive"); }}>
            <span className="tab-icon">⬇</span> Receive
          </button>
        </div>

        {tab === "send"
          ? <SendPanel key="send" showToast={showToast} />
          : <ReceivePanel key="receive" showToast={showToast} />}
      </div>

      <div className={"toast" + (toast.show ? " show" : "") + " " + toast.type}>
        {toast.msg}
      </div>
    </main>
  );
}

export default TransferPage;