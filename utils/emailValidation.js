import dns from 'dns/promises';

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const COMMON_DOMAIN_TYPOS = Object.freeze({
  'gamil.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'premindustrie.in': 'premindustries.in',
  'premindustries.com': 'premindustries.in',
});

const BLOCKED_DOMAINS = new Set([
  'example.com',
  'example.in',
  'example.org',
  'test.com',
  'localhost',
  'invalid',
]);
const BLOCKED_TLDS = new Set(['invalid', 'localhost', 'test']);
const DNS_TEMPORARY_ERRORS = new Set(['ECONNREFUSED', 'ESERVFAIL', 'ETIMEOUT']);

const makeEmailError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const normalizeEmail = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();

export const validateEmailFormat = (value, { required = true, label = 'email' } = {}) => {
  const email = normalizeEmail(value);
  if (!email) {
    if (!required) return '';
    throw makeEmailError(`A valid ${label} is required`);
  }

  if (email.length > 254) {
    throw makeEmailError(`${label} is too long`);
  }
  if (/[,\s<>()[\]";:]/.test(email)) {
    throw makeEmailError(`${label} contains invalid characters`);
  }

  const parts = email.split('@');
  if (parts.length !== 2) {
    throw makeEmailError(`A valid ${label} is required`);
  }

  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    throw makeEmailError(`A valid ${label} is required`);
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw makeEmailError(`A valid ${label} is required`);
  }
  if (BLOCKED_DOMAINS.has(domain)) {
    throw makeEmailError(`${label} cannot use a test domain`);
  }
  const tld = domain.split('.').at(-1);
  if (BLOCKED_TLDS.has(tld)) {
    throw makeEmailError(`${label} cannot use a test domain`);
  }
  if (COMMON_DOMAIN_TYPOS[domain]) {
    throw makeEmailError(`Did you mean ${local}@${COMMON_DOMAIN_TYPOS[domain]}?`);
  }

  return email;
};

export const normalizeEmailList = (values, { label = 'email' } = {}) => {
  const rawValues = Array.isArray(values) ? values : String(values || '').split(',');
  return [
    ...new Set(
      rawValues
        .map((value) => normalizeEmail(value))
        .filter(Boolean)
        .map((email) => validateEmailFormat(email, { label }))
    ),
  ];
};

export const assertEmailDomainCanReceiveMail = async (email, { label = 'email' } = {}) => {
  const domain = email.split('@')[1];
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (mxRecords.length > 0) return true;
  } catch (error) {
    if (DNS_TEMPORARY_ERRORS.has(error.code)) {
      console.warn(`[Email-validation] DNS lookup unavailable for ${domain}: ${error.code}`);
      return false;
    }
    if (!['ENODATA', 'ENOTFOUND'].includes(error.code)) {
      throw error;
    }
  }

  try {
    await dns.resolve4(domain);
    return true;
  } catch (ipv4Error) {
    if (DNS_TEMPORARY_ERRORS.has(ipv4Error.code)) {
      console.warn(`[Email-validation] DNS lookup unavailable for ${domain}: ${ipv4Error.code}`);
      return false;
    }
    try {
      await dns.resolve6(domain);
      return true;
    } catch (ipv6Error) {
      if (DNS_TEMPORARY_ERRORS.has(ipv6Error.code)) {
        console.warn(`[Email-validation] DNS lookup unavailable for ${domain}: ${ipv6Error.code}`);
        return false;
      }
      throw makeEmailError(`${label} domain cannot receive mail. Check the spelling and try again.`);
    }
  }
};

export const normalizeAndValidateEmail = async (
  value,
  { required = true, label = 'email', checkDns = false } = {}
) => {
  const email = validateEmailFormat(value, { required, label });
  if (email && checkDns) {
    await assertEmailDomainCanReceiveMail(email, { label });
  }
  return email;
};

export const getEmailValidationError = (value, options = {}) => {
  try {
    validateEmailFormat(value, options);
    return null;
  } catch (error) {
    return error.message;
  }
};
