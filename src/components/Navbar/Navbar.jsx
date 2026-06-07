import "./Navbar.css";

function Navbar({ page = "home", onNavigate, initialTab }) {
  const nav = (target) => (e) => {
    e.preventDefault();
    onNavigate?.(target);
  };

  return (
    <header className="header">
      <nav className="navbar">

        <div className="logo" onClick={nav("home")}>
          send<span className="logo-dot">.</span>it
        </div>

        <ul className="nav-links">
          <li>
            <p
              href="#"
              className={`nav-link${page === "home" ? " active" : ""}`}
              onClick={nav("home")}
            >
              Home
            </p>
          </li>
          <li>
            <p href="#" className={`nav-link${page === "transfer" && initialTab === "send" ? " active" : ""}`}
              onClick={(e) => { e.preventDefault(); onNavigate("transfer", "send"); }}>
              Transfer
            </p>
          </li>
          <li>
            <p href="#" className={`nav-link${page === "transfer" && initialTab === "receive" ? " active" : ""}`}
              onClick={(e) => { e.preventDefault(); onNavigate("transfer", "receive"); }}>
              Receive
            </p>
          </li>
          <li className="nav-link-cta-wrap">
            <button className="nav-cta" onClick={nav("transfer")}>
              Send a file
            </button>
          </li>
        </ul>

      </nav>
    </header>
  );
}

export default Navbar;