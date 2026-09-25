import { readFile } from 'node:fs/promises';

export function errorSummary(error) {
  return {
    code:
      typeof error?.code === 'number' || typeof error?.code === 'string'
        ? error.code
        : undefined,
    type: error?.constructor?.name || 'Error',
  };
}

export async function botStatus(token, fetchImpl = globalThis.fetch) {
  if (!token) {
    return { configured: false };
  }
  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${token}/getMe`
    );
    const payload = await response.json();
    return response.ok && payload.ok
      ? { active: true, configured: true }
      : { active: false, configured: true, errorCode: payload.error_code };
  } catch (error) {
    return { active: false, configured: true, error: errorSummary(error) };
  }
}

const ACCOMMODATION_PATTERN =
  /apartment|studio|condo|villa|house|room|hotel|hostel|homestay|accommodation|квартир|студи|апартамент|вилл|комнат|дом\b|жиль|отел|хостел|căn\s*hộ|chung\s*cư|biệt\s*thự|phòng|nhà\b|khách\s*sạn|nhà\s*nghỉ/iu;
const OFFER_PATTERN =
  /for\s+rent|rent(?:al|ed)?|lease|available|vacan|daily|monthly|long[ -]?term|short[ -]?term|сда[её]т|аренд|свобод|посуточ|помесяч|dài\s*hạn|ngắn\s*hạn|cho\s*thuê|còn\s*trống|theo\s*ngày|theo\s*tháng/iu;
const DEMAND_PATTERN =
  /\blooking\s+for\b|\bwanted\b|\bneed\s+(?:a|an|to\s+rent)\b|\bищу\b|\bсниму\b|\bнужн\p{L}*\s+(?:квартир|комнат|дом|жиль)|\btìm\s+(?:căn|phòng|nhà)|\bcần\s+thuê\b/iu;
const PRICE_PATTERN =
  /(?:\d[\d\s.,]{0,15}\s*(?:₫|đ|vnd|vnđ|usd|us\$|\$|eur|€|gbp|£|triệu|tr(?:iệu)?|million|mio|tỷ|billion))|(?:(?:₫|đ|vnd|vnđ|usd|us\$|\$|eur|€|gbp|£)\s*\d)/iu;
const NHA_TRANG_PATTERN = /nha\s*trang|nhatrang|ня\s*чанг|нячанг|芽庄/iu;

const EXPECTED_SIGNALS = [
  ['price', PRICE_PATTERN],
  [
    'bedrooms',
    /\b\d{1,2}\s*(?:br|bedrooms?|спальн\p{L}*|pn\b|phòng\s*ngủ)|(?:bedrooms?|спальн\p{L}*|phòng\s*ngủ)\D{0,10}\d{1,2}/iu,
  ],
  [
    'bathrooms',
    /\b\d{1,2}\s*(?:ba|bathrooms?|сануз\p{L}*|wc\b|phòng\s*tắm)|(?:bathrooms?|сануз\p{L}*|phòng\s*tắm)\D{0,10}\d{1,2}/iu,
  ],
  [
    'beds',
    /\b\d{1,2}\s*(?:beds?\b|кроват\p{L}*|giường)|(?:\bbeds?\b|кроват\p{L}*|giường)\D{0,10}\d{1,2}/iu,
  ],
  ['areaM2', /\d{1,4}(?:[.,]\d{1,2})?\s*(?:m²|m2|м²|кв\.?\s*м)/iu],
  ['floor', /(?:floor|этаж|tầng)\D{0,10}\d{1,3}|\d{1,3}\s*(?:floor|этаж)/iu],
  ['depositMonths', /deposit|депозит|залог|đặt\s*cọc|tiền\s*cọc/iu],
  [
    'minimumStayMonths',
    /minimum\s+stay|minimum\s+lease|аренд\p{L}*\s+от|tối\s*thiểu|hợp\s*đồng/iu,
  ],
  [
    'availableFrom',
    /available\s+from|свобод\p{L}*\s+с|доступ\p{L}*\s+с|có\s*sẵn\s*từ/iu,
  ],
  [
    'phone',
    /(?:contact|phone|whatsapp|телефон|zalo|liên\s*hệ)[^\n]{0,40}\+?\d[\d\s().-]{7,20}\d/iu,
  ],
  [
    'telegram',
    /(?<![\p{L}\p{N}.])@[A-Za-z][A-Za-z\d_]{4,31}|https?:\/\/(?:t|telegram)\.me\//iu,
  ],
  ['email', /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/iu],
  ['location', /address|location|адрес|локаци|địa\s*chỉ|vị\s*trí/iu],
  ['furnished', /furnished|unfurnished|меблирован|без\s*мебел|nội\s*thất/iu],
  ['petsAllowed', /pets?|животн|thú\s*cưng/iu],
  ['utilitiesIncluded', /utilities|коммунальн|điện|nước|tiện\s*ích/iu],
];

export const DEFAULT_DISCOVERY_QUERIES = [
  'Nha Trang apartment rent',
  'Nha Trang rental',
  'Nha Trang housing',
  'Nha Trang house rent',
  'Nha Trang room rent',
  'Нячанг аренда',
  'Нячанг жильё',
  'Нячанг квартиры',
  'Нячанг недвижимость',
  'Nha Trang cho thuê căn hộ',
  'Nha Trang thuê nhà',
  'Nha Trang phòng trọ',
];

export function assertManualLocalRun(environment = {}) {
  const ciMarkers = [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'BUILDKITE',
    'CIRCLECI',
    'JENKINS_URL',
  ];
  if (ciMarkers.some((name) => environment[name])) {
    throw new Error(
      'Real-data Telegram E2E is manual/local-only and refuses to run in CI/CD.'
    );
  }
}

function unquote(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return quote && quote === trimmed.at(-1) && ['"', "'"].includes(quote)
    ? trimmed.slice(1, -1)
    : trimmed;
}

export function parseDotEnv(value = '') {
  const result = {};
  for (const line of String(value).split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z\d_]*)\s*=\s*(.*)$/u);
    if (match) {
      result[match[1]] = unquote(match[2].replace(/\s+#.*$/u, ''));
    }
  }
  return result;
}

export async function loadCredentialEnvironment(paths = []) {
  const result = {};
  for (const path of paths.filter(Boolean)) {
    Object.assign(result, parseDotEnv(await readFile(path, 'utf8')));
  }
  return { ...result, ...process.env };
}

export function telegramCredentials(environment) {
  return {
    apiHash:
      environment.TELEGRAM_API_HASH || environment.TELEGRAM_USER_BOT_API_HASH,
    apiId: Number(
      environment.TELEGRAM_API_ID || environment.TELEGRAM_USER_BOT_API_ID
    ),
    botToken: environment.TELEGRAM_BOT_TOKEN,
    session: environment.TELEGRAM_USER_SESSION,
    sessionFormat: environment.TELEGRAM_USER_SESSION_FORMAT,
  };
}

export function textValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  return value?.text || '';
}

export function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function classifyAccommodationPost(value = '', hasMedia = false) {
  const text = String(value);
  const accommodation = ACCOMMODATION_PATTERN.test(text);
  const offer = OFFER_PATTERN.test(text);
  const demand = DEMAND_PATTERN.test(text);
  const price = PRICE_PATTERN.test(text);
  const relevant = accommodation && !demand && (offer || price);
  return {
    accommodation,
    demand,
    mediaOnlyCandidate: hasMedia && !text.trim(),
    offer,
    price,
    relevant,
  };
}

export function expectedDetails(value = '') {
  const text = String(value);
  return EXPECTED_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name
  );
}

function parsedDetail(offer, detail) {
  if (detail === 'price') {
    return Boolean(offer?.price && Number.isFinite(offer.price.amount));
  }
  if (['phone', 'telegram', 'email'].includes(detail)) {
    return Boolean(offer?.contacts?.[detail]?.length);
  }
  if (detail === 'location') {
    return Boolean(offer?.location);
  }
  return offer?.attributes?.[detail] !== undefined;
}

export function missingExpectedDetails(offer, text) {
  return expectedDetails(text).filter((detail) => !parsedDetail(offer, detail));
}

export function anonymizeListing(value = '', maximum = 900) {
  const contactLabels =
    /contact|phone|whatsapp|telegram|zalo|контакт|телефон|владелец|риелтор|агент|liên\s*hệ|chủ\s*nhà|môi\s*giới/iu;
  const locationLabels = /address|location|адрес|локаци|địa\s*chỉ|vị\s*trí/iu;
  const lines = String(value)
    .split(/\r?\n/u)
    .map((line) => {
      if (contactLabels.test(line)) {
        return '[CONTACT REDACTED]';
      }
      if (locationLabels.test(line)) {
        return '[LOCATION REDACTED]';
      }
      return line;
    });
  return lines
    .join('\n')
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .replace(/(?<![\p{L}\p{N}.])@[A-Za-z][A-Za-z\d_]{4,31}/gu, '[HANDLE]')
    .replace(
      /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu,
      '[EMAIL]'
    )
    .replace(/\+?\d[\d\s().-]{7,20}\d/gu, '[PHONE]')
    .replace(
      /(?:\bID|код|mã)\s*[#:№-]?\s*[\p{L}\d_-]{2,32}/giu,
      'ID [REDACTED]'
    )
    .slice(0, maximum)
    .trim();
}

export function isNhaTrangSource(value = '') {
  return NHA_TRANG_PATTERN.test(String(value));
}

export function isTelegramCommunity(entity) {
  const className = entity?.className || entity?.constructor?.name;
  return className === 'Channel' || className === 'Chat';
}

export function isTelegramPrivateDialog(entity) {
  const className = entity?.className || entity?.constructor?.name;
  return className === 'User' || className === 'UserEmpty';
}

export function publicUsername(entity) {
  const usernames = [entity?.username, ...(entity?.usernames || [])]
    .map((entry) => (typeof entry === 'string' ? entry : entry?.username))
    .filter(Boolean);
  return usernames[0];
}

export function publicSourceRecord(entity, discoveredBy = []) {
  const username = publicUsername(entity);
  if (!username) {
    return undefined;
  }
  const title = entity.title || entity.firstName || username;
  return {
    discoveredBy: [...new Set(discoveredBy)].sort(),
    participants: Number(entity.participantsCount) || undefined,
    title,
    type: entity.broadcast ? 'channel' : 'group',
    username,
  };
}

export function sourceScore(source) {
  const identity = `${source.title} ${source.username}`;
  return (
    (isNhaTrangSource(identity) ? 1000 : 0) +
    (ACCOMMODATION_PATTERN.test(identity) || OFFER_PATTERN.test(identity)
      ? 100
      : 0) +
    Math.min(source.participants || 0, 100_000) / 100_000 +
    source.discoveredBy.length
  );
}

export function countBy(values) {
  const result = {};
  for (const value of values) {
    result[value] = (result[value] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort((left, right) => right[1] - left[1])
  );
}
