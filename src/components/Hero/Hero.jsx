import { useState } from "react";
import "./Hero.css";
import HowItWorksModal from "../HowItWorksModal/HowItWorksModal";

/*
  Props:
    onStart — () => void   navigates to the transfer page
*/
function Hero({ onStart }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <section className="hero">

        {/* Animated grid */}
        <div className="hero-grid"></div>

        {/* Floating orbs */}
        <div className="hero-orb hero-orb-1"></div>
        <div className="hero-orb hero-orb-2"></div>
        <div className="hero-orb hero-orb-3"></div>

        {/* Noise texture */}
        <div className="hero-noise"></div>

        {/* Hero content */}
        <div className="hero-content">

          {/* Pulsing badge */}
          <p className="hero-badge">
            <span className="badge-dot"></span>
            Session-based &middot; No account needed
          </p>

          {/* Title — staggered word reveal */}
          <h1 className="hero-title">
            <span className="word word-1">Files </span>
            <span className="word word-2">move </span>
            <span className="word word-3">fast.<br /></span>
            <span className="word word-4">So should </span>
            <span className="word word-5 accent">you.</span>
          </h1>

          {/* Description */}
          <p className="hero-description">
            Drop a file, get a link, send it to anyone.
            Done in under 10 seconds. No login, no drama.
          </p>

          {/* CTA buttons — both wired */}
          <div className="hero-buttons">
            <button className="primary-btn" onClick={onStart}>
              Start sending
            </button>
            <button className="secondary-btn" onClick={() => setModalOpen(true)}>
              See how it works →
            </button>
          </div>

          {/* Drop zone — navigates on click */}
          <div
            className="upload-card"
            onClick={onStart}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onStart()}
          >
            <div className="upload-icon">☁</div>
            <h3>Drop your files here</h3>
            <p>or click to browse from your device</p>
            <button
              className="upload-btn"
              onClick={(e) => { e.stopPropagation(); onStart(); }}
            >
              Choose files
            </button>
            <div className="upload-chips">
              <span className="chip">Up to 2GB</span>
              <span className="chip">All formats</span>
              <span className="chip">Encrypted</span>
            </div>
          </div>

        </div>
      </section>

      {/* How it works modal */}
      <HowItWorksModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onStart={onStart}
      />
    </>
  );
}

export default Hero;
