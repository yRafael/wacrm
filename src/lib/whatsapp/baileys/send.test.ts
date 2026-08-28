import { describe, expect, it } from 'vitest';
import { phoneToJid } from './send';

describe('phoneToJid', () => {
  it('builds a PN JID from a Brazilian phone', () => {
    expect(phoneToJid('5514997403826')).toBe('5514997403826@s.whatsapp.net');
  });

  it('strips formatting before building the JID', () => {
    expect(phoneToJid('+55 (14) 99740-3826')).toBe(
      '5514997403826@s.whatsapp.net'
    );
  });

  it('routes a 15-digit LID to the @lid namespace, not @s.whatsapp.net', () => {
    // A PN JID for <lid>@s.whatsapp.net does not exist — the send is
    // silently dropped. LIDs must go to @lid, which Baileys resolves
    // to the recipient's devices at send time.
    expect(phoneToJid('107657700585628')).toBe('107657700585628@lid');
  });
});
