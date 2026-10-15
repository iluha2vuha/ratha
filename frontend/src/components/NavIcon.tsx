export type NavIconName = "menu" | "map" | "route" | "community" | "profile" | "settings" | "close" | "logout";

export function NavIcon({ name }: { name: NavIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "menu" && <path d="M4 6h16M4 12h16M4 18h16" />}
    {name === "map" && <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></>}
    {name === "route" && <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M6 9v4a3 3 0 0 0 3 3h6M18 15V9a3 3 0 0 0-3-3h-3" /></>}
    {name === "community" && <><path d="M21 11a7 7 0 0 1-7 7H8l-5 3 1.5-5A7 7 0 0 1 3 11a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7Z" /><path d="M8 10h8M8 14h5" /></>}
    {name === "profile" && <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2Z" /></>}
    {name === "settings" && <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="var(--control)" /><circle cx="15" cy="17" r="2" fill="var(--control)" /></>}
    {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    {name === "logout" && <><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" /></>}
  </svg>;
}
