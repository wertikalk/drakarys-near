import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { xLoginUrl } from "../api";
import EmailLoginForm from "./components/EmailLoginForm";

const Login = () => {
  const { user, xLogin, emailLogin, ready } = useAuth();

  if (user) return <Navigate to="/dashboard" replace />;
  if (!ready) return <div className="login-page" />;

  return (
    <div className="login-page">
      <p className="gate-msg">Log in</p>
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
};

export default Login;
