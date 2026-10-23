import { calculateHaversineDistanceKm } from '../src/services/maps';
import { MASTER_CITIES } from '../src/data/master_cities';

export interface OsmPlaceRaw {
  id: string;
  osm_id: string;
  osm_type: 'node' | 'way' | 'relation';
  name: string;
  category: string;
  sub_category?: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  opening_hours?: string;
}

const VADODARA_BBOX = {
  minLat: 22.1800,
  maxLat: 22.4200,
  minLng: 73.0800,
  maxLng: 73.2800,
};

const VADODARA_MASTER = MASTER_CITIES.find((c) => c.id === 'GJ-VAD');

export function findNearestVadodaraArea(lat: number, lng: number): string {
  if (!VADODARA_MASTER || !VADODARA_MASTER.areas.length) return 'GJ-VAD-OTHER';
  let minDistance = Infinity;
  let nearestAreaId = 'GJ-VAD-ALKAPURI';

  for (const area of VADODARA_MASTER.areas) {
    if (area.lat && area.lng) {
      const dist = calculateHaversineDistanceKm(lat, lng, area.lat, area.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestAreaId = area.id;
      }
    }
  }
  return nearestAreaId;
}

export function isValidVadodaraCoord(lat: number, lng: number): boolean {
  return (
    lat >= VADODARA_BBOX.minLat &&
    lat <= VADODARA_BBOX.maxLat &&
    lng >= VADODARA_BBOX.minLng &&
    lng <= VADODARA_BBOX.maxLng
  );
}

export const CURATED_VADODARA_CIVIC_PLACES: OsmPlaceRaw[] = [
  {
    id: 'osm_node_1001',
    osm_id: '1001',
    osm_type: 'node',
    name: 'Sir Sayajirao General (SSG) Civil Hospital',
    category: 'hospital',
    sub_category: 'Government Tertiary Hospital',
    lat: 22.3087,
    lng: 73.1895,
    address: 'Jail Road, Anandpura, Vadodara, Gujarat 390001',
    phone: '0265-2424848',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1002',
    osm_id: '1002',
    osm_type: 'node',
    name: 'Sterling Hospital Vadodara',
    category: 'hospital',
    sub_category: 'Multi-specialty Hospital',
    lat: 22.3168,
    lng: 73.1552,
    address: 'Race Course Circle West, Subhanpura, Vadodara, Gujarat 390007',
    phone: '0265-6188000',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1003',
    osm_id: '1003',
    osm_type: 'node',
    name: 'Zydus Hospital Vadodara',
    category: 'hospital',
    sub_category: 'Multi-specialty Hospital',
    lat: 22.2842,
    lng: 73.1368,
    address: 'Zydus Drive, Near Kalali Railway Crossing, Vadodara, Gujarat 390012',
    phone: '0265-6677000',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1004',
    osm_id: '1004',
    osm_type: 'node',
    name: 'Bhailal Amin General Hospital',
    category: 'hospital',
    sub_category: 'Multi-specialty Hospital',
    lat: 22.3275,
    lng: 73.1612,
    address: 'Alembic Road, Subhanpura, Vadodara, Gujarat 390003',
    phone: '0265-3058000',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1005',
    osm_id: '1005',
    osm_type: 'node',
    name: 'Bankers Heart Institute',
    category: 'hospital',
    sub_category: 'Cardiac Speciality Hospital',
    lat: 22.2965,
    lng: 73.1685,
    address: 'Old Padra Road, Akota, Vadodara, Gujarat 390015',
    phone: '0265-2334444',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1006',
    osm_id: '1006',
    osm_type: 'node',
    name: 'Sayaji Baug (Kamati Baug)',
    category: 'park',
    sub_category: 'Botanical Garden & Zoo',
    lat: 22.3135,
    lng: 73.1892,
    address: 'Vinoba Bhave Road, Sayajiganj, Vadodara, Gujarat 390005',
    opening_hours: '06:00-20:00',
  },
  {
    id: 'osm_node_1007',
    osm_id: '1007',
    osm_type: 'node',
    name: 'Sardar Patel Planetarium',
    category: 'park',
    sub_category: 'Planetarium & Science Center',
    lat: 22.3142,
    lng: 73.1905,
    address: 'Sayaji Baug, Sayajiganj, Vadodara, Gujarat 390005',
    opening_hours: '10:00-17:30',
  },
  {
    id: 'osm_node_1008',
    osm_id: '1008',
    osm_type: 'node',
    name: 'Baroda Museum and Picture Gallery',
    category: 'park',
    sub_category: 'State Heritage Museum',
    lat: 22.3129,
    lng: 73.1901,
    address: 'Kamati Baug, Sayajigunj, Vadodara, Gujarat 390018',
    opening_hours: '10:30-17:00',
  },
  {
    id: 'osm_node_1009',
    osm_id: '1009',
    osm_type: 'node',
    name: 'Maharaja Sayajirao University of Baroda (MSU)',
    category: 'college',
    sub_category: 'Public University Main Campus',
    lat: 22.3175,
    lng: 73.1872,
    address: 'Pratapgunj, Vadodara, Gujarat 390002',
    phone: '0265-2795555',
  },
  {
    id: 'osm_node_1010',
    osm_id: '1010',
    osm_type: 'node',
    name: 'Faculty of Technology and Engineering (MSU)',
    category: 'college',
    sub_category: 'Engineering College',
    lat: 22.3082,
    lng: 73.1915,
    address: 'Kalabhavan, Dandia Bazar, Vadodara, Gujarat 390001',
    phone: '0265-2434188',
  },
  {
    id: 'osm_node_1011',
    osm_id: '1011',
    osm_type: 'node',
    name: 'Vadodara Central Bus Station (GSRTC)',
    category: 'bus_stop',
    sub_category: 'State Transport Terminal',
    lat: 22.3094,
    lng: 73.1834,
    address: 'Sayajiganj, Vadodara, Gujarat 390005',
    phone: '0265-2794700',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1012',
    osm_id: '1012',
    osm_type: 'node',
    name: 'Vadodara Junction Railway Station',
    category: 'bus_stop',
    sub_category: 'Transit Hub',
    lat: 22.3108,
    lng: 73.1815,
    address: 'Station Road, Alkapuri, Vadodara, Gujarat 390002',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1013',
    osm_id: '1013',
    osm_type: 'node',
    name: 'State Bank of India (SBI Main Branch)',
    category: 'bank',
    sub_category: 'Public Sector Bank & ATM',
    lat: 22.3015,
    lng: 73.2045,
    address: 'Mandvi, Vadodara, Gujarat 390001',
    opening_hours: '10:00-16:00',
  },
  {
    id: 'osm_node_1014',
    osm_id: '1014',
    osm_type: 'node',
    name: 'HDFC Bank & 24/7 ATM Alkapuri',
    category: 'atm',
    sub_category: 'ATM',
    lat: 22.3112,
    lng: 73.1725,
    address: 'RC Dutt Road, Alkapuri, Vadodara, Gujarat 390007',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1015',
    osm_id: '1015',
    osm_type: 'node',
    name: 'ICICI Bank Gotri Branch & ATM',
    category: 'bank',
    sub_category: 'Private Bank',
    lat: 22.3172,
    lng: 73.1415,
    address: 'Gotri Road, Vadodara, Gujarat 390021',
    opening_hours: '10:00-16:00',
  },
  {
    id: 'osm_node_1016',
    osm_id: '1016',
    osm_type: 'node',
    name: 'Indian Oil Petrol & CNG Station',
    category: 'fuel',
    sub_category: 'Fuel & Gas Station',
    lat: 22.3145,
    lng: 73.1785,
    address: 'Alkapuri Road, Vadodara, Gujarat 390007',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1017',
    osm_id: '1017',
    osm_type: 'node',
    name: 'Bharat Petroleum Pump Makarpura',
    category: 'fuel',
    sub_category: 'Fuel Station',
    lat: 22.2512,
    lng: 73.1935,
    address: 'Makarpura GIDC Main Road, Vadodara, Gujarat 390010',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1018',
    osm_id: '1018',
    osm_type: 'node',
    name: 'Vadodara Municipal Corporation (VMC) HQ',
    category: 'hospital',
    sub_category: 'Municipal Civic Center',
    lat: 22.2995,
    lng: 73.2082,
    address: 'Khanderao Market, Rajmahal Road, Vadodara, Gujarat 390001',
    phone: '1800-233-0266',
    opening_hours: '10:00-18:00',
  },
  {
    id: 'osm_node_1019',
    osm_id: '1019',
    osm_type: 'node',
    name: 'Apollo Pharmacy 24x7 Karelibaug',
    category: 'hospital',
    sub_category: 'Pharmacy',
    lat: 22.3282,
    lng: 73.1955,
    address: 'Water Tank Road, Karelibaug, Vadodara, Gujarat 390018',
    opening_hours: '24/7',
  },
  {
    id: 'osm_node_1020',
    osm_id: '1020',
    osm_type: 'node',
    name: 'Baroda High School Alkapuri',
    category: 'school',
    sub_category: 'Secondary School',
    lat: 22.3092,
    lng: 73.1712,
    address: 'Alkapuri, Vadodara, Gujarat 390007',
    phone: '0265-2331562',
  },
];

export function buildCivicPlaceSql(place: OsmPlaceRaw): { sql: string; params: any[] } {
  const areaId = findNearestVadodaraArea(place.lat, place.lng);
  const sql = `
    INSERT INTO civic_places (
      id, city_id, area_id, osm_id, osm_type, name, category, sub_category,
      lat, lng, address, phone, opening_hours, is_verified, source, license, attribution
    ) VALUES (
      ?, 'GJ-VAD', ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, 0, 'OpenStreetMap', 'ODbL', '© OpenStreetMap contributors'
    )
    ON CONFLICT(osm_type, osm_id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      sub_category = excluded.sub_category,
      lat = excluded.lat,
      lng = excluded.lng,
      address = excluded.address,
      phone = excluded.phone,
      opening_hours = excluded.opening_hours
  `;
  const params = [
    place.id,
    areaId,
    place.osm_id,
    place.osm_type,
    place.name,
    place.category,
    place.sub_category || '',
    place.lat,
    place.lng,
    place.address || '',
    place.phone || '',
    place.opening_hours || '',
  ];
  return { sql, params };
}

export async function seedCuratedVadodaraCivicPlaces(db: any): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const place of CURATED_VADODARA_CIVIC_PLACES) {
    if (!isValidVadodaraCoord(place.lat, place.lng)) continue;
    const { sql, params } = buildCivicPlaceSql(place);
    try {
      await db.prepare(sql).bind(...params).run();
      inserted++;
    } catch (e) {
      console.error(`[OSM Seed Error for ${place.name}]:`, e);
    }
  }
  return { inserted };
}
