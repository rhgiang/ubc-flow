import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy · UBC Flow' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="sky-hero text-3xl font-semibold">Privacy</h1>

      <div className="sky-panel mt-8 space-y-8 p-8">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">What we collect</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            If you make an account, we store your email address and either a hash of your password
            (we never store the password itself) or your Google account id if you sign in with
            Google. We also store what you create on the site: your reviews and your saved
            schedules.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">What it&apos;s used for</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Running the site — signing you in, showing you your schedules, and letting you manage
            your own reviews. That&apos;s it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">What we don&apos;t do</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            We don&apos;t sell your data, we don&apos;t run ads, and we don&apos;t use third-party
            analytics or tracking scripts.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Review anonymity</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            Reviews are shown to other students without your name. They are stored with your
            account so you can edit or delete them later.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Cookies and local storage</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            The only cookie we set keeps you signed in. Your theme preference is kept in your
            browser&apos;s local storage and never leaves your device.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">Deleting your data</h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            You can delete your own reviews and schedules from the site. To delete your account and
            everything tied to it, open an issue on the project&apos;s GitHub repository and
            we&apos;ll take care of it.
          </p>
        </section>
      </div>
    </main>
  );
}
