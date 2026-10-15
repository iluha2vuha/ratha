import { Link } from "react-router-dom";
import { badges, friends, previousRoutes, stats } from "../sampleData";
import { useAuth } from "../auth";

export function ProfilePage() {
  const { user } = useAuth();
  return (
    <div className="page">
      <header className="profile-head">
        <div className="avatar" aria-hidden="true">
          {user?.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "GW"}
        </div>
        <div>
          <p className="eyebrow">{user ? "Walker" : "Guest walker"}</p>
          <h1>{user?.display_name ?? "Your profile"}</h1>
          <p className="quiet">{user?.email ?? "Sign in to connect this profile to your account."}</p>
        </div>
        {user ? <Link className="button secondary" to="/settings">Settings</Link> : <Link className="button secondary" to="/auth">Sign in</Link>}
      </header>

      <p className="quiet page-lead">Sample activity, badges, routes and friends are shown below.</p>

      <section className="block" aria-label="Stats">
        <ul className="stat-row">
          {stats.map((stat) => (
            <li key={stat.label} className="stat">
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="block">
        <h2>Badges</h2>
        <ul className="badges">
          {badges.map((badge) => (
            <li key={badge.name} className="badge">
              <div className="medallion" aria-hidden="true">
                {badge.mark}
              </div>
              <strong>{badge.name}</strong>
              <span>{badge.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="split">
        <section>
          <h2>Previous routes</h2>
          <ul className="stack">
            {previousRoutes.map((route) => (
              <li key={route.name} className="route-item">
                <div>
                  <strong>{route.name}</strong>
                  <p className="quiet">
                    {route.start} to {route.finish}
                  </p>
                  <p className="quiet">{route.detail}</p>
                </div>
                <Link
                  className="text-link"
                  to="/plan"
                  state={{ start: route.start, finish: route.finish, days: route.days }}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Friends</h2>
          <ul className="stack">
            {friends.map((friend) => (
              <li key={friend.name} className="friend">
                <span className="avatar small">{friend.initials}</span>
                <span>
                  <strong>{friend.name}</strong>
                  <p className="quiet">{friend.note}</p>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

    </div>
  );
}
