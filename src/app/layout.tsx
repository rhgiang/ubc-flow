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
const THEME_INIT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var mode = ['light', 'dark', 'weather', 'contrast', 'contrast-dark'].indexOf(stored) >= 0
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var theme = mode;
    if (mode === 'weather') {
      var h = new Date().getHours();
      theme = h >= 7 && h < 19 ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const weather = await getCampusWeather();
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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
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
