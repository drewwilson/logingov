import { useState } from "react";
import { AgencyList } from "./pages/AgencyList.js";
import { AgencyEdit } from "./pages/AgencyEdit.js";

export function App() {
  const [view, setView] = useState<
    { page: "list" } | { page: "edit"; id: string | null }
  >({
    page: "list",
  });

  return (
    <>
      <nav>
        <a
          className="nav-brand"
          href="#"
          onClick={() => setView({ page: "list" })}
        >
          <div className="nav-logo">
            <svg
              width="24"
              height="24"
              viewBox="0 0 70 70"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect x="42" y="27" width="16" height="8" fill="currentColor" />
              <rect x="17" y="51" width="16" height="8" fill="currentColor" />
              <rect x="33" y="43" width="19" height="8" fill="currentColor" />
              <rect x="11" y="35" width="22" height="8" fill="currentColor" />
              <rect x="42" y="11" width="22" height="8" fill="currentColor" />
              <rect x="8" y="19" width="34" height="8" fill="currentColor" />
            </svg>
          </div>
          <span className="nav-title">
            <span>Login.gov</span> agency admin
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
