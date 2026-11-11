import React, { createContext, useContext, useState, useEffect } from "react";
import { fetchMe, logout as apiLogout } from "../api";

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [xLogin, setXLogin] = useState(false);
  const [emailLoginEnabled, setEmailLoginEnabled] = useState(false);
  const [magicLoginEnabled, setMagicLoginEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = () =>
    fetchMe().then((d) => {
      setUser(d.user);
      setXLogin(!!d.xLogin);
      setEmailLoginEnabled(!!d.emailLogin);
      setMagicLoginEnabled(!!d.magicLogin);
    });

  useEffect(() => {
    let on = true;
    refresh()
      .catch(() => {})
      .finally(() => on && setReady(true));
    return () => {
      on = false;
    };
  }, []);

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        xLogin,
        emailLogin: emailLoginEnabled,
        magicLogin: magicLoginEnabled,
        ready,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
