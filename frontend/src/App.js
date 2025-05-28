import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import Debug from "./pages/Debug";
import DebugVideo from "./pages/DebugVideo";
import DebugCamera from "./pages/DebugCamera";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";

function App() {
  return (
    <Router>
      <div className="container text-center">
        <nav className="navbar navbar-expand-lg">
          <NavLink className="navbar-brand" to="/">WatVision</NavLink>
          <button 
            className="navbar-toggler" 
            type="button" 
            data-bs-toggle="collapse" 
            data-bs-target="#navbarNav" 
            aria-controls="navbarNav" 
            aria-expanded="false" 
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className="collapse navbar-collapse" id="navbarNav">
            <ul className="navbar-nav">
              <li className="nav-item">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/">Home</NavLink>
              </li>
              <li className="nav-item">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/about">About</NavLink>
              </li>
              <li className="nav-item">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/debug">Debug Image</NavLink>
              </li>
              <li className="nav-item">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/debug-video">Debug Video</NavLink>
              </li>
              <li className="nav-item">
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/debug-camera">Debug Camera</NavLink>
              </li>
            </ul>
          </div>
        </nav>

        <main className="mt-4">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/debug" element={<Debug />} />
            <Route path="/debug-video" element={<DebugVideo />} />
            <Route path="/debug-camera" element={<DebugCamera />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
