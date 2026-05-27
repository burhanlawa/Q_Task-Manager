import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Regex notes:
//   - The lookbehind (?<!\w) keeps "email@example.com" from being matched as
//     a mention. Only @ that follows a non-word char (or string start) counts.
//   - The token is 1..40 of [A-Za-z0-9._-] plus Unicode letters. Names with
//     spaces still match the first word; the resolver matches against display
//     names case-insensitively so "@alice" finds "Alice Smith".
//   - The 'gu' flags: global + unicode so non-Latin scripts (ar/ckb) work too.
const MENTION_REGEX = /(?<!\w)@([\p{L}\p{N}._-]{1,40})/gu;

@Injectable()
export class MentionParserService {
  /**
   * Extract unique @-tokens from rich-text or plain-text body. The body is
   * stripped of HTML tags before matching so a TipTap mention span ('@<span
   * data-mention="...">name</span>') still surfaces "name" as a token.
   *
   * Returns lowercase tokens for case-insensitive matching downstream.
   */
  extractTokens(body: string): string[] {
    const text = body.replace(/<[^>]+>/g, ' ');
    const tokens = new Set<string>();
    for (const m of text.matchAll(MENTION_REGEX)) {
      tokens.add(m[1].toLowerCase());
    }
    return Array.from(tokens);
  }

  /**
   * Resolve tokens to user ids by matching display name, "first last", or
   * email local-part (before the @ in their email) — all case-insensitive.
   *
   * RLS scopes the user query to the current tenant; cross-tenant matches
   * are invisible. Tokens with no match are silently dropped — we don't
   * want a typo to block the comment.
   *
   * Returns one user id per matched token (first match wins on ties).
   */
  async resolveTokens(db: Prisma.TransactionClient, tokens: string[]): Promise<string[]> {
    if (tokens.length === 0) return [];

    // Pull a small candidate set: users whose display/first/last/email
    // starts with any token. Case-insensitive via Prisma's mode: 'insensitive'.
    // Bounded at 200 — plenty for any single comment, cheap on the index.
    const users = await db.user.findMany({
      where: {
        deletedAt: null,
        OR: tokens.flatMap((tok) => [
          { displayName: { equals: tok, mode: 'insensitive' as const } },
          { firstName: { equals: tok, mode: 'insensitive' as const } },
          // "first last" comparisons need a raw SQL or two-field check; the
          // email local-part match below catches the common case.
          { email: { startsWith: `${tok}@`, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, displayName: true, firstName: true, email: true },
      take: 200,
    });

    const matched = new Set<string>();
    for (const tok of tokens) {
      // Prefer displayName, then firstName, then email local-part.
      const u =
        users.find((u) => u.displayName?.toLowerCase() === tok) ??
        users.find((u) => u.firstName?.toLowerCase() === tok) ??
        users.find((u) => u.email.toLowerCase().startsWith(`${tok}@`));
      if (u) matched.add(u.id);
    }
    return Array.from(matched);
  }

  /**
   * One-shot helper: extract + resolve from a single body string.
   */
  async parse(db: Prisma.TransactionClient, body: string): Promise<string[]> {
    const tokens = this.extractTokens(body);
    return this.resolveTokens(db, tokens);
  }
}
