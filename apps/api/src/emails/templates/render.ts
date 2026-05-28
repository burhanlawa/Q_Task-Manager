import { Injectable } from '@nestjs/common';
import ar from './messages/ar.json';
import ckb from './messages/ckb.json';
import en from './messages/en.json';
import type { EmailableType, Locale, RenderedEmail, TemplateVars } from './types';

type MessageEntry = { subject: string; preheader: string; body: string };
type LocaleMessages = Record<EmailableType, MessageEntry>;

const messages: Record<Locale, LocaleMessages> = {
  en: en as LocaleMessages,
  ar: ar as LocaleMessages,
  ckb: ckb as LocaleMessages,
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar', 'ckb']);

@Injectable()
export class EmailTemplateService {
  // Render a notification email for (type × locale × vars). Returns the
  // subject, an HTML body wrapped in a small layout shell, and a plain-text
  // twin derived from the source body. The HTML's `dir="rtl"` and
  // `text-align` flip when the locale is ar or ckb so Gmail/Outlook lay it
  // out right-to-left without us having to write two layout files.
  render(type: EmailableType, locale: Locale, vars: TemplateVars): RenderedEmail {
    const m = messages[locale]?.[type] ?? messages.en[type];
    const subject = interpolate(m.subject, vars);
    const bodyText = interpolate(m.body, vars);
    const preheader = interpolate(m.preheader, vars);
    const html = layout({
      locale,
      isRtl: RTL_LOCALES.has(locale),
      subject,
      preheader,
      bodyText,
    });
    return { subject, html, text: bodyText };
  }
}

// Replace every {key} with vars[key], or leave intact if missing so a
// drift between template and caller is visible rather than silently empty.
function interpolate(s: string, vars: TemplateVars): string {
  return s.replace(/\{(\w+)\}/g, (raw, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : raw,
  );
}

// Single shared layout. Inline styles only (most email clients strip
// <style> blocks). The preheader span is the snippet shown next to the
// subject line in inbox previews — we hide it visually but it's still
// part of the document.
function layout(args: {
  locale: Locale;
  isRtl: boolean;
  subject: string;
  preheader: string;
  bodyText: string;
}): string {
  const { locale, isRtl, subject, preheader, bodyText } = args;
  const dir = isRtl ? 'rtl' : 'ltr';
  const textAlign = isRtl ? 'right' : 'left';
  // Convert plain-text \n\n to <p> blocks and single \n to <br/>. Escape
  // HTML so a "{taskTitle}" containing '<' can't break the layout.
  const paragraphs = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
<span style="display:none;font-size:1px;color:#f4f4f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f5;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;text-align:${textAlign};">
            <strong style="font-size:16px;color:#0f172a;">Q Task Manager</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;font-size:15px;line-height:1.6;color:#0f172a;text-align:${textAlign};" dir="${dir}">
            ${paragraphs}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;text-align:${textAlign};">
            Q Task Manager &middot; ${escapeHtml(new Date().getFullYear().toString())}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
