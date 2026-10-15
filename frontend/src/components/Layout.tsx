import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { NavIcon, type NavIconName } from "./NavIcon";

function Brand() {
  return <NavLink to="/" className="brand" end>
    <img className="brand-logo" src="/ratha-logo.png" alt="Ratha" />
    <span className="brand-name">RATHA</span>
  </NavLink>;
}

export function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const menuRef = useRef<HTMLDialogElement>(null);
  const links: { to: string; label: string; icon: NavIconName }[] = [
    { to: "/", label: "Explore", icon: "map" },
    { to: "/plan", label: "Plan a trip", icon: "route" },
    { to: "/community", label: "Community", icon: "community" },
    { to: user ? "/profile" : "/auth", label: user ? "Profile" : "Sign in", icon: "profile" },
  ];

  useEffect(() => {
    window.scrollTo(0, 0);
    menuRef.current?.close();
  }, [location.pathname]);

  return (
    <div className={`app-shell ${location.pathname === "/" ? "map-shell" : "content-shell"}`}>
      <main className="main"><Outlet /></main>
      <nav className="nav" aria-label="Primary">
        <button className="nav-link menu-trigger" type="button" onClick={() => menuRef.current?.showModal()} aria-haspopup="dialog" aria-label="Open menu">
          <NavIcon name="menu" /><span>Menu</span>
        </button>
        {links.map(link => <NavLink key={link.to} to={link.to} end={link.to === "/"}
          className={({ isActive }) => `nav-link ${link.to === "/plan" ? "nav-plan" : ""} ${isActive ? "active" : ""}`}>
          <NavIcon name={link.icon} /><span>{link.label}</span>
        </NavLink>)}
      </nav>
      <dialog className="menu-drawer" ref={menuRef} aria-label="Menu" onClick={event => { if (event.target === event.currentTarget) menuRef.current?.close(); }}>
        <div className="menu-content">
          <Brand />
          <nav className="menu-links" aria-label="Menu">
            {links.map(link => <NavLink key={link.to} to={link.to} end={link.to === "/"} onClick={() => menuRef.current?.close()}>
              <NavIcon name={link.icon} /><span>{link.label}</span>
            </NavLink>)}
            <NavLink to="/library" onClick={() => menuRef.current?.close()}><NavIcon name="map" /><span>Library</span></NavLink>
            <NavLink to="/settings" onClick={() => menuRef.current?.close()}><NavIcon name="settings" /><span>Settings</span></NavLink>
            {user && <button type="button" onClick={() => { menuRef.current?.close(); void logout(); }}><NavIcon name="logout" /><span>Log out</span></button>}
          </nav>
          <button className="menu-close" type="button" aria-label="Close menu" onClick={() => menuRef.current?.close()}><NavIcon name="close" /></button>
        </div>
      </dialog>
    </div>
  );
}
