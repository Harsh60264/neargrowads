export interface GlobalReachCountry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  clicks: number;
  topologyId: string;
  photo: string;
  photoAlt: string;
  photoCredit: {
    label: string;
    href: string;
  };
}

export const GLOBAL_REACH_COUNTRIES: GlobalReachCountry[] = [
  {
    id: 'IN',
    name: 'India',
    lat: 20.5937,
    lng: 78.9629,
    clicks: 2116,
    topologyId: '356',
    photo: '/images/global-reach/india.jpg',
    photoAlt: 'A destination photograph representing India',
    photoCredit: { label: 'Unsplash', href: 'https://unsplash.com' },
  },
  {
    id: 'US',
    name: 'United States',
    lat: 39.8283,
    lng: -98.5795,
    clicks: 2218,
    topologyId: '840',
    photo: '/images/global-reach/united-states.jpg',
    photoAlt: 'A destination photograph representing the United States',
    photoCredit: { label: 'web.de travel', href: 'https://web.de/magazine/reise/new-york-orte-41748094' },
  },
  {
    id: 'CA',
    name: 'Canada',
    lat: 56.1304,
    lng: -106.3468,
    clicks: 272,
    topologyId: '124',
    photo: '/images/global-reach/canada.jpg',
    photoAlt: 'A landscape photograph representing Canada',
    photoCredit: { label: 'Islands', href: 'https://www.islands.com/1976475/common-mistake-tourists-avoid-visiting-canada-acting-small/' },
  },
  {
    id: 'BR',
    name: 'Brazil',
    lat: -14.235,
    lng: -51.9253,
    clicks: 65,
    topologyId: '076',
    photo: '/images/global-reach/brazil.jpg',
    photoAlt: 'A destination photograph representing Brazil',
    photoCredit: { label: 'Cheapflights', href: 'https://www.cheapflights.com.hk/car-rentals/Santos-Dumont/' },
  },
  {
    id: 'SA',
    name: 'Saudi Arabia',
    lat: 23.8859,
    lng: 45.0792,
    clicks: 35,
    topologyId: '682',
    photo: '/images/global-reach/saudi-arabia.jpg',
    photoAlt: 'A destination photograph representing Saudi Arabia',
    photoCredit: { label: 'Startup3lmashi', href: 'https://www.startup3lmashi.com/p/sab-invest-plans-sar-1-billion-raise' },
  },
  {
    id: 'PH',
    name: 'Philippines',
    lat: 12.8797,
    lng: 121.774,
    clicks: 497,
    topologyId: '608',
    photo: '/images/global-reach/philippines.jpg',
    photoAlt: 'A landscape photograph representing the Philippines',
    photoCredit: { label: 'Tripadeal', href: 'https://www.tripadeal.com.au/deals/5846-philippines-island-adventure-2026' },
  },
  {
    id: 'GB',
    name: 'United Kingdom',
    lat: 55.3781,
    lng: -3.436,
    clicks: 468,
    topologyId: '826',
    photo: '/images/global-reach/united-kingdom.jpg',
    photoAlt: 'A destination photograph representing the United Kingdom',
    photoCredit: { label: 'Unsplash', href: 'https://unsplash.com/photos/BtJUTrjnSw4' },
  },
  {
    id: 'AU',
    name: 'Australia',
    lat: -25.2744,
    lng: 133.7751,
    clicks: 202,
    topologyId: '036',
    photo: '/images/global-reach/australia.jpg',
    photoAlt: 'A landscape photograph representing Australia',
    photoCredit: { label: 'Newt', href: 'https://newt.net/aus/mag-2744551258' },
  },
  {
    id: 'AE',
    name: 'United Arab Emirates',
    lat: 23.4241,
    lng: 53.8478,
    clicks: 81,
    topologyId: '784',
    photo: '/images/global-reach/united-arab-emirates.jpg',
    photoAlt: 'A destination photograph representing the United Arab Emirates',
    photoCredit: { label: 'AD Middle East', href: 'https://www.admiddleeast.com/story/the-tallest-buildings-in-dubai-you-must-visit' },
  },
  {
    id: 'MY',
    name: 'Malaysia',
    lat: 4.2105,
    lng: 101.9758,
    clicks: 77,
    topologyId: '458',
    photo: '/images/global-reach/malaysia.jpg',
    photoAlt: 'A destination photograph representing Malaysia',
    photoCredit: { label: 'MobiMatter', href: 'https://mobimatter.com/blog/top-25-warm-destinations-for-christmas-and-new-year/' },
  },
];
