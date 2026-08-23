import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { APP_NAME } from "@/lib/version";
import Nav from "@/components/Nav";
import ThemeToggle from "@/components/ThemeToggle";
import { AuthOverlayProvider } from "@/components/AuthOverlayContext";
import AuthOverlay from "@/components/AuthOverlay";
import { UnsavedChangesProvider } from "@/components/UnsavedChangesContext";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Find courses and professors at UBC.",
};

// Runs before paint so the stored theme applies immediately — without this,
// a dark-mode visitor would flash white on every load until React hydrates.
const THEME_INIT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
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
            <Nav />
            {children}
            <ThemeToggle />
            <AuthOverlay />
          </UnsavedChangesProvider>
        </AuthOverlayProvider>
      </body>
    </html>
  );
}
