// The same rule as public.looks_like_spam_name (migration 049): bots sign
// up with an advert and a link as their "name". Checked here first so a
// real student gets a clear message; the database refuses it either way.

const LINK = /(https?:\/\/|www\.|bit\.ly|t\.me\/|wa\.me\/|tinyurl|discord\.gg|goo\.gl)/i;
const DOMAIN = /[a-z0-9-]{2,}\.(com|net|org|ru|xyz|top|ly|io|info|biz|click|link|site|online|shop|store|vip|bet|win|tk|cn|su)([^a-z]|$)/i;

export const NAME_REFUSED = 'Please enter your real name. Names can’t contain links or web addresses.';

export function looksLikeSpamName(name: string | null | undefined): boolean {
  if (!name) return false;
  return LINK.test(name) || DOMAIN.test(name) || /[<>]/.test(name) || name.length > 80;
}
