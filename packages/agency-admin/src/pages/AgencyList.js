import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
export function AgencyList({ onEdit, onCreate, }) {
    const [agencies, setAgencies] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        fetch("/api/agencies")
            .then((r) => r.json())
            .then((data) => setAgencies(data.agencies))
            .finally(() => setLoading(false));
    }, []);
    return (_jsxs("div", { className: "container", children: [_jsxs("div", { className: "page-header", children: [_jsxs("div", { children: [_jsx("h1", { children: "Registered Agencies" }), _jsx("p", { className: "page-desc", children: "Manage agency registrations, protocols, and theme configuration." })] }), _jsx("button", { className: "btn btn-primary", onClick: onCreate, children: "+ Add Agency" })] }), loading ? (_jsx("p", { className: "empty-state", children: "Loading..." })) : agencies.length === 0 ? (_jsx("p", { className: "empty-state", children: "No agencies registered yet." })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Friendly Name" }), _jsx("th", { children: "Protocol" }), _jsx("th", { children: "Service Level" }), _jsx("th", { children: "Status" })] }) }), _jsx("tbody", { children: agencies.map((a) => (_jsxs("tr", { onClick: () => onEdit(a.id), className: "clickable", children: [_jsx("td", { children: a.friendlyName }), _jsx("td", { children: _jsx("span", { className: "badge badge-protocol", children: a.protocol.toUpperCase() }) }), _jsx("td", { children: a.ial === 2 ? "Identity Verification" : "Auth Only" }), _jsx("td", { children: _jsx("span", { className: `badge badge-${a.status}`, children: a.status }) })] }, a.id))) })] }) }))] }));
}
