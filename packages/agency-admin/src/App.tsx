import { useState } from "react";
import { AgencyList } from "./pages/AgencyList.js";
import { AgencyEdit } from "./pages/AgencyEdit.js";

export function App() {
  const [view, setView] = useState<{ page: "list" } | { page: "edit"; id: string | null }>({
    page: "list",
  });

  return (
    <>
      <nav>
        <a className="nav-brand" href="#" onClick={() => setView({ page: "list" })}>
          <div className="nav-logo">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <span className="nav-title">
            login<span>.gov</span> agency admin
          </span>
        </a>
      </nav>

      <main>
        {view.page === "list" ? (
          <AgencyList
            onEdit={(id) => setView({ page: "edit", id })}
            onCreate={() => setView({ page: "edit", id: null })}
          />
        ) : (
          <AgencyEdit id={view.id} onBack={() => setView({ page: "list" })} />
        )}
      </main>
    </>
  );
}
