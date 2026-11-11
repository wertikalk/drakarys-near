import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { fetchUsers, xLoginUrl } from "../api";
import EmailLoginForm from "./components/EmailLoginForm";

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const EyeIcon = ({ off }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <line x1="4" y1="20" x2="20" y2="4" />}
  </svg>
);

const CopyIcon = ({ copied }) =>
  copied ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12.5 9.5 18 20 6" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );

const KeyField = ({ value, shown, copied, onToggle, onCopy }) => (
  <span className="key-cell">
    <span className={`key-val${shown ? "" : " masked"}`}>
      {shown ? value : "•".repeat(48)}
    </span>
    <span className="key-actions">
      <button
        className="key-btn"
        onClick={onToggle}
        aria-label={shown ? "Hide API key" : "Show API key"}
        title={shown ? "Hide" : "Show"}
      >
        <EyeIcon off={shown} />
      </button>
      <button
        className="key-btn"
        onClick={onCopy}
        aria-label="Copy API key"
        title={copied ? "Copied" : "Copy"}
      >
        <CopyIcon copied={copied} />
      </button>
    </span>
  </span>
);

const Dashboard = () => {
  const { user, xLogin, emailLogin, ready } = useAuth();
  const [users, setUsers] = useState(null);
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState({});

  const copyKey = (id, value) => {
    navigator.clipboard.writeText(value);
    setCopied((c) => ({ ...c, [id]: true }));
    setTimeout(() => setCopied((c) => ({ ...c, [id]: false })), 1200);
  };

  useEffect(() => {
    if (user?.isAdmin) {
      fetchUsers()
        .then((d) => setUsers(d.users))
        .catch(() => setUsers([]));
    }
  }, [user]);

  if (!ready) return <div className="dashboard" />;

  if (!user) {
    return (
      <div className="dashboard">
        <p className="dash-msg">Log in to view the dashboard</p>
        {xLogin && (
          <a className="gate-login" href={xLoginUrl}>
            <svg className="gate-x" viewBox="0 0 19 19" aria-hidden="true">
              <use href="/icons.svg#x-icon" />
            </svg>
            Login with X
          </a>
        )}
        {xLogin && emailLogin && <span className="gate-or">or</span>}
        {emailLogin && <EmailLoginForm />}
      </div>
    );
  }

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      <div className="acct">
        <div className="acct-user">
          {user.avatar && <img src={user.avatar} alt={user.handle} />}
          <span>@{user.handle}</span>
        </div>
        <div className="acct-row">
          <span className="lbl">First login</span>
          <span>{fmt(user.firstLoginAt)}</span>
          <span className="lbl">Last login</span>
          <span>{fmt(user.lastLoginAt)}</span>
        </div>
        <div className="acct-row">
          <span className="lbl">API key</span>
          <KeyField
            value={user.apiKey}
            shown={revealed.me}
            copied={copied.me}
            onToggle={() => setRevealed((r) => ({ ...r, me: !r.me }))}
            onCopy={() => copyKey("me", user.apiKey)}
          />
        </div>
      </div>

      {user.isAdmin && (
        <>
          <h1>Users</h1>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>ID</th>
                  <th className="key-col">API key</th>
                  <th>Admin</th>
                  <th>First login</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr key={u.xId}>
                    <td>
                      <div className="user-cell">
                        {u.avatar && (
                          <img className="av" src={u.avatar} alt="" />
                        )}
                        <span className="handle">@{u.handle}</span>
                        {u.name && u.name !== u.handle && (
                          <span className="uname">{u.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="xid">{u.email || u.xId}</td>
                    <td className="key-col">
                      <KeyField
                        value={u.apiKey}
                        shown={revealed[u.xId]}
                        copied={copied[u.xId]}
                        onToggle={() =>
                          setRevealed((r) => ({ ...r, [u.xId]: !r[u.xId] }))
                        }
                        onCopy={() => copyKey(u.xId, u.apiKey)}
                      />
                    </td>
                    <td>{u.isAdmin ? "yes" : ""}</td>
                    <td>{fmt(u.firstLoginAt)}</td>
                    <td>{fmt(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users && users.length === 0 && (
            <p className="dash-msg">No users yet</p>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
