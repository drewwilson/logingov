import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { AgencyList } from "./pages/AgencyList.js";
import { AgencyEdit } from "./pages/AgencyEdit.js";
export function App() {
    const [view, setView] = useState({
        page: "list",
    });
    return (_jsxs(_Fragment, { children: [_jsx("nav", { children: _jsxs("a", { className: "nav-brand", href: "#", onClick: () => setView({ page: "list" }), children: [_jsx("div", { className: "nav-logo", children: _jsxs("svg", { width: "24", height: "24", viewBox: "0 0 70 70", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: [_jsx("rect", { x: "42", y: "27", width: "16", height: "8", fill: "currentColor" }), _jsx("rect", { x: "17", y: "51", width: "16", height: "8", fill: "currentColor" }), _jsx("rect", { x: "33", y: "43", width: "19", height: "8", fill: "currentColor" }), _jsx("rect", { x: "11", y: "35", width: "22", height: "8", fill: "currentColor" }), _jsx("rect", { x: "42", y: "11", width: "22", height: "8", fill: "currentColor" }), _jsx("rect", { x: "8", y: "19", width: "34", height: "8", fill: "currentColor" })] }) }), _jsxs("span", { className: "nav-title", children: [_jsx("span", { children: "Login.gov" }), " agency admin"] })] }) }), _jsx("main", { children: view.page === "list" ? (_jsx(AgencyList, { onEdit: (id) => setView({ page: "edit", id }), onCreate: () => setView({ page: "edit", id: null }) })) : (_jsx(AgencyEdit, { id: view.id, onBack: () => setView({ page: "list" }) })) })] }));
}
