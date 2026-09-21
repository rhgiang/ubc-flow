// src/lib/account-emails.ts
import {
  FOOTER_ACCOUNT,
  button,
  fallbackLink,
  para,
  renderEmail,
} from '@/lib/email-layout';

/**
 * The two emails the account system sends. Kept beside the Canvas ones in
 * shape (subject, plain text, html) so every caller of sendMail passes the
 * same thing, and kept in their own file because these are transactional and
 * carry no unsubscribe: a password reset is a reply to something the person
 * just did, not something they opted into.
 */
export type Mail = { subject: string; body: string; html: string };

export function passwordResetEmail(link: string): Mail {
  const subject = 'Reset your UBC Flow password';
  const body =
    `Set a new password by visiting:\n\n${link}\n\n` +
    `This link expires in 1 hour and can only be used once.\n\n` +
    `If you did not ask for this, you can ignore it. Nothing has changed.`;

  const html = renderEmail({
    title: subject,
    preheader: 'This link works once and expires in an hour.',
    heading: 'Set a new password',
    rows:
      para('Use the button below to choose a new password for your UBC Flow account.') +
      button('Set a new password', link) +
      para('This link works once and expires in an hour.') +
      para('If you did not ask for this, ignore it. Nothing has changed and your current password still works.') +
      fallbackLink(link),
    footer: FOOTER_ACCOUNT,
  });

  return { subject, body, html };
}

export function verifyEmail(link: string): Mail {
  const subject = 'Verify your UBC Flow account';
  const body = `Confirm your email by visiting:\n\n${link}\n\nThis link expires in 24 hours.`;

  const html = renderEmail({
    title: subject,
    preheader: 'One click to confirm your email address.',
    heading: 'Confirm your email',
    rows:
      para('Confirm this address to finish setting up your UBC Flow account.') +
      button('Confirm my email', link) +
      para('This link expires in 24 hours.') +
      fallbackLink(link),
    footer: FOOTER_ACCOUNT,
  });

  return { subject, body, html };
}
