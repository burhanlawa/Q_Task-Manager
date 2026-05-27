import { MentionParserService } from '../../src/comments/mention-parser.service';

// Pure-function tests for extractTokens. The resolver hits the DB and is
// covered live in the verify-13.3 script.

describe('MentionParserService.extractTokens (Sprint 13.3)', () => {
  const svc = new MentionParserService();

  it('extracts simple @tokens', () => {
    expect(svc.extractTokens('@alice and @bob said hi')).toEqual(['alice', 'bob']);
  });

  it('de-dupes case-insensitively', () => {
    expect(svc.extractTokens('@Alice met @alice and @ALICE')).toEqual(['alice']);
  });

  it('does NOT match emails inline (lookbehind blocks word chars)', () => {
    // 'foo@example.com' — the @ has 'foo' before it, so it shouldn't trigger.
    expect(svc.extractTokens('email me at foo@example.com')).toEqual([]);
  });

  it('matches @token at string start', () => {
    expect(svc.extractTokens('@alice hello')).toEqual(['alice']);
  });

  it('strips HTML before matching (TipTap output)', () => {
    const html = '<p>Hello <span data-mention="x">@alice</span> and @bob</p>';
    expect(svc.extractTokens(html).sort()).toEqual(['alice', 'bob']);
  });

  it('handles Unicode (Arabic/Kurdish) names', () => {
    // The regex uses \p{L} so non-Latin letters are valid token chars.
    expect(svc.extractTokens('@أحمد and @bob')).toEqual(expect.arrayContaining(['أحمد', 'bob']));
  });

  it('caps individual tokens at 40 chars', () => {
    const long = 'a'.repeat(50);
    // The match stops at 40 chars, so the result is the 40-char prefix.
    expect(svc.extractTokens(`@${long}`)).toEqual([long.slice(0, 40)]);
  });

  it('returns [] when there are no tokens', () => {
    expect(svc.extractTokens('plain text with no mentions')).toEqual([]);
    expect(svc.extractTokens('')).toEqual([]);
  });

  it('the done-check: "@alice @bob" extracts two distinct tokens', () => {
    expect(svc.extractTokens('@alice @bob').sort()).toEqual(['alice', 'bob']);
  });
});
