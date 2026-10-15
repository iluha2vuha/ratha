import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { AuthPage } from "./pages/AuthPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SavedRoutePage } from "./pages/SavedRoutePage";
import { Layout } from "./components/Layout";
import { CommunityPage } from "./pages/CommunityPage";
import { CommunityUserPage } from "./pages/CommunityUserPage";
import { MapPage } from "./pages/MapPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RoutePlannerPage } from "./pages/RoutePlannerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemeProvider } from "./theme";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<MapPage />} />
              <Route path="/plan" element={<RoutePlannerPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/:id" element={<SavedRoutePage />} />
              <Route path="/community" element={<CommunityPage />} />
              <Route path="/community/users/:id" element={<CommunityUserPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/auth" element={<AuthPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
