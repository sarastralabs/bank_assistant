interface PortalHomeProps {
  apiOnline: boolean | null;
  onOpenAdmin: () => void;
  onOpenAgent: () => void;
  onOpenDesk: () => void;
}

export function PortalHome({
  apiOnline,
  onOpenAdmin,
  onOpenAgent,
  onOpenDesk,
}: PortalHomeProps) {
  return (
    <div className="portal-shell">
      <div className="portal-hero">
        <p className="portal-eyebrow">Sarastra · Voice banking lobby</p>
        <h1>Kannada Voice Banking</h1>
        <p className="portal-lead">
          Staff and lobby are separate. Admin signs in and opens the lobby. The Agent screen is
          for customers only — no login there.
        </p>
        <p className="demo-pill">Demo mode — not live core banking</p>
        {apiOnline === false && (
          <p className="api-warning">API offline — start uvicorn on port 8001.</p>
        )}
      </div>

      <div className="portal-cards portal-cards-two">
        <button type="button" className="portal-card portal-card-admin" onClick={onOpenAdmin}>
          <span className="portal-card-kicker">Staff only</span>
          <h2>Admin desk</h2>
          <p>Login required. Open or close the customer lobby from here.</p>
        </button>

        <button type="button" className="portal-card portal-card-agent" onClick={onOpenAgent}>
          <span className="portal-card-kicker">Customer lobby</span>
          <h2>Agent screen</h2>
          <p>No admin login. Opens when staff starts the lobby, then greets the customer.</p>
        </button>
      </div>

      <button type="button" className="portal-desk-link" onClick={onOpenDesk}>
        Desk workbench (dev testing) →
      </button>
    </div>
  );
}
