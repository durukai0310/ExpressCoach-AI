import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import { useBehavior } from '../hooks/useBehavior';

export default function Layout() {
  useBehavior();

  return (
    <div className="app-layout">
      <Navbar />
      <main className="app-content">
        <Outlet />
      </main>
      <footer className="app-footer">
        ExpressCoach © 2026 — AI Life Coach for Everyone
      </footer>
    </div>
  );
}
