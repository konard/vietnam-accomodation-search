const OBSERVED_AT = '2026-09-21T00:00:00.000Z';

function webSource(id, name, url, searchUrl, value, evidenceUrl) {
  return {
    id,
    name,
    type: 'web',
    url,
    searchUrl,
    popularity: {
      metric: 'seed-rank-score',
      value,
      evidenceUrl,
      observedAt: OBSERVED_AT,
    },
  };
}

function telegramSource(handle, name, value) {
  return {
    id: `telegram:${handle.toLocaleLowerCase('en')}`,
    name,
    type: 'telegram',
    url: `https://t.me/${handle}`,
    searchUrl: `https://t.me/s/${handle}`,
    popularity: {
      metric: 'members-or-subscribers',
      value,
      evidenceUrl: `https://t.me/${handle}`,
      observedAt: OBSERVED_AT,
    },
  };
}

export const DEFAULT_WEB_SOURCES = [
  webSource(
    'booking',
    'Booking.com',
    'https://www.booking.com',
    'https://www.booking.com/searchresults.html?ss={query}%2C%20Vietnam',
    100,
    'https://www.similarweb.com/website/booking.com/'
  ),
  webSource(
    'airbnb',
    'Airbnb',
    'https://www.airbnb.com',
    'https://www.airbnb.com/s/{query}--Vietnam/homes',
    98,
    'https://www.similarweb.com/website/airbnb.com/'
  ),
  webSource(
    'agoda',
    'Agoda',
    'https://www.agoda.com',
    'https://www.agoda.com/search?textToSearch={query}%2C%20Vietnam',
    96,
    'https://www.similarweb.com/website/agoda.com/'
  ),
  webSource(
    'traveloka',
    'Traveloka',
    'https://www.traveloka.com/en-vn',
    'https://www.traveloka.com/en-vn/hotel/search?spec={query}',
    94,
    'https://www.similarweb.com/website/traveloka.com/'
  ),
  webSource(
    'expedia',
    'Expedia',
    'https://www.expedia.com',
    'https://www.expedia.com/Hotel-Search?destination={query}%2C%20Vietnam',
    92,
    'https://www.similarweb.com/website/expedia.com/'
  ),
  webSource(
    'hotels',
    'Hotels.com',
    'https://www.hotels.com',
    'https://www.hotels.com/Hotel-Search?destination={query}%2C%20Vietnam',
    90,
    'https://www.similarweb.com/website/hotels.com/'
  ),
  webSource(
    'trip',
    'Trip.com',
    'https://www.trip.com',
    'https://www.trip.com/hotels/list?searchWord={query}%2C%20Vietnam',
    88,
    'https://www.similarweb.com/website/trip.com/'
  ),
  webSource(
    'hostelworld',
    'Hostelworld',
    'https://www.hostelworld.com',
    'https://www.hostelworld.com/st/hostels/asia/vietnam/{query}/',
    86,
    'https://www.similarweb.com/website/hostelworld.com/'
  ),
  webSource(
    'google-hotels',
    'Google Hotels',
    'https://www.google.com/travel/hotels',
    'https://www.google.com/travel/search?q=hotels%20{query}%20Vietnam',
    84,
    'https://trends.google.com/trends/explore?q=Google%20Hotels'
  ),
  webSource(
    'tripadvisor',
    'Tripadvisor',
    'https://www.tripadvisor.com',
    'https://www.tripadvisor.com/Search?q={query}%20Vietnam&searchSessionId=hotels',
    82,
    'https://www.similarweb.com/website/tripadvisor.com/'
  ),
  webSource(
    'vrbo',
    'Vrbo',
    'https://www.vrbo.com',
    'https://www.vrbo.com/searchResults.do?destination={query}%2C%20Vietnam',
    80,
    'https://www.similarweb.com/website/vrbo.com/'
  ),
  webSource(
    'klook',
    'Klook Hotels',
    'https://www.klook.com/hotels',
    'https://www.klook.com/hotels/list/?search={query}%2C%20Vietnam',
    78,
    'https://www.similarweb.com/website/klook.com/'
  ),
  webSource(
    'kayak',
    'KAYAK',
    'https://www.kayak.com/hotels',
    'https://www.kayak.com/hotels/{query},Vietnam',
    76,
    'https://www.similarweb.com/website/kayak.com/'
  ),
  webSource(
    'trivago',
    'trivago',
    'https://www.trivago.com',
    'https://www.trivago.com/en-US/srl/hotels-{query}-vietnam?search=200-73',
    74,
    'https://www.similarweb.com/website/trivago.com/'
  ),
  webSource(
    'skyscanner',
    'Skyscanner Hotels',
    'https://www.skyscanner.com/hotels',
    'https://www.skyscanner.com/hotels/search?entityName={query}%2C%20Vietnam',
    72,
    'https://www.similarweb.com/website/skyscanner.com/'
  ),
  webSource(
    'vntrip',
    'Vntrip',
    'https://www.vntrip.vn',
    'https://www.vntrip.vn/khach-san?search={query}',
    70,
    'https://www.similarweb.com/website/vntrip.vn/'
  ),
  webSource(
    'ivivu',
    'iVIVU',
    'https://www.ivivu.com',
    'https://www.ivivu.com/khach-san-{query}',
    68,
    'https://www.similarweb.com/website/ivivu.com/'
  ),
  webSource(
    'mytour',
    'Mytour',
    'https://mytour.vn',
    'https://mytour.vn/khach-san?s={query}',
    66,
    'https://www.similarweb.com/website/mytour.vn/'
  ),
  webSource(
    'batdongsan',
    'Batdongsan.com.vn',
    'https://batdongsan.com.vn',
    'https://batdongsan.com.vn/nha-dat-cho-thue?query={query}',
    64,
    'https://www.similarweb.com/website/batdongsan.com.vn/'
  ),
  webSource(
    'chotot',
    'Chợ Tốt',
    'https://www.chotot.com',
    'https://www.chotot.com/mua-ban-bat-dong-san?q={query}',
    62,
    'https://www.similarweb.com/website/chotot.com/'
  ),
  webSource(
    'hotel-mix',
    'HotelMix',
    'https://hotelmix.vn',
    'https://hotelmix.vn/search?query={query}',
    60,
    'https://www.similarweb.com/website/hotelmix.com/'
  ),
];

export const DEFAULT_TELEGRAM_SOURCES = [
  telegramSource('Viet_life_niachang', 'Vietnam Life Nha Trang', 8870),
  telegramSource('DaNangRentAFlat', 'Da Nang Rent a Flat', 6300),
  telegramSource('nyachang_arendavn', 'Nha Trang аренда', 4949),
  telegramSource('danang_arend', 'Da Nang аренда', 4800),
  telegramSource('NhaTrang_rental', 'Nha Trang Rental', 2590),
  telegramSource('apartmentforrentdanang', 'Apartment for Rent Da Nang', 2091),
  telegramSource('vietnamstay', 'Vietnam Stay', 1660),
  telegramSource('nhatrangapartment', 'Nha Trang Apartment', 1124),
  telegramSource('phuquoc_realestate', 'Phu Quoc Real Estate', 746),
  telegramSource('nhatrangapartment_rental', 'Nha Trang Apartment Rental', 642),
  telegramSource('vietnam_rent', 'Vietnam Rent', 600),
  telegramSource('phuquoc_rental', 'Phu Quoc Rental', 580),
  telegramSource('phuquocrealestate_chat', 'Phu Quoc Real Estate Chat', 560),
  telegramSource('danang_home', 'Da Nang Home', 540),
  telegramSource('Danangcityapartment', 'Da Nang City Apartment', 520),
  telegramSource('bdsvnco', 'Vietnam Real Estate', 500),
  telegramSource('vietnam_chat_ru', 'Vietnam Russian Chat', 480),
  telegramSource('muine_rent', 'Mui Ne Rent', 460),
  telegramSource('hanoi_apartments', 'Hanoi Apartments', 440),
  telegramSource('saigon_apartments', 'Saigon Apartments', 420),
  telegramSource('dalat_rent', 'Da Lat Rent', 400),
];

function rankAndLimit(sources, count) {
  const unique = new Map();
  for (const source of sources) {
    unique.set(source.id, source);
  }
  return [...unique.values()]
    .sort((left, right) => right.popularity.value - left.popularity.value)
    .slice(0, count);
}

export class SourceRegistry {
  constructor({ store, discover } = {}) {
    this.store = store;
    this.discover = discover;
  }

  async list(type) {
    const stored = (await this.store?.loadSources?.()) || [];
    const sources = stored.length
      ? stored
      : [
          ...rankAndLimit(DEFAULT_WEB_SOURCES, 20),
          ...rankAndLimit(DEFAULT_TELEGRAM_SOURCES, 20),
        ];
    return type ? sources.filter((source) => source.type === type) : sources;
  }

  async update({ count = 20 } = {}) {
    const current = await this.list();
    const discoverType = async (type, defaults) => {
      const found =
        (await this.discover?.(type, { candidates: defaults })) || [];
      const fallback = current.filter((source) => source.type === type);
      return rankAndLimit(found.length ? found : fallback, count);
    };
    const [web, telegram] = await Promise.all([
      discoverType('web', DEFAULT_WEB_SOURCES),
      discoverType('telegram', DEFAULT_TELEGRAM_SOURCES),
    ]);

    await this.store?.saveSources?.([...web, ...telegram]);
    return { web, telegram };
  }
}
