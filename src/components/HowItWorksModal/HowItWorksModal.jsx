import { useState, useEffect, useCallback } from "react";
import "./HowItWorksModal.css";

const SEND_STEPS = [
  {
    icon: "☁",
    title: "Pick your file",
    desc: "Drag and drop any file onto the upload zone, or click to browse. Up to 2 GB, any format.",
  },
  {
    icon: "🔑",
    title: "Get your session code",
    desc: "We generate a unique 6-character code tied to your session. No account, no email — just a code.",
  },
  {
    icon: "📤",
    title: "Share the code",
    desc: "Copy the code or share a direct link with whoever needs to receive the file.",
  },
  {
    icon: "⚡",
    title: "File transfers instantly",
    desc: "Once the receiver joins, the file moves peer-to-peer at full speed. You'll see live progress.",
  },
  {
    icon: "✅",
    title: "Done — session closes",
    desc: "When the transfer completes the session expires automatically. Nothing is stored on our servers.",
  },
];

const RECEIVE_STEPS = [
  {
    icon: "💬",
    title: "Get the code from the sender",
    desc: "Ask the sender to share their 6-character session code or send you the direct link.",
  },
  {
    icon: "🔗",
    title: "Enter the code",
    desc: "Go to the Receive tab and type in the code. You'll see the incoming file details immediately.",
  },
  {
    icon: "⬇",
    title: "Accept the file",
    desc: "Hit 'Accept & download' to start the transfer. The file downloads straight to your device.",
  },
  {
    icon: "✅",
    title: "That's it",
    desc: "No app install, no sign-up, no waiting. The session closes once the download finishes.",
  },
];

const FEATURES = [
  { icon: "🔒", label: "End-to-end encrypted" },
  { icon: "🚫", label: "Nothing stored on servers" },
  { icon: "⚡", label: "Peer-to-peer speed" },
  { icon: "📵", label: "No account needed" },
  { icon: "📦", label: "Up to 2 GB per file" },
  { icon: "🌐", label: "Works in any browser" },
];

/* ─────────────────────────────────────────
   HowItWorksModal
   Props:
     isOpen   — boolean
     onClose  — () => void
     onStart  — () => void  (navigates to transfer page)
───────────────────────────────────────── */
function HowItWorksModal({ isOpen, onClose, onStart }) {
  const [closing, setClosing] = useState(false);
  const [activeTab, setActiveTab] = useState("send");

  /* Trigger closing animation before unmounting */
  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 220);
  }, [onClose]);

  /* Close on Escape key */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleClose]);

  /* Lock body scroll while open */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  /* Reset tab when reopened */
  useEffect(() => {
    if (isOpen) setActiveTab("send");
  }, [isOpen]);

  if (!isOpen) return null;

  const steps = activeTab === "send" ? SEND_STEPS : RECEIVE_STEPS;

  const handleStart = () => {
    handleClose();
    setTimeout(onStart, 250);
  };

  return (
    <div
      className={`modal-backdrop${closing ? " closing" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="How Sendit works"
    >
      <div className="modal">

        {/* Close */}
        <button className="modal-close" onClick={handleClose} aria-label="Close">✕</button>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-eyebrow">
            <span className="modal-eyebrow-dot"></span>
            How it works
          </div>
          <h2 className="modal-title">
            Zero friction.<br />
            <span>Maximum speed.</span>
          </h2>
          <p className="modal-subtitle">
            Sendit is session-based — no accounts, no uploads to the cloud.
            Files go straight from you to them.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="modal-tabs" role="tablist">
          <button
            className={`modal-tab${activeTab === "send" ? " active" : ""}`}
            onClick={() => setActiveTab("send")}
            role="tab"
            aria-selected={activeTab === "send"}
          >
            ☁ Sending a file
          </button>
          <button
            className={`modal-tab${activeTab === "receive" ? " active" : ""}`}
            onClick={() => setActiveTab("receive")}
            role="tab"
            aria-selected={activeTab === "receive"}
          >
            ⬇ Receiving a file
          </button>
        </div>

        {/* Steps */}
        <div className="steps" key={activeTab}>
          {steps.map((step, i) => (
            <div className="step" key={i}>
              <div className="step-number">{i + 1}</div>
              <div className="step-body">
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </div>
              <div className="step-icon">{step.icon}</div>
            </div>
          ))}
        </div>

        <div className="modal-divider"></div>

        {/* Features */}
        <div className="features-label">Why Sendit</div>
        <div className="features-grid">
          {FEATURES.map((f, i) => (
            <div className="feature-pill" key={i}>
              <span className="feature-icon">{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>

        {/* CTA */}
        <button className="modal-cta" onClick={handleStart}>
          Let's send a file →
        </button>

      </div>
    </div>
  );
}

export default HowItWorksModal;