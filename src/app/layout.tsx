import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { APP_NAME } from "@/lib/version";
import Nav from "@/components/Nav";
import PageBackground from "@/components/PageBackground";
import ThemeToggle from "@/components/ThemeToggle";
import WeatherPreview from "@/components/WeatherPreview";
import { AuthOverlayProvider } from "@/components/AuthOverlayContext";
import AuthOverlay from "@/components/AuthOverlay";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesContext";
import { getCampusWeather } from "@/lib/weather";
import { getSavedThemeMode } from "@/lib/saved-theme";
import { MODES, DEFAULT_MODE, type Mode } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Wordmark only — see .nav-logo in globals.css. Inter still sets everything else.
// Stands in for Halyard Display (commercial, not redistributable); Outfit is the
// closest geometric sans available to us.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Find courses and professors at UBC.",
};

// Runs before paint so the stored theme applies immediately — without this,
// a dark-mode visitor would flash white on every load until React hydrates.
// Weather mode guesses daylight from the clock here; ThemeToggle re-applies
// with the real campus observation after hydration.
//
// `seed` is the signed-in user's saved mode, or null. When present it wins
// over localStorage and is written back to it: the account is the source of
// truth across devices, and every deliberate change writes to both, so the
// two converge rather than fighting. A signed-out visitor, or one who has
// never chosen, falls through to localStorage and then to campus weather.
function themeInit(seed: Mode | null) {
  return `
(function () {
  try {
    var seed = ${JSON.stringify(seed)};
    var modes = ${JSON.stringify(MODES)};
    var stored = localStorage.getItem('theme');
    var mode = seed || (modes.indexOf(stored) >= 0 ? stored : ${JSON.stringify(DEFAULT_MODE)});
    if (seed && seed !== stored) localStorage.setItem('theme', seed);
    var theme = mode === 'day' || mode === 'light' ? 'light' : 'dark';
    if (mode === 'weather') {
      var h = new Date().getHours();
      theme = h >= 7 && h < 19 ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-theme', theme);
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-plain', '');
    }
  } catch (e) {}
})();
`;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [weather, savedMode] = await Promise.all([getCampusWeather(), getSavedThemeMode()]);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} h-full antialiased`}
      // The inline script below sets data-theme before React hydrates, so
      // the server-rendered markup (which has none) will always "mismatch"
      // this one attribute — intentional, and nothing in the tree reads
      // data-theme for rendering logic, only CSS attribute selectors do.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit(savedMode) }} />
      </head>
      <body className="flex h-screen flex-col">
        <AuthOverlayProvider>
          <UnsavedChangesProvider>
            <PageBackground nav={<Nav />}>{children}</PageBackground>
            <ThemeToggle weather={weather} />
            <WeatherPreview />
            <AuthOverlay />
          </UnsavedChangesProvider>
        </AuthOverlayProvider>
      </body>
    </html>
  );
}
