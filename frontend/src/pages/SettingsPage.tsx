import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { defaultSettings, getSettings, updateSettings, type Settings } from "../api";
import { useTheme } from "../theme";
import { useAuth } from "../auth";

type SaveState = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [form, setForm] = useState<Settings>(defaultSettings);
  const [loadedFromApi, setLoadedFromApi] = useState<boolean | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let active = true;
    getSettings()
      .then((settings) => {
        if (!active) return;
        setForm({ ...settings, display_name: settings.display_name || user?.display_name || "" });
        setLoadedFromApi(true);
      })
      .catch(() => {
        if (active) setLoadedFromApi(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("saving");
    try {
      const saved = await updateSettings(form);
      setForm(saved);
      setLoadedFromApi(true);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="page page-narrow">
      <Link className="back-link" to="/profile">
        Back to profile
      </Link>
      <p className="eyebrow">Settings</p>
      <h1>Your preferences</h1>
      <p className="quiet page-lead">
        {loadedFromApi === null
          ? "Loading your preferences…"
          : loadedFromApi
            ? "Preferences for your next trip. Saved for this session."
            : "Your saved preferences could not be loaded. Default preferences are shown."}
      </p>

      <form onSubmit={onSubmit}>
        <fieldset className="card">
          <legend>Appearance</legend>
          <div className="pace theme-choice" role="group" aria-label="Appearance">
            <button
              type="button"
              className={theme === "light" ? "is-selected" : ""}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              className={theme === "dark" ? "is-selected" : ""}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>Profile</legend>
          <label className="field">
            Display name
            <input
              value={form.display_name}
              placeholder="Add your name"
              onChange={(event) => update("display_name", event.target.value)}
            />
          </label>
          <label className="field">
            Home area
            <input placeholder="Add your home area" value={form.home_area} onChange={(event) => update("home_area", event.target.value)} />
          </label>
          <label className="field">
            Who can see your profile
            <select
              value={form.profile_visibility}
              onChange={(event) =>
                update("profile_visibility", event.target.value as Settings["profile_visibility"])
              }
            >
              <option value="public">Anyone</option>
              <option value="friends">Friends</option>
              <option value="private">Only you</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="card">
          <legend>Units and map</legend>
          <label className="field">
            Distance
            <select
              value={form.distance_unit}
              onChange={(event) => update("distance_unit", event.target.value as Settings["distance_unit"])}
            >
              <option value="km">Kilometres</option>
              <option value="mi">Miles</option>
            </select>
          </label>
          <label className="field">
            Elevation
            <select
              value={form.elevation_unit}
              onChange={(event) => update("elevation_unit", event.target.value as Settings["elevation_unit"])}
            >
              <option value="m">Metres</option>
              <option value="ft">Feet</option>
            </select>
          </label>
          <label className="field">
            Map style
            <select
              value={form.map_style}
              onChange={(event) => update("map_style", event.target.value as Settings["map_style"])}
            >
              <option value="terrain">Terrain</option>
              <option value="paper">Paper</option>
              <option value="satellite">Satellite</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="card">
          <legend>Notifications</legend>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.trip_reminders}
              onChange={(event) => update("trip_reminders", event.target.checked)}
            />
            Trip reminders
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.friend_activity}
              onChange={(event) => update("friend_activity", event.target.checked)}
            />
            Friend activity
          </label>
        </fieldset>

        <div className="actions">
          <button className="button" type="submit" disabled={saveState === "saving"}>
            {saveState === "saving" ? "Saving…" : "Save settings"}
          </button>
          {saveState === "saved" ? <p className="form-status">Saved for this server session.</p> : null}
          {saveState === "error" ? (
            <p className="form-status error">The API did not accept the save. Is the backend running?</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
