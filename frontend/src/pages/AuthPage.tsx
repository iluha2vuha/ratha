import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function AuthPage() {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const [isRegistering, setIsRegistering] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/profile" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isRegistering) await register({ display_name: displayName.trim(), email, password });
      else await login({ email, password });
      navigate("/profile", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign you in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">Your Highland adventures</p>
        <h1>{isRegistering ? "Create your account" : "Welcome back"}</h1>
        <p className="quiet">{isRegistering ? "Plan your trips and access your profile." : "Sign in to continue planning."}</p>
        <form onSubmit={submit}>
          {isRegistering && (
            <label className="field">
              Name
              <input autoComplete="name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
          )}
          <label className="field">
            Email
            <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            Password
            <input type="password" autoComplete={isRegistering ? "new-password" : "current-password"} required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
            {isRegistering && <span className="quiet auth-hint">Use at least 8 characters.</span>}
          </label>
          {error && <p className="route-error" role="alert">{error}</p>}
          <button className="button" type="submit" disabled={submitting || loading}>
            {submitting ? "Please wait…" : isRegistering ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">
          {isRegistering ? "Already have an account?" : "New to Ratha?"}{" "}
          <button className="text-link auth-switch-button" type="button" onClick={() => { setIsRegistering((value) => !value); setError(""); }}>
            {isRegistering ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </section>
  );
}
