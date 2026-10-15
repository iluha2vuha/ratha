import { Link } from "react-router-dom";
import { communityPosts } from "../sampleData";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CommunityPage() {
  return (
    <div className="page page-feed">
      <p className="eyebrow">Community</p>
      <h1>From the trail</h1>
      <p className="quiet page-lead">Sample community route shares. Open a route in the planner to generate an interactive route and itinerary.</p>
      <ul className="feed">
        {communityPosts.filter((post) => post.route).map((post) => (
          <li key={post.id} className="post">
            <p className="post-meta">
              <span className="avatar small" aria-hidden="true">
                {initials(post.author)}
              </span>
              {post.authorId ? <Link className="text-link" to={`/community/users/${post.authorId}`}><strong>{post.author}</strong></Link> : <strong>{post.author}</strong>}
              <span>{post.when}</span>
            </p>
            <h2>{post.title}</h2>
            <p className="quiet">{post.body}</p>
            <ul className="tags">
              {post.tags.map((tag) => (
                <li key={tag} className="tag">
                  {tag}
                </li>
              ))}
            </ul>
            {post.route ? (
              <div className="community-route-link">
                <span className="quiet">{post.route.start} → {post.route.finish} · {post.route.days} {post.route.days === 1 ? "day" : "days"}</span>
                <Link
                  className="button secondary"
                  to="/plan"
                  state={{ start: post.route.start, finish: post.route.finish, days: post.route.days }}
                >
                  Open interactive planner
                </Link>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
