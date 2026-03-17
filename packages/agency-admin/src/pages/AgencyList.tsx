import { useEffect, useState } from "react";

interface Agency {
  id: string;
  iaaName: string;
  friendlyName: string;
  abbreviation: string | null;
  protocol: string;
  ial: number;
  status: string;
  updatedAt: string;
}

export function AgencyList({
  onEdit,
  onCreate,
}: {
  onEdit: (id: string) => void;
  onCreate: () => void;
}) {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agencies")
      .then((r) => r.json())
      .then((data) => setAgencies(data.agencies))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1>Registered Agencies</h1>
          <p className="page-desc">Manage agency registrations, protocols, and theme configuration.</p>
        </div>
        <button className="btn btn-primary" onClick={onCreate}>
          + Add Agency
        </button>
      </div>

      {loading ? (
        <p className="empty-state">Loading...</p>
      ) : agencies.length === 0 ? (
        <p className="empty-state">No agencies registered yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Friendly Name</th>
                <th>Protocol</th>
                <th>Service Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => (
                <tr key={a.id} onClick={() => onEdit(a.id)} className="clickable">
                  <td>{a.friendlyName}</td>
                  <td>
                    <span className="badge badge-protocol">{a.protocol.toUpperCase()}</span>
                  </td>
                  <td>{a.ial === 2 ? "Identity Verification" : "Auth Only"}</td>
                  <td>
                    <span className={`badge badge-${a.status}`}>{a.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
