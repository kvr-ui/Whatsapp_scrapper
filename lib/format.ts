/**
 * Longest-prefix country code table. Ordered longest-first at lookup time so
 * "971" wins over "97"/"9". Covers the dialling codes that actually show up in
 * the FOCAS communities plus the common expat destinations.
 */
const COUNTRY_CODES = [
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '44',
  '45', '46', '47', '48', '49', '51', '52', '54', '55', '56', '57', '58', '60',
  '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92',
  '93', '94', '95', '98', '211', '212', '213', '216', '218', '220', '221',
  '233', '234', '249', '250', '251', '254', '255', '256', '260', '263', '264',
  '265', '267', '268', '269', '351', '352', '353', '354', '355', '356', '357',
  '358', '359', '370', '371', '372', '373', '374', '375', '376', '377', '380',
  '381', '385', '386', '387', '389', '420', '421', '423', '501', '502', '503',
  '504', '505', '506', '507', '509', '590', '591', '593', '595', '598', '673',
  '674', '675', '676', '677', '678', '679', '680', '685', '686', '687', '689',
  '855', '856', '880', '886', '960', '961', '962', '963', '964', '965', '966',
  '967', '968', '970', '971', '972', '973', '974', '975', '976', '977', '992',
  '993', '994', '995', '996', '998',
].sort((a, b) => b.length - a.length);

/** Strip everything that is not a digit; returns null if nothing usable is left. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).split('@')[0].replace(/\D/g, '');
  // WhatsApp @lid identifiers are long synthetic ids, not dialable numbers.
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Split a normalised number into its dialling code, or null when unrecognised. */
export function countryCodeOf(phone: string | null): string | null {
  if (!phone) return null;
  for (const cc of COUNTRY_CODES) {
    if (phone.startsWith(cc) && phone.length - cc.length >= 6) return cc;
  }
  return null;
}

/**
 * The number without its dialling code, which is the form WATI wants in its
 * `Phone` column (the code travels separately in `CountryCode`). Falls back to
 * the full string when the dialling code cannot be identified.
 */
export function nationalNumberOf(phone: string | null): string {
  if (!phone) return '';
  const cc = countryCodeOf(phone);
  return cc ? phone.slice(cc.length) : phone;
}

/** E.164 form, used only in the "All details" export. */
export function toE164(phone: string | null): string {
  return phone ? `+${phone}` : '';
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const date = typeof d === 'string' ? new Date(d) : d;
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'], [3600, 'minute'], [86400, 'hour'],
    [604800, 'day'], [2629800, 'week'], [31557600, 'month'],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let prev = 1;
  for (const [limit, unit] of units) {
    if (secs < limit) return rtf.format(-Math.round(secs / prev), unit);
    prev = limit;
  }
  return rtf.format(-Math.round(secs / 31557600), 'year');
}
