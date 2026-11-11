import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../../contexts/ThemeContext";
import { useAuth } from "../../contexts/AuthContext";

const Navbar = () => {
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const { user, xLogin, emailLogin, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="content">
        <div className="logo">
          <span className="logo-tick" aria-hidden="true" />
          <Link
            className={`${location.pathname === "/" ? "selected" : ""}`}
            to="/"
          >
            X
          </Link>
        </div>
        <div className="links">
          <Link
            className={`${location.pathname === "/mission" ? "selected" : ""}`}
            to="/mission"
          >
            Mission
          </Link>
          <Link
            className={`${location.pathname === "/projects" ? "selected" : ""}`}
            to="/projects"
          >
            Projects
          </Link>{" "}
          <Link
            className={`${location.pathname === "/contact" ? "selected" : ""}`}
            to="/contact"
          >
            Contact
          </Link>
          {user ? (
            <>
              <Link to="/dashboard" className="auth-user">
                {user.avatar && (
                  <img src={user.avatar} alt="" className="auth-avatar" />
                )}
                @{user.handle}
              </Link>
              <button
                className="auth-btn"
                onClick={logout}
                aria-label="Logout"
                title="Logout"
              >
                <svg
                  className="auth-power"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v9" />
                  <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
                </svg>
              </button>
            </>
          ) : (
            (xLogin || emailLogin) && (
              <Link className="auth-login" to="/login">
                Login
              </Link>
            )
          )}
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {isDark ? "☀️" : "🌙"}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
