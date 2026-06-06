import nodemailer from "nodemailer";

export interface SendMailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Build a transport from SMTP_* env vars. Returns null when SMTP isn't
// configured, in which case sendMail() logs the message instead of sending.
function getTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

export async function sendMail({
  to,
  subject,
  text,
  html,
}: SendMailArgs): Promise<{ delivered: boolean }> {
  const from = process.env.SMTP_FROM ?? "GFL Survivor <no-reply@gfl.local>";
  const transport = getTransport();

  if (!transport) {
    console.log(
      `[mailer] SMTP not configured (set SMTP_HOST to enable). Would send:\n` +
        `  to:      ${to}\n` +
        `  subject: ${subject}\n` +
        `  ${text.replace(/\n/g, "\n  ")}`
    );
    return { delivered: false };
  }

  await transport.sendMail({ from, to, subject, text, html });
  return { delivered: true };
}
