import "./Navbar.css";

/*
  Props:
    page       — "home" | "transfer"
    onNavigate — (page) => void
*/
function Navbar({ page = "home", onNavigate }) {
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
            <a
              href="#"
              className={`nav-link${page === "home" ? " active" : ""}`}
              onClick={nav("home")}
            >
              Home
            </a>
          </li>
          <li>
            <a
              href="#"
              className={`nav-link${page === "transfer" ? " active" : ""}`}
              onClick={nav("transfer")}
            >
              Transfer
            </a>
          </li>
          <li>
            <a href="#" className="nav-link">About</a>
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