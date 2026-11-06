// MailService: sends transactional emails using nodemailer when SMTP is configured.
// When SMTP is not configured, operations requiring it throw FEATURE_DISABLED.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../logger';

let transporterInstance: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_FROM) {
    return null;
  }
  if (!transporterInstance) {
    transporterInstance = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? {
              user: env.SMTP_USER,
              pass: env.SMTP_PASS,
            }
          : undefined,
    });
  }
  return transporterInstance;
}

export const mailService = {
  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM);
  },

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const transporter = getTransporter();
    if (!transporter) return;

    try {
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject: 'Password Reset — Sawant Group ERP',
        text: `You requested a password reset for your Sawant Group ERP account.\n\nClick the link below to set a new password (valid for 30 minutes):\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
        html: `<p>You requested a password reset for your Sawant Group ERP account.</p><p><a href="${resetUrl}">Click here to set a new password</a> (valid for 30 minutes).</p><p>If you did not request this, please ignore this email.</p>`,
      });
    } catch (err) {
      logger.error({ err, to }, 'Failed to send password reset email');
    }
  },

  async sendPasswordChanged(to: string): Promise<void> {
    const transporter = getTransporter();
    if (!transporter) return;

    try {
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject: 'Password Changed — Sawant Group ERP',
        text: `Your password for Sawant Group ERP has been changed successfully.\n\nIf you did not make this change, please contact your administrator immediately.`,
      });
    } catch (err) {
      logger.error({ err, to }, 'Failed to send password changed notification');
    }
  },
};
