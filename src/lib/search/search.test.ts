import { describe, expect, it } from 'vitest';
import { buildSearchHref, escapeLikeTerm, normalizeQuery } from './search';

// ------------------------------------------------------------
// normalizeQuery — limpeza do termo digitado.
// ------------------------------------------------------------

describe('normalizeQuery', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeQuery('  joão  ')).toBe('joão');
    expect(normalizeQuery('\t ana \n')).toBe('ana');
  });

  it('lowercases the term', () => {
    expect(normalizeQuery('JOÃO')).toBe('joão');
    expect(normalizeQuery('João Silva')).toBe('joão silva');
  });

  it('collapses repeated internal spaces', () => {
    expect(normalizeQuery('joão    silva')).toBe('joão silva');
  });

  it('returns empty for blank input', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });

  it('keeps accents intact (ilike is accent-insensitive in PG default)', () => {
    expect(normalizeQuery('ação')).toBe('ação');
  });
});

// ------------------------------------------------------------
// buildSearchHref — rota de destino por tipo de resultado.
// ------------------------------------------------------------

describe('buildSearchHref', () => {
  it('opens conversations in their inbox thread', () => {
    expect(buildSearchHref('conversation', 'conv_123')).toBe(
      '/inbox?c=conv_123'
    );
  });

  it('encodes conversation ids with special characters', () => {
    expect(buildSearchHref('conversation', 'a/b c')).toBe('/inbox?c=a%2Fb%20c');
  });

  it('sends contacts to the contacts list', () => {
    expect(buildSearchHref('contact', 'c_1')).toBe('/contacts');
  });

  it('sends payments and renewals to the renewals agenda', () => {
    expect(buildSearchHref('payment', 'p_1')).toBe('/renewals');
    expect(buildSearchHref('renewal', 'r_1')).toBe('/renewals');
  });

  it('sends credentials to the clients page', () => {
    expect(buildSearchHref('credential', 'cr_1')).toBe('/clients');
  });
});

// ------------------------------------------------------------
// escapeLikeTerm — literaliza curingas do padrão ilike.
// ------------------------------------------------------------

describe('escapeLikeTerm', () => {
  it('leaves plain text untouched', () => {
    expect(escapeLikeTerm('joão silva')).toBe('joão silva');
    expect(escapeLikeTerm('55 11 99999-0000')).toBe('55 11 99999-0000');
  });

  it('escapes the percent wildcard', () => {
    expect(escapeLikeTerm('100%')).toBe('100\\%');
  });

  it('escapes the underscore wildcard', () => {
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
  });

  it('escapes a backslash itself', () => {
    expect(escapeLikeTerm('a\\b')).toBe('a\\\\b');
  });
});
