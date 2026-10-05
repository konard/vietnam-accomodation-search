// Common Nha Trang complexes, streets, wards, and parts of the city, used
// when a post names a place but has no location label. Every entry is
// `[name, ...aliases]`; aliases are matched without case or diacritics.
//
// Complexes listed here exist only in Nha Trang, so they count on their own.
const COMPLEXES = [
  ['Mường Thanh Viễn Triều', 'muong thanh vien trieu', 'vien trieu'],
  ['Oceanus', 'oceanus', 'muong thanh oceanus', 'океанус'],
  ['Scenia Bay', 'scenia bay'],
  ['Napoleon Castle', 'napoleon castle'],
  ['Hà Quang', 'ha quang', 'kdt ha quang'],
  ['Mỹ Gia', 'my gia', 'kdt my gia', 'ми зя', 'мизя'],
  ['An Bình Tân', 'an binh tan', 'kdt an binh tan', 'ан бинь тан'],
  ['Hòn Xện', 'hon xen', 'хон сен'],
  ['Marina Suites', 'marina suites'],
  ['Citadines Bayfront', 'citadines bayfront'],
  ['Imperium Town', 'imperium town', 'imperium'],
  ['Champa Island', 'champa island'],
  ['Nha Trang Center', 'nha trang center', 'nha trang centre'],
];

// Names that also occur in other cities count only when the post or its
// source is about Nha Trang.
const SHARED_COMPLEXES = [
  ['Gold Coast', 'gold coast', 'голд кост'],
  ['Panorama', 'panorama', 'панорама'],
  ['Ariyana', 'ariyana', 'ариана'],
  ['Virgo', 'virgo'],
  ['Vườn Xoài', 'vuon xoai', 'acc vuon xoai'],
  ['Hòn Chồng', 'hon chong', 'хон чонг'],
  ['Vinpearl', 'vinpearl', 'винперл'],
  ['HUD Building', 'hud building'],
  ['Bàn Cờ', 'ban co', 'бан ко'],
];

const STREETS = [
  ['Trần Phú', 'tran phu', 'чан фу'],
  ['Phạm Văn Đồng', 'pham van dong', 'фам ван донг'],
  ['Nguyễn Thiện Thuật', 'nguyen thien thuat', 'нгуен тхиен тхуат'],
  ['Hùng Vương', 'hung vuong', 'хунг выонг'],
  ['Biệt Thự', 'biet thu'],
  ['Lê Thánh Tôn', 'le thanh ton'],
  ['Nguyễn Thị Minh Khai', 'nguyen thi minh khai'],
  ['Trần Quang Khải', 'tran quang khai'],
  ['Hoàng Diệu', 'hoang dieu'],
  ['Lê Hồng Phong', 'le hong phong'],
  ['Thái Nguyên', 'thai nguyen'],
  ['Yersin', 'yersin'],
  ['Pasteur', 'pasteur'],
  ['Trần Hưng Đạo', 'tran hung dao'],
  ['Võ Thị Sáu', 'vo thi sau'],
  ['Nguyễn Tất Thành', 'nguyen tat thanh'],
  ['Đường Đệ', 'duong de'],
  ['Củ Chi', 'cu chi'],
  ['Đoàn Trần Nghiệp', 'doan tran nghiep'],
  ['Quảng Đức', 'quang duc'],
  ['2 Tháng 4', '2 thang 4'],
  ['23 Tháng 10', '23 thang 10'],
];

const WARDS = [
  ['Vĩnh Hòa', 'vinh hoa', 'винь хоа'],
  ['Vĩnh Hải', 'vinh hai', 'винь хай'],
  ['Vĩnh Phước', 'vinh phuoc', 'винь фуок'],
  ['Vĩnh Thọ', 'vinh tho', 'винь тхо'],
  ['Vĩnh Nguyên', 'vinh nguyen'],
  ['Vĩnh Trường', 'vinh truong', 'винь чыонг'],
  ['Vĩnh Hiệp', 'vinh hiep'],
  ['Vĩnh Ngọc', 'vinh ngoc'],
  ['Vĩnh Thạnh', 'vinh thanh'],
  ['Vĩnh Trung', 'vinh trung'],
  ['Vĩnh Phương', 'vinh phuong'],
  ['Vĩnh Lương', 'vinh luong'],
  ['Xương Huân', 'xuong huan'],
  ['Vạn Thắng', 'van thang'],
  ['Vạn Thạnh', 'van thanh'],
  ['Phương Sài', 'phuong sai'],
  ['Phương Sơn', 'phuong son'],
  ['Ngọc Hiệp', 'ngoc hiep'],
  ['Phước Hòa', 'phuoc hoa'],
  ['Phước Tân', 'phuoc tan'],
  ['Phước Tiến', 'phuoc tien'],
  ['Phước Hải', 'phuoc hai', 'фуок хай'],
  ['Phước Long', 'phuoc long', 'фуок лонг'],
  ['Phước Đồng', 'phuoc dong'],
  ['Lộc Thọ', 'loc tho', 'лок тхо'],
  ['Tân Lập', 'tan lap'],
];

// Parts of the city named in the post, such as "Север Нячанга".
const AREAS = [
  [
    'North Nha Trang',
    /(?<!\p{L})(?:север\p{L}*(?:\s+част\p{L}*)?\s+нячанг|north(?:ern)?\s+nha\s*trang|bac\s+nha\s*trang)/u,
  ],
  [
    'South Nha Trang',
    /(?<!\p{L})(?:(?:юг|южн)\p{L}*(?:\s+част\p{L}*)?\s+нячанг|south(?:ern)?\s+nha\s*trang|nam\s+nha\s*trang)/u,
  ],
  [
    'West Nha Trang',
    /(?<!\p{L})(?:запад\p{L}*(?:\s+част\p{L}*)?\s+нячанг|west(?:ern)?\s+nha\s*trang|tay\s+nha\s*trang)/u,
  ],
  [
    'Central Nha Trang',
    /(?<!\p{L})(?:центр\p{L}*(?:\s+город\p{L}*)?\s+нячанг|(?:central|downtown)\s+nha\s*trang|trung\s+tam\s+nha\s*trang)/u,
  ],
];

const NHA_TRANG = /nha\s*trang|ngatrang|нячанг/u;
// Cities a post may name when it names no place in them. Chinese names
// have no word boundaries, so their patterns carry none.
const CITIES = [
  ['Nha Trang', NHA_TRANG],
  ['Da Nang', /da\s*nang|дананг|峴港/u],
  ['Hanoi', /ha\s*noi|hanoi|ханой|河內|河内/u],
  [
    'Ho Chi Minh City',
    /ho\s*chi\s*minh|sai\s*gon|saigon|хошимин|сайгон|胡志明/u,
  ],
  ['Phu Quoc', /phu\s*quoc|фукуок|富國/u],
  ['Da Lat', /da\s*lat|dalat|далат|大叻/u],
  ['Vung Tau', /vung\s*tau|вунгтау|頭頓/u],
  ['Hoi An', /hoi\s*an(?!\p{L})|хойан|會安/u],
];
// Words that start an address, such as "район Марина" or "Улица T23".
const ADDRESS_WORD =
  /(?<!\p{L})(?:улиц\p{L}*|ул\.|район\p{L}*|street|district|duong|phuong|quan|вьетнам\p{L}*|vietnam|viet\s+nam)(?!\p{L})/u;

function fold(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLocaleLowerCase('en');
}

function compile(entries) {
  return entries.map(([name, ...aliases]) => ({
    name,
    pattern: new RegExp(
      `(?<![\\p{L}\\d])(?:${aliases
        .map((alias) => fold(alias).replace(/\s+/gu, '\\s+'))
        .join('|')})(?![\\p{L}\\d])`,
      'u'
    ),
  }));
}

const GROUPS = [
  { places: compile(COMPLEXES), shared: false },
  { places: compile(SHARED_COMPLEXES), shared: true },
  { places: compile(STREETS), shared: true },
  { places: compile(WARDS), shared: true },
];

function firstMatch(places, text) {
  let found;
  for (const place of places) {
    const index = text.search(place.pattern);
    if (index >= 0 && (!found || index < found.index)) {
      found = { index, name: place.name };
    }
  }
  return found?.name;
}

// Tells whether the text names a city, an address, or one of the places
// above, so a pinned heading such as "📍 Удобства рядом" is not taken for a
// location.
export function namesPlace(value) {
  const text = fold(String(value));
  return (
    ADDRESS_WORD.test(text) ||
    CITIES.some(([, pattern]) => pattern.test(text)) ||
    AREAS.some(([, pattern]) => pattern.test(text)) ||
    GROUPS.some(({ places }) => firstMatch(places, text))
  );
}

// Returns the most specific Nha Trang place named in the text: a complex,
// then a street, a ward, a part of the city, and the city the post names.
// `hint` is the location of the source the post came from. A post naming
// several cities, such as a list of flights, names none of them.
export function nhaTrangPlace(value, { hint = '' } = {}) {
  const text = fold(String(value));
  const cities = CITIES.filter(([, pattern]) => pattern.test(text));
  const fromSource = NHA_TRANG.test(fold(String(hint)));
  const city = cities.length === 1 ? cities[0][0] : undefined;
  const local =
    cities.length === 0
      ? fromSource
      : cities.some(([name]) => name === 'Nha Trang') && (fromSource || !!city);
  for (const { places, shared } of GROUPS) {
    const name = (local || !shared) && firstMatch(places, text);
    if (name) {
      return `${name}, Nha Trang`;
    }
  }
  return AREAS.find(([, pattern]) => pattern.test(text))?.[0] ?? city;
}
