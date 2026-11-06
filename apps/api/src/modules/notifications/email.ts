// Email for notifications (docs/phases/PHASE-05.md §5): templates, the outbox and the drain that
// the `email.send` job runs. SMTP is optional: without it, queued rows become SKIPPED and the app
// keeps working. Backoff doubles from one minute; after 5 attempts a row is FAILED.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { formatInr } from '../approvals/money';

export const MAX_EMAIL_ATTEMPTS = 5;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM);
}

let transport: Transporter | null = null;
function transporter(): Transporter | null {
  if (!smtpConfigured()) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

/** Test seam: the drain asks this for the transporter, tests may swap it. */
let transportOverride: Pick<Transporter, 'sendMail'> | null = null;
export function setEmailTransportForTests(t: Pick<Transporter, 'sendMail'> | null): void {
  transportOverride = t;
}

export interface EmailItem {
  title: string;
  body: string;
  link: string | null;
  docCode?: string | null;
  amount?: string | null;
}

export function absoluteLink(link: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `${env.APP_BASE_URL.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}`;
}

export async function companyName(db: Db = prisma): Promise<string> {
  const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
  return company?.tradeName || company?.legalName || 'RHAI ERP';
}

/** One notification: company name, document code, amount and an "Open in ERP" link. */
export function renderEmail(company: string, item: EmailItem): { html: string; text: string } {
  const href = absoluteLink(item.link);
  const lines: string[] = [];
  if (item.docCode) lines.push(`Document: ${item.docCode}`);
  if (item.amount) lines.push(`Amount: ${formatInr(item.amount)}`);
  if (item.body) lines.push(item.body);
  const text = [company, '', item.title, ...lines, href ? `Open in ERP: ${href}` : ''].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px">` +
    `<p style="color:#555;margin:0 0 8px">${escapeHtml(company)}</p>` +
    `<h2 style="margin:0 0 12px">${escapeHtml(item.title)}</h2>` +
    lines.map((l) => `<p style="margin:4px 0">${escapeHtml(l)}</p>`).join('') +
    (href
      ? `<p style="margin:16px 0"><a href="${escapeHtml(href)}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open in ERP</a></p>`
      : '') +
    `</div>`;
  return { html, text };
}

/** Several notifications in one message (daily digest). */
export function renderDigest(
  company: string,
  items: readonly EmailItem[],
): { html: string; text: string } {
  const text = [
    company,
    '',
    `You have ${items.length} unread notification${items.length === 1 ? '' : 's'}:`,
    ...items.map((i) => {
      const href = absoluteLink(i.link);
      return `- ${i.title}${href ? ` (${href})` : ''}`;
    }),
  ].join('\n');
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px">` +
    `<p style="color:#555;margin:0 0 8px">${escapeHtml(company)}</p>` +
    `<h2 style="margin:0 0 12px">Your daily summary</h2><ul>` +
    items
      .map((i) => {
        const href = absoluteLink(i.link);
        const label = escapeHtml(i.title);
        return `<li>${href ? `<a href="${escapeHtml(href)}">${label}</a>` : label}</li>`;
      })
      .join('') +
    `</ul></div>`;
  return { html, text };
}

export async function queueEmail(
  db: Db,
  to: string,
  subject: string,
  content: { html: string; text: string },
): Promise<string> {
  const row = await db.emailOutbox.create({
    data: { toEmail: to, subject: subject.slice(0, 300), html: content.html, text: content.text },
    select: { id: true },
  });
  return row.id;
}

export interface DrainResult {
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
}

/** Backoff after a failed attempt: 1, 2, 4, 8 minutes. */
export function backoffMs(attempts: number): number {
  return 60_000 * 2 ** Math.max(0, attempts - 1);
}

/**
 * Sends what is due. Safe to run twice at once: each row is claimed with FOR UPDATE SKIP LOCKED
 * inside its own transaction, and a SENT/SKIPPED/FAILED row is never picked again.
 */
export async function drainOutbox(now: Date = new Date(), batch = 50): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, skipped: 0, failed: 0, retried: 0 };
  const mailer = transportOverride ?? transporter();
  for (let i = 0; i < batch; i += 1) {
    const done = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          to_email: string;
          subject: string;
          html: string;
          text: string;
          attempts: number;
        }[]
      >`SELECT id, to_email, subject, html, text, attempts FROM email_outbox
        WHERE status = 'QUEUED' AND next_attempt_at <= ${now}
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const row = rows[0];
      if (!row) return false;
      if (!mailer) {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'SKIPPED', lastError: 'SMTP is not configured.' },
        });
        result.skipped += 1;
        return true;
      }
      try {
        await mailer.sendMail({
          from: env.SMTP_FROM,
          to: row.to_email,
          subject: row.subject,
          text: row.text,
          html: row.html,
        });
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'SENT', sentAt: now, attempts: row.attempts + 1, lastError: null },
        });
        result.sent += 1;
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        logger.warn({ outboxId: row.id, attempts }, 'Email send failed');
        if (attempts >= MAX_EMAIL_ATTEMPTS) {
          await tx.emailOutbox.update({
            where: { id: row.id },
            data: { status: 'FAILED', attempts, lastError: message },
          });
          result.failed += 1;
        } else {
          await tx.emailOutbox.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: message,
              nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
            },
          });
          result.retried += 1;
        }
      }
      return true;
    });
    if (!done) break;
  }
  return result;
}
