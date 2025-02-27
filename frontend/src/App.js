import { BrowserRouter as Router, Routes, Route, NavLink } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import Debug from "./pages/Debug";
import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";

function App() {
  return (
    <Router>
      <div className="container text-center">
        <nav className="navbar navbar-expand-lg">
          <NavLink className="navbar-brand" to="/">WatVision</NavLink>
          <button className="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
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
                <NavLink className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} to="/debug">Debug</NavLink>
              </li>
            </ul>
          </div>
        </nav>

        <main className="mt-4">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/debug" element={<Debug />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
