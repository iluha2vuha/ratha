import { Link, useParams } from "react-router-dom";
import { communityPosts, communityUsers } from "../sampleData";

export function CommunityUserPage() {
  const { id = "" } = useParams();
  const user = communityUsers.find((item) => item.id === id);
  const routes = communityPosts.filter((post) => post.authorId === id && post.route);

  if (!user) {
    return (
      <div className="page">
        <Link className="back-link" to="/community">Back to community</Link>
        <h1>Profile not found</h1>
        <p className="quiet">This community profile is unavailable.</p>
      </div>
    );
  }

  return (
    <div className="page community-user-page">
      <Link className="back-link" to="/community">Back to community</Link>
      <header className="profile-head">
        <div className="avatar" aria-hidden="true">{user.initials}</div>
        <div>
          <p className="eyebrow">Community member · sample profile</p>
          <h1>{user.name}</h1>
          <p className="quiet">{user.note}</p>
        </div>
      </header>
      <section aria-labelledby="shared-routes-heading">
        <h2 id="shared-routes-heading">Routes shared</h2>
        <p className="quiet">Sample community route shares. Open a route in the planner to generate an interactive route and itinerary.</p>
        {routes.length ? (
          <ul className="feed">
            {routes.map((post) => (
              <li key={post.id} className="post">
                <p className="post-meta"><span>{post.when}</span></p>
                <h3>{post.route!.name}</h3>
                <p className="quiet">{post.body}</p>
                <p>{post.route!.start} → {post.route!.finish} · {post.route!.days} {post.route!.days === 1 ? "day" : "days"}</p>
                <Link className="button secondary" to="/plan" state={{ start: post.route!.start, finish: post.route!.finish, days: post.route!.days }}>
                  Open interactive planner
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="quiet">No shared routes yet.</p>}
      </section>
    </div>
  );
}
