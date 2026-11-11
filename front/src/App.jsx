import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Mission from "./pages/Mission";
import Contact from "./pages/Contact";
import Projects from "./pages/Projects";
import Navbar from "./pages/components/Navbar";
import Loader from "./pages/components/Loader";
import Background from "./pages/components/Background";
import Footer from "./pages/components/Footer";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import Drakarys from "./pages/projects/Drakarys";
import DrakarysMatch from "./pages/projects/DrakarysMatch";
import DrakarysGame0 from "./pages/projects/DrakarysGame0";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";

import "./style/App.css";

const HeadUpdater = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    const isDrakarys = pathname.startsWith("/projects/drakarys");
    document.title = isDrakarys
      ? "[XFokus.AI] Drakarys: AI Competition Platform"
      : "XFokus.AI: Innovation";
    const icon = document.querySelector("link[rel~='icon']");
    if (icon) icon.href = isDrakarys ? "/favicon-fire.svg" : "/favicon.svg";
  }, [pathname]);
  return null;
};

const App = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <div className="app">
            <HeadUpdater />
            <Loader />
            <Navbar />
            <Background />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/mission" element={<Mission />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/drakarys" element={<Drakarys />} />
              <Route
                path="/projects/drakarys/game-0"
                element={<DrakarysGame0 />}
              />
              <Route
                path="/projects/drakarys/:chain/:matchId"
                element={<DrakarysMatch />}
              />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/login" element={<Login />} />
            </Routes>
            <Footer />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
