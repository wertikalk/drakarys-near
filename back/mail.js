// SMTP mail transport (Hostinger mailbox, e.g. ops@xfokus.ai).
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST || "smtp.hostinger.com";
const PORT = Number(process.env.SMTP_PORT || 465);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || USER;

export const smtpEnabled = Boolean(USER && PASS);

const transport = smtpEnabled
  ? nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user: USER, pass: PASS },
      connectionTimeout: 10_000,
    })
  : null;

export async function sendMail({ to, subject, text, html }) {
  if (!transport) throw new Error("SMTP is not configured");
  return transport.sendMail({ from: FROM, to, subject, text, html });
}
