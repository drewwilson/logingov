import { useEffect, useState } from "react";

interface AgencyData {
  iaaName: string;
  friendlyName: string;
  abbreviation: string;
  description: string;
  websiteUrl: string;
  protocol: string;
  ial: number;
  defaultAal: number;
  logo: string;
  publicCertificate: string;
  status: string;
  themeConfig: {
    primaryColor: string;
    heroPanel: string;
    backLinkText: string;
    backLinkUrl: string;
    formBackgroundColor: string;
  };
}

const EMPTY: AgencyData = {
  iaaName: "",
  friendlyName: "",
  abbreviation: "",
  description: "",
  websiteUrl: "",
  protocol: "oidc",
  ial: 1,
  defaultAal: 1,
  logo: "",
  publicCertificate: "",
  status: "draft",
  themeConfig: {
    primaryColor: "#0071bc",
    heroPanel: "",
    backLinkText: "",
    backLinkUrl: "",
    formBackgroundColor: "#ffffff",
  },
};

export function AgencyEdit({ id, onBack }: { id: string | null; onBack: () => void }) {
  const [data, setData] = useState<AgencyData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = id === null;

  useEffect(() => {
    if (!id) return;
    fetch(`/api/agencies/${id}`)
      .then((r) => r.json())
      .then((row) => {
        let theme = EMPTY.themeConfig;
        if (row.themeConfig) {
          try {
            theme = { ...EMPTY.themeConfig, ...JSON.parse(row.themeConfig) };
          } catch {}
        }
        setData({
          iaaName: row.iaaName ?? "",
          friendlyName: row.friendlyName ?? "",
          abbreviation: row.abbreviation ?? "",
          description: row.description ?? "",
          websiteUrl: row.websiteUrl ?? "",
          protocol: row.protocol ?? "oidc",
          ial: row.ial ?? 1,
          defaultAal: row.defaultAal ?? 1,
          logo: row.logo ?? "",
          publicCertificate: row.publicCertificate ?? "",
          status: row.status ?? "draft",
          themeConfig: theme,
        });
      });
  }, [id]);

  function set<K extends keyof AgencyData>(key: K, value: AgencyData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function setTheme(key: string, value: string) {
    setData((prev) => ({
      ...prev,
      themeConfig: { ...prev.themeConfig, [key]: value },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const method = isNew ? "POST" : "PUT";
    const url = isNew ? "/api/agencies" : `/api/agencies/${id}`;

    // Auto-fill back link fields from websiteUrl if left empty
    const payload = { ...data, themeConfig: { ...data.themeConfig } };
    if (!payload.themeConfig.backLinkUrl && payload.websiteUrl) {
      payload.themeConfig.backLinkUrl = payload.websiteUrl;
    }
    if (!payload.themeConfig.backLinkText && payload.websiteUrl) {
      payload.themeConfig.backLinkText = `Back to ${payload.websiteUrl.replace(/^https?:\/\//, "")}`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `Request failed (${res.status})`);
        setSaving(false);
        return;
      }
      onBack();
    } catch (e: any) {
      setError(e.message || "Network error");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this agency?")) return;
    setDeleting(true);
    await fetch(`/api/agencies/${id}`, { method: "DELETE" });
    setDeleting(false);
    onBack();
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => set("logo", reader.result as string);
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = () => set("logo", reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <button className="btn btn-secondary btn-sm" onClick={onBack}>
            &larr; Back
          </button>
          <h1>{isNew ? "New Agency" : "Edit Agency"}</h1>
          {!isNew && (
            <p className="agency-id mono text-muted" title="Click to copy" onClick={() => navigator.clipboard.writeText(id!)}>
              ID: {id}
            </p>
          )}
        </div>
        <div className="header-actions">
          {!isNew && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => window.open(`/api/agencies/${id}/preview`, "_blank")}
              >
                Preview Sign-In
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-card">
        <fieldset>
          <legend>Registration Info</legend>

          <label>
            <span className="label-text">IAA Application Name *</span>
            <input type="text" value={data.iaaName} onChange={(e) => set("iaaName", e.target.value)} required />
          </label>

          <label>
            <span className="label-text">Friendly Name *</span>
            <input
              type="text"
              value={data.friendlyName}
              onChange={(e) => set("friendlyName", e.target.value)}
              required
            />
          </label>

          <div className="form-row">
            <label>
              <span className="label-text">Abbreviation</span>
              <input
                type="text"
                value={data.abbreviation}
                onChange={(e) => set("abbreviation", e.target.value)}
                placeholder="e.g. IRS"
              />
            </label>

            <label>
              <span className="label-text">Website URL</span>
              <input
                type="url"
                value={data.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                placeholder="https://agency.gov"
              />
            </label>
          </div>

          <label>
            <span className="label-text">Description</span>
            <textarea value={data.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Protocol & Assurance</legend>

          <div className="form-row">
            <label>
              <span className="label-text">Protocol</span>
              <select value={data.protocol} onChange={(e) => set("protocol", e.target.value)}>
                <option value="oidc">OpenID Connect</option>
                <option value="saml">SAML</option>
              </select>
            </label>

            <label>
              <span className="label-text">Service Level</span>
              <select value={data.ial} onChange={(e) => set("ial", Number(e.target.value))}>
                <option value={1}>Authentication Only (IAL1)</option>
                <option value={2}>Identity Verification (IAL2)</option>
              </select>
            </label>

            <label>
              <span className="label-text">Default AAL</span>
              <select value={data.defaultAal} onChange={(e) => set("defaultAal", Number(e.target.value))}>
                <option value={1}>AAL1</option>
                <option value={2}>AAL2</option>
              </select>
            </label>
          </div>

          <label>
            <span className="label-text">Public Certificate (PEM)</span>
            <textarea
              value={data.publicCertificate}
              onChange={(e) => set("publicCertificate", e.target.value)}
              rows={6}
              className="mono"
              placeholder="-----BEGIN PUBLIC KEY-----&#10;..."
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>Branding / Theme</legend>

          <label>
            <span className="label-text">Logo (SVG or image file)</span>
            <input type="file" accept="image/*,.svg" onChange={handleLogoFile} />
          </label>
          {data.logo && (
            <div className="logo-preview">
              {data.logo.startsWith("<") ? (
                <div dangerouslySetInnerHTML={{ __html: data.logo }} />
              ) : (
                <img src={data.logo} alt="Logo preview" />
              )}
            </div>
          )}

          <div className="form-row">
            <label>
              <span className="label-text">Primary Color</span>
              <div className="color-input">
                <input
                  type="color"
                  value={data.themeConfig.primaryColor}
                  onChange={(e) => setTheme("primaryColor", e.target.value)}
                />
                <input
                  type="text"
                  value={data.themeConfig.primaryColor}
                  onChange={(e) => setTheme("primaryColor", e.target.value)}
                  className="mono"
                  maxLength={7}
                />
              </div>
            </label>

            <label>
              <span className="label-text">Form Background Color</span>
              <div className="color-input">
                <input
                  type="color"
                  value={data.themeConfig.formBackgroundColor}
                  onChange={(e) => setTheme("formBackgroundColor", e.target.value)}
                />
                <input
                  type="text"
                  value={data.themeConfig.formBackgroundColor}
                  onChange={(e) => setTheme("formBackgroundColor", e.target.value)}
                  className="mono"
                  maxLength={7}
                />
              </div>
            </label>
          </div>

          <label>
            <span className="label-text">Hero Panel (image URL or CSS gradient)</span>
            <input
              type="text"
              value={data.themeConfig.heroPanel}
              onChange={(e) => setTheme("heroPanel", e.target.value)}
              placeholder="linear-gradient(135deg, #0071bc 0%, #112e51 100%)"
            />
          </label>

          <div className="form-row">
            <label>
              <span className="label-text">Back Link Text</span>
              <input
                type="text"
                value={data.themeConfig.backLinkText}
                onChange={(e) => setTheme("backLinkText", e.target.value)}
                placeholder={data.websiteUrl ? `Back to ${data.websiteUrl.replace(/^https?:\/\//, "")}` : "Back to Agency.gov"}
              />
            </label>

            <label>
              <span className="label-text">Back Link URL</span>
              <input
                type="url"
                value={data.themeConfig.backLinkUrl}
                onChange={(e) => setTheme("backLinkUrl", e.target.value)}
                placeholder={data.websiteUrl || "https://agency.gov"}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Status</legend>
          <label>
            <select value={data.status} onChange={(e) => set("status", e.target.value)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </fieldset>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : isNew ? "Create Agency" : "Save Changes"}
          </button>
          <button className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
