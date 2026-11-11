import { useState } from "react";
import { emailLogin, emailRegister, emailMagic } from "../../api";
import { useAuth } from "../../contexts/AuthContext";

const EmailLoginForm = ({ onDone }) => {
  const { refresh, magicLogin } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitMagic = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await emailMagic(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await emailRegister(email, password, name);
      } else {
        await emailLogin(email, password);
      }
      await refresh().catch(() => {});
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Magic-link login: email only, a sign-in link is mailed
  if (magicLogin) {
    return sent ? (
      <p className="email-sent">
        Login link sent to {email} - check your inbox
      </p>
    ) : (
      <form className="email-form" onSubmit={submitMagic}>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        {error && <div className="email-error">{error}</div>}
        <button type="submit" className="email-submit" disabled={busy}>
          {busy ? "…" : "Email me a login link"}
        </button>
      </form>
    );
  }

  return (
    <form className="email-form" onSubmit={submitPassword}>
      {mode === "register" && (
        <input
          type="text"
          placeholder="name (optional)"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      )}
      <input
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <input
        type="password"
        placeholder="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete={mode === "register" ? "new-password" : "current-password"}
      />
      {error && <div className="email-error">{error}</div>}
      <button type="submit" className="email-submit" disabled={busy}>
        {busy
          ? "…"
          : mode === "register"
            ? "Create account"
            : "Login with email"}
      </button>
      <button
        type="button"
        className="email-switch"
        onClick={() => {
          setMode((m) => (m === "login" ? "register" : "login"));
          setError(null);
        }}
      >
        {mode === "login" ? "create an account" : "already registered? login"}
      </button>
    </form>
  );
};

export default EmailLoginForm;
