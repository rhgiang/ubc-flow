import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="sky-hero text-4xl font-semibold">Privacy</h1>

      <div className="sky-panel mt-12 space-y-16 p-12 sm:p-16">
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
            meeting times you&apos;re enrolled in. This is what powers your Account page and lets
            you subscribe your real schedule to an outside calendar app.
          </p>
          <p className="text-base leading-relaxed text-text-secondary">
            We also store what you create on the site: your reviews, your saved schedules, and
            which reviews you&apos;ve marked helpful.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What it&apos;s used for</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Running the site: signing you in, confirming you&apos;re a UBC student, showing you
            your schedules and enrolled courses, letting you manage your own reviews, and syncing a
            schedule to your calendar app if you ask for one. That&apos;s it.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">What we don&apos;t do</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            We don&apos;t sell your data, we don&apos;t run ads, and we don&apos;t use third-party
            analytics or tracking scripts.
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
          <h2 className="text-2xl font-semibold text-foreground">Calendar links</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            Subscribing a schedule to an outside calendar app generates a private link for it.
            Anyone with that link can see the schedule it points to without signing in, the same
            way any calendar subscription link works. Don&apos;t share it if you don&apos;t want
            someone else seeing your schedule.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Cookies and local storage</h2>
          <p className="text-base leading-relaxed text-text-secondary">
            The only cookie we set keeps you signed in. If you&apos;re signed in, your theme choice
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
      </div>
    </main>
  );
}
