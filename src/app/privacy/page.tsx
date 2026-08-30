import type { Metadata } from 'next';
import { CONTACT_EMAIL } from '@/lib/version';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="sky-hero text-4xl font-semibold">Privacy</h1>

      <div className="sky-panel mt-12 space-y-16 p-6 sm:p-12 lg:p-16">
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What we collect</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            If you make an account, we store your email address and either a hash of your password
            or your name and email as given to us by Google, depending on how you signed up. We
            never store the password itself, and if you sign in with Google we don&apos;t get
            anything else from your Google account.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            If you upload your Workday export to verify you&apos;re a UBC student, we store a hash
            of your student number, never the number itself, along with the courses, terms, and
            meeting times you&apos;re enrolled in. If the export includes final grades, we store
            those too, exactly as Workday reported them; they appear on your Account page and are
            never shown to anyone else. This is what powers your Account page and lets you
            subscribe your real schedule to an outside calendar app.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            We also store what you create on the site: your reviews, your saved schedules, and
            which reviews you&apos;ve marked helpful.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            Separately from any account, every visit is counted by Google Analytics: the page you
            landed on, the site that sent you, your browser and device, and roughly where you are.
            The location is worked out from your IP address, which Google discards rather than
            storing. This happens whether or not you are signed in, and it is not connected to your
            account.

            Everything above is kept until you delete your account, which removes all of it.
            Deleting your account does not reach the analytics counts, since nothing there
            identifies you in the first place. The site runs on servers in the United States, and
            Google processes analytics data on its own.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What it&apos;s used for</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Running the site: signing you in, confirming you&apos;re a UBC student, showing you
            your schedules and enrolled courses, letting you manage your own reviews, and syncing a
            schedule to your calendar app if you ask for one. Beyond that, only counting how the
            site is used, so we know which parts are worth building on.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What we don&apos;t do</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            We don&apos;t sell your data and we don&apos;t run ads. We use Google Analytics to
            see how many people use the site and which pages they reach. It doesn&apos;t know who
            you are — it never receives your name, email or student number — and we don&apos;t use
            it for advertising or share anything with it about your account.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Review anonymity</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Reviews are shown to other students without your name. They are stored with your
            account so you can edit or delete them later.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Calendar and share links</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Subscribing a schedule to an outside calendar app generates a private link for it.
            Anyone with that link can see the schedule it points to without signing in, the same
            way any calendar subscription link works. Don&apos;t share it if you don&apos;t want
            someone else seeing your schedule.

            Sharing a schedule creates a second, separate link that shows it as a page anyone can
            open without signing in. It shows the courses, times and rooms, and nothing about you
            — not your name, not your email. You can stop sharing at any time, which kills that
            link for good; it doesn&apos;t affect a calendar subscription, and a subscription
            doesn&apos;t create a share link. Neither exists until you ask for it.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Cookies and local storage</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            One cookie keeps you signed in. Google Analytics sets its own, which hold a random
            ID so it can tell a repeat visit from a new one; they carry nothing about you or your
            account. If you&apos;re signed in, your theme choice
            is saved to your account too, so it follows you between devices. If you&apos;re signed
            out, it&apos;s kept in your browser&apos;s local storage and stays on that device.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Deleting your data</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            You can delete your own reviews and schedules from the site at any time. You can also
            delete your account entirely from the Account page. That removes your reviews, your
            saved schedules, your enrollment records, and your verification status, all at once,
            immediately, and it can&apos;t be undone.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Questions</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            For anything about your data, including seeing what we hold about you or asking for a
            correction, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand-accent hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
