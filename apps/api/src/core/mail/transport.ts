// The one place that builds the outgoing-mail transport of the ERP.
//  1. Microsoft 365 through Microsoft Graph (the company mailbox info@sawantgroup.co.in) when GRAPH_* is set:
//       - GRAPH_CLIENT_SECRET set  -> app-only token (client credentials), sends as GRAPH_SENDER (needs Mail.Send application
//         permission with admin consent);
//       - else GRAPH_SENDER_PASSWORD set -> the mailbox signs in itself (delegated Mail.Send, "public client flows" on; it
//         does not work when the mailbox has multi-factor authentication).
//  2. Plain SMTP (SMTP_HOST / SMTP_PORT / SMTP_FROM) otherwise.
// Every sender of the ERP (password reset mail, the e-mail outbox, document and automation mails) calls createMailTransport(),
// so switching the provider is only a .env change. Secrets are read from the environment and never logged.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../logger';

export function graphConfigured(): boolean {
  return Boolean(
    env.GRAPH_TENANT_ID &&
      env.GRAPH_CLIENT_ID &&
      env.GRAPH_SENDER &&
      (env.GRAPH_CLIENT_SECRET || env.GRAPH_SENDER_PASSWORD),
  );
}

export function smtpOnlyConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM);
}

/** True when any provider can send. */
export function mailConfigured(): boolean {
  return graphConfigured() || smtpOnlyConfigured();
}

/** The address every mail is sent from (Microsoft only lets a mailbox send as itself). */
export function fromAddress(): string | undefined {
  return graphConfigured() ? `${env.GRAPH_SENDER_NAME} <${env.GRAPH_SENDER}>` : env.SMTP_FROM;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const appOnly = Boolean(env.GRAPH_CLIENT_SECRET);
  const form = new URLSearchParams({ client_id: env.GRAPH_CLIENT_ID! });
  if (appOnly) {
    form.set('grant_type', 'client_credentials');
    form.set('client_secret', env.GRAPH_CLIENT_SECRET!);
    form.set('scope', 'https://graph.microsoft.com/.default');
  } else {
    form.set('grant_type', 'password');
    form.set('username', env.GRAPH_SENDER!);
    form.set('password', env.GRAPH_SENDER_PASSWORD!);
    form.set('scope', 'https://graph.microsoft.com/Mail.Send');
  }
  const res = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    // the description from Microsoft is safe to log (it never contains the secret)
    throw new Error(`Microsoft sign-in failed: ${json.error ?? res.status} ${(json.error_description ?? '').split('\r\n')[0]}`.trim());
  }
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** Sends a finished MIME message through Graph (POST /sendMail with a base64 MIME body). */
export async function sendRawViaGraph(mime: Buffer): Promise<void> {
  const token = await accessToken();
  const who = env.GRAPH_CLIENT_SECRET ? `users/${encodeURIComponent(env.GRAPH_SENDER!)}` : 'me';
  const res = await fetch(`https://graph.microsoft.com/v1.0/${who}/sendMail`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: mime.toString('base64'),
  });
  if (res.status !== 202 && !res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (res.status === 401) cached = null;
    throw new Error(`Microsoft Graph refused the mail (${res.status}): ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.trim());
  }
}

/** A nodemailer transport that delivers through Graph. */
const graphTransport = {
  name: 'graph',
  version: '1',
  send(
    mail: {
      message: {
        keepBcc: boolean;
        setHeader: (k: string, v: string) => void;
        build: (cb: (err: Error | null, msg: Buffer) => void) => void;
        messageId: () => string;
        getEnvelope: () => { from: string | false; to: string[] };
      };
    },
    done: (err: Error | null, info?: unknown) => void,
  ): void {
    const msg = mail.message;
    msg.keepBcc = true; // Graph reads the Bcc header, and removes it before delivery
    msg.setHeader('from', fromAddress() ?? '');
    msg.build((err, raw) => {
      if (err) return done(err);
      sendRawViaGraph(raw).then(
        () => {
          const envelope = msg.getEnvelope();
          done(null, { envelope, messageId: msg.messageId(), accepted: envelope.to, rejected: [], pending: [], response: '202 Accepted' });
        },
        (e: unknown) => {
          logger.error({ err: e instanceof Error ? e.message : 'unknown' }, 'Microsoft Graph mail failed');
          done(e instanceof Error ? e : new Error('Microsoft Graph mail failed'));
        },
      );
    });
  },
};

let instance: Transporter | null = null;

/** The transporter of the configured provider, or null when none is configured (callers then only record the mail). */
export function createMailTransport(): Transporter | null {
  if (instance) return instance;
  if (graphConfigured()) {
    instance = nodemailer.createTransport(graphTransport as never);
  } else if (smtpOnlyConfigured()) {
    instance = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return instance;
}
