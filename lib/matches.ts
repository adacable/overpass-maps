// Google Maps lives on many country domains; match patterns can't wildcard a
// TLD, so list the common ones. Add more here if yours is missing.
const GOOGLE_DOMAINS = [
  'google.com', 'google.co.uk', 'google.ie', 'google.ca', 'google.com.au', 'google.co.nz',
  'google.de', 'google.fr', 'google.es', 'google.it', 'google.nl', 'google.be', 'google.ch',
  'google.at', 'google.se', 'google.no', 'google.dk', 'google.fi', 'google.pl', 'google.pt',
  'google.co.in', 'google.co.jp', 'google.com.br', 'google.com.mx',
];

export const MAPS_MATCHES = GOOGLE_DOMAINS.map((d) => `https://www.${d}/maps*`);

// Overpass servers send `Access-Control-Allow-Origin: *`, so the extension
// needs no host permissions to query them.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

