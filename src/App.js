import { useState, useEffect } from "react";

import "./responsive.css";
import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/Hero/Hero";
import TransferPage from "./components/TransferPage/TransferPage";

function App() {
  const params       = new URLSearchParams(window.location.search);
  const sessionParam = params.get("session")?.trim().toUpperCase() || null;

  const [page, setPage]               = useState(sessionParam ? "transfer" : "home");
  const [initialCode, setInitialCode] = useState(sessionParam);

  useEffect(() => {
    if (sessionParam) {
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  return (
    <>
      <Navbar page={page} onNavigate={(p) => { setPage(p); setInitialCode(null); }} />

      {page === "home" && (
        <Hero onStart={() => setPage("transfer")} />
      )}

      {page === "transfer" && (
        <TransferPage
          initialCode={initialCode}
          onCodeConsumed={() => setInitialCode(null)}
        />
      )}
    </>
  );
}

export default App;