// MailService: sends transactional emails using nodemailer when SMTP is configured.
// When SMTP is not configured, operations requiring it throw FEATURE_DISABLED.
import type { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../logger';
import { createMailTransport, fromAddress, mailConfigured } from './transport';

function getTransporter(): Transporter | null {
  return createMailTransport();
}

export const mailService = {
  /** Phase 24: a plain HTML email (emailed dashboards). Silent when SMTP is not configured. */
  async sendHtml(to: string, subject: string, html: string): Promise<boolean> {
    const transporter = getTransporter();
    if (!transporter) return false;
    try {
      await transporter.sendMail({ from: fromAddress(), to, subject, html });
      return true;
    } catch (err) {
      logger.error({ err, to }, 'Failed to send dashboard email');
      return false;
    }
  },

  isConfigured(): boolean {
    return mailConfigured();
  },

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const transporter = getTransporter();
    if (!transporter) return;

    try {
      await transporter.sendMail({
        from: fromAddress(),
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
        from: fromAddress(),
        to,
        subject: 'Password Changed — Sawant Group ERP',
        text: `Your password for Sawant Group ERP has been changed successfully.\n\nIf you did not make this change, please contact your administrator immediately.`,
      });
    } catch (err) {
      logger.error({ err, to }, 'Failed to send password changed notification');
    }
  },
};
