export function requiredEmail(name: 'ADMIN_EMAIL' | 'RADAR_CONTACT_EMAIL'): string {
  const raw = process.env[name];
  if (!raw || raw.length > 254 || [...raw].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
      || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw))
    throw new Error(`${name} configuration HOLD`);
  return raw;
}

export function contactUserAgent(kind: 'social' | 'edgar' = 'social'): string {
  const email = requiredEmail('RADAR_CONTACT_EMAIL');
  return kind === 'edgar' ? `RadarOSS ${email}` : `SocialRadar/1.0 (monitoraggio media; contatto: ${email})`;
}
