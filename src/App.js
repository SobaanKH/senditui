import { useState } from "react";

import "./responsive.css";
import Navbar from "./components/Navbar/Navbar";
import Hero from "./components/Hero/Hero";
import TransferPage from "./components/TransferPage/TransferPage";

function App() {
  const [page, setPage] = useState("home");

  return (
    <>
      <Navbar page={page} onNavigate={setPage} />

      {page === "home"  && <Hero onStart={() => setPage("transfer")} />}
      {page === "transfer" && <TransferPage />}
    </>
  );
}

export default App;