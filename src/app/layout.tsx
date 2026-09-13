import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { APP_NAME } from "@/lib/version";
import Nav from "@/components/Nav";
import PageBackground from "@/components/PageBackground";
import ThemeToggle from "@/components/ThemeToggle";
import { GoogleAnalytics } from "@next/third-parties/google";
import WeatherPreview from "@/components/WeatherPreview";
import { AuthOverlayProvider } from "@/components/AuthOverlayContext";
import AuthOverlay from "@/components/AuthOverlay";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesContext";
import { getCampusWeather } from "@/lib/weather";
import { MODES, DEFAULT_MODE } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Wordmark only - see .nav-logo in globals.css. Inter still sets everything else.
// Stands in for Halyard Display (commercial, not redistributable); Outfit is the
// closest geometric sans available to us.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["700"],
});

const DESCRIPTION = "Find courses and professors at UBC.";

// Same env var the verification and reset emails are built from (see
// src/app/actions/auth.ts) - one answer to "where does this site live",
// rather than a second constant to keep in sync. metadataBase is what lets
// the generated OG image below be referenced by relative path.
const SITE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    url: SITE_URL,
    title: APP_NAME,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: DESCRIPTION,
  },
};

// Runs before paint so the stored theme applies immediately - without this,
// a dark-mode visitor would flash white on every load until React hydrates.
// Weather mode guesses daylight from the clock here; ThemeToggle re-applies
// with the real campus observation after hydration.
//
// localStorage only - reading the signed-in user's saved mode here would
// need auth(), which forces every page in the site dynamic. ThemeToggle
// fetches the account's choice after hydration and reconciles it into
// localStorage, so across devices the two still converge; the cost is a
// brief flash of the local theme for the rare signed-in visitor whose
// localStorage disagrees with their account.
function themeInit() {
  return `
(function () {
  try {
    var modes = ${JSON.stringify(MODES)};
    var stored = localStorage.getItem('theme');
    var mode = modes.indexOf(stored) >= 0 ? stored : ${JSON.stringify(DEFAULT_MODE)};
    var theme = mode === 'day' || mode === 'light' ? 'light' : 'dark';
    if (mode === 'weather') {
      // Campus time, not the viewer's, and replaced a moment later by
      // ThemeToggle with the real observation, which knows the true sunset.
      var h = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Vancouver', hour: 'numeric', hour12: false,
      }).format(new Date()));
      theme = h >= 7 && h < 20 ? 'light' : 'dark';
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
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const weather = await getCampusWeather();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${outfit.variable} h-full antialiased`}
      // The inline script below sets data-theme before React hydrates, so
      // the server-rendered markup (which has none) will always "mismatch"
      // this one attribute - intentional, and nothing in the tree reads
      // data-theme for rendering logic, only CSS attribute selectors do.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit() }} />
      </head>
      {/* dvh, not vh: mobile browsers measure 100vh with the URL bar
          retracted, which pinned the builder's bottom row under the toolbar. */}
      <body className="flex h-dvh flex-col">
        <AuthOverlayProvider>
          <UnsavedChangesProvider>
            <PageBackground nav={<Nav />}>{children}</PageBackground>
            <ThemeToggle weather={weather} />
            <WeatherPreview />
            <AuthOverlay />
          </UnsavedChangesProvider>
        </AuthOverlayProvider>
        {/*
          Gated on the env var rather than on NODE_ENV: analytics is simply
          absent anywhere the ID is not set, which keeps local development and
          preview deployments out of the numbers without a second condition to
          keep in sync. Rendering nothing also means no Google script and no
          _ga cookie on those builds, so the privacy page stays true of them.
        */}
        {gaId && <GoogleAnalytics gaId={gaId} />}
      </body>
    </html>
  );
}
