export interface MasterArea {
  id: string;
  name: string;
  pincode?: string;
  lat?: number;
  lng?: number;
}

export interface MasterCity {
  id: string;
  stateId: string;
  name: string;
  lat: number;
  lng: number;
  pincode: string;
  areas: MasterArea[];
}

export const MASTER_CITIES: MasterCity[] = [
  {
    id: 'GJ-VAD',
    stateId: 'GJ',
    name: 'Vadodara',
    lat: 22.3072,
    lng: 73.1812,
    pincode: '390001',
    areas: [
      { id: 'GJ-VAD-ALKAPURI', name: 'Alkapuri', pincode: '390007', lat: 22.3120, lng: 73.1740 },
      { id: 'GJ-VAD-SAYAJIGUNJ', name: 'Sayajigunj', pincode: '390005', lat: 22.3100, lng: 73.1880 },
      { id: 'GJ-VAD-GOTRI', name: 'Gotri', pincode: '390021', lat: 22.3180, lng: 73.1430 },
      { id: 'GJ-VAD-MANJALPUR', name: 'Manjalpur', pincode: '390011', lat: 22.2680, lng: 73.1960 },
      { id: 'GJ-VAD-KARELIBAUG', name: 'Karelibaug', pincode: '390018', lat: 22.3270, lng: 73.1970 },
      { id: 'GJ-VAD-FATEHGUNJ', name: 'Fatehgunj', pincode: '390002', lat: 22.3250, lng: 73.1860 },
      { id: 'GJ-VAD-SUBHANPURA', name: 'Subhanpura', pincode: '390023', lat: 22.3210, lng: 73.1550 },
      { id: 'GJ-VAD-WAGHODIA', name: 'Waghodia Road', pincode: '390019', lat: 22.2980, lng: 73.2350 },
      { id: 'GJ-VAD-AKOTA', name: 'Akota', pincode: '390020', lat: 22.2960, lng: 73.1700 },
      { id: 'GJ-VAD-VASNA', name: 'Vasna', pincode: '390015', lat: 22.2880, lng: 73.1520 },
      { id: 'GJ-VAD-BHAYLI', name: 'Bhayli', pincode: '391410', lat: 22.2790, lng: 73.1250 },
      { id: 'GJ-VAD-SAMA', name: 'Sama', pincode: '390008', lat: 22.3410, lng: 73.1950 },
      { id: 'GJ-VAD-HARNI', name: 'Harni', pincode: '390022', lat: 22.3380, lng: 73.2200 },
      { id: 'GJ-VAD-MAKARPURA', name: 'Makarpura', pincode: '390014', lat: 22.2450, lng: 73.1950 },
      { id: 'GJ-VAD-TANDALJA', name: 'Tandalja', pincode: '390012', lat: 22.2850, lng: 73.1550 },
      { id: 'GJ-VAD-NIZAMPURA', name: 'Nizampura', pincode: '390002', lat: 22.3320, lng: 73.1750 },
      { id: 'GJ-VAD-CHHANI', name: 'Chhani', pincode: '391740', lat: 22.3650, lng: 73.1850 },
      { id: 'GJ-VAD-DANDIA', name: 'Dandia Bazaar', pincode: '390001', lat: 22.2980, lng: 73.2050 },
      { id: 'GJ-VAD-RAOPURA', name: 'Raopura', pincode: '390001', lat: 22.3020, lng: 73.2020 },
      { id: 'GJ-VAD-OPR', name: 'Old Padra Road', pincode: '390015', lat: 22.2920, lng: 73.1650 },
      { id: 'GJ-VAD-OTHER', name: 'Other / Not listed' },
    ],
  },
  {
    id: 'GJ-AMD',
    stateId: 'GJ',
    name: 'Ahmedabad',
    lat: 23.0225,
    lng: 72.5714,
    pincode: '380001',
    areas: [
      { id: 'GJ-AMD-GENERAL', name: 'General / All Ahmedabad', lat: 23.0225, lng: 72.5714 },
      { id: 'GJ-AMD-SGHIGHWAY', name: 'SG Highway', pincode: '380054', lat: 23.0520, lng: 72.5120 },
      { id: 'GJ-AMD-VASTRAPUR', name: 'Vastrapur', pincode: '380015', lat: 23.0350, lng: 72.5290 },
      { id: 'GJ-AMD-NAVRANGPURA', name: 'Navrangpura', pincode: '380009', lat: 23.0370, lng: 72.5620 },
      { id: 'GJ-AMD-SATELLITE', name: 'Satellite', pincode: '380015', lat: 23.0280, lng: 72.5270 },
      { id: 'GJ-AMD-PRAHLADNAGAR', name: 'Prahlad Nagar', pincode: '380015', lat: 23.0130, lng: 72.5080 },
      { id: 'GJ-AMD-BODAKDEV', name: 'Bodakdev', pincode: '380054', lat: 23.0420, lng: 72.5180 },
      { id: 'GJ-AMD-BOPAL', name: 'Bopal', pincode: '380058', lat: 23.0340, lng: 72.4680 },
      { id: 'GJ-AMD-PALDI', name: 'Paldi', pincode: '380007', lat: 23.0120, lng: 72.5630 },
      { id: 'GJ-AMD-MANINAGAR', name: 'Maninagar', pincode: '380008', lat: 22.9980, lng: 72.6020 },
      { id: 'GJ-AMD-CHANDKHEDA', name: 'Chandkheda', pincode: '382424', lat: 23.1110, lng: 72.5830 },
      { id: 'GJ-AMD-GANDHINAGAR', name: 'Gandhinagar Link / GIFT City', pincode: '382010', lat: 23.1610, lng: 72.6840 },
    ],
  },
  {
    id: 'GJ-SRT',
    stateId: 'GJ',
    name: 'Surat',
    lat: 21.1702,
    lng: 72.8311,
    pincode: '395003',
    areas: [
      { id: 'GJ-SRT-GENERAL', name: 'General / All Surat', lat: 21.1702, lng: 72.8311 },
      { id: 'GJ-SRT-ADAJAN', name: 'Adajan', pincode: '395009', lat: 21.1960, lng: 72.7930 },
      { id: 'GJ-SRT-VESU', name: 'Vesu', pincode: '395007', lat: 21.1430, lng: 72.7760 },
      { id: 'GJ-SRT-PIPLOD', name: 'Piplod', pincode: '395007', lat: 21.1610, lng: 72.7720 },
      { id: 'GJ-SRT-PAL', name: 'Pal', pincode: '395009', lat: 21.1850, lng: 72.7750 },
      { id: 'GJ-SRT-VARACHHA', name: 'Varachha', pincode: '395006', lat: 21.2150, lng: 72.8680 },
      { id: 'GJ-SRT-KATARGAM', name: 'Katargam', pincode: '395004', lat: 21.2290, lng: 72.8280 },
      { id: 'GJ-SRT-CITYLIGHT', name: 'City Light', pincode: '395007', lat: 21.1680, lng: 72.7950 },
      { id: 'GJ-SRT-ATHWA', name: 'Athwa Lines', pincode: '395001', lat: 21.1740, lng: 72.8090 },
      { id: 'GJ-SRT-RANDER', name: 'Rander', pincode: '395005', lat: 21.2160, lng: 72.7930 },
    ],
  },
  {
    id: 'GJ-RJT',
    stateId: 'GJ',
    name: 'Rajkot',
    lat: 22.3039,
    lng: 70.8022,
    pincode: '360001',
    areas: [
      { id: 'GJ-RJT-GENERAL', name: 'General / All Rajkot', lat: 22.3039, lng: 70.8022 },
      { id: 'GJ-RJT-KALAWAD', name: 'Kalawad Road', pincode: '360005', lat: 22.2850, lng: 70.7680 },
      { id: 'GJ-RJT-YAGNIK', name: 'Yagnik Road', pincode: '360001', lat: 22.2980, lng: 70.7950 },
      { id: 'GJ-RJT-UNIVERSITY', name: 'University Road', pincode: '360005', lat: 22.2990, lng: 70.7620 },
      { id: 'GJ-RJT-150RING', name: '150 Feet Ring Road', pincode: '360007', lat: 22.2740, lng: 70.7780 },
    ],
  },
  {
    id: 'MH-MUM',
    stateId: 'MH',
    name: 'Mumbai',
    lat: 19.0760,
    lng: 72.8777,
    pincode: '400001',
    areas: [
      { id: 'MH-MUM-GENERAL', name: 'General / All Mumbai', lat: 19.0760, lng: 72.8777 },
      { id: 'MH-MUM-BANDRA', name: 'Bandra West', pincode: '400050', lat: 19.0596, lng: 72.8295 },
      { id: 'MH-MUM-ANDHERI-W', name: 'Andheri West', pincode: '400058', lat: 19.1136, lng: 72.8397 },
      { id: 'MH-MUM-ANDHERI-E', name: 'Andheri East', pincode: '400069', lat: 19.1197, lng: 72.8464 },
      { id: 'MH-MUM-POWAI', name: 'Powai', pincode: '400076', lat: 19.1176, lng: 72.9060 },
      { id: 'MH-MUM-JUHU', name: 'Juhu', pincode: '400049', lat: 19.1075, lng: 72.8263 },
      { id: 'MH-MUM-COLABA', name: 'Colaba', pincode: '400005', lat: 18.9067, lng: 72.8147 },
      { id: 'MH-MUM-FORT', name: 'Fort', pincode: '400001', lat: 18.9322, lng: 72.8335 },
      { id: 'MH-MUM-WORLI', name: 'Worli', pincode: '400018', lat: 19.0176, lng: 72.8170 },
      { id: 'MH-MUM-THANE', name: 'Thane West', pincode: '400601', lat: 19.2183, lng: 72.9781 },
      { id: 'MH-MUM-NAVI', name: 'Navi Mumbai (Vashi)', pincode: '400703', lat: 19.0770, lng: 72.9986 },
      { id: 'MH-MUM-MALAD', name: 'Malad West', pincode: '400064', lat: 19.1874, lng: 72.8484 },
      { id: 'MH-MUM-BORIVALI', name: 'Borivali West', pincode: '400092', lat: 19.2307, lng: 72.8567 },
    ],
  },
  {
    id: 'MH-PUN',
    stateId: 'MH',
    name: 'Pune',
    lat: 18.5204,
    lng: 73.8567,
    pincode: '411001',
    areas: [
      { id: 'MH-PUN-GENERAL', name: 'General / All Pune', lat: 18.5204, lng: 73.8567 },
      { id: 'MH-PUN-BANER', name: 'Baner', pincode: '411045', lat: 18.5590, lng: 73.7868 },
      { id: 'MH-PUN-KOTHRUD', name: 'Kothrud', pincode: '411038', lat: 18.5074, lng: 73.8077 },
      { id: 'MH-PUN-HINJEWADI', name: 'Hinjewadi IT Park', pincode: '411057', lat: 18.5912, lng: 73.7389 },
      { id: 'MH-PUN-VIMAN', name: 'Viman Nagar', pincode: '411014', lat: 18.5679, lng: 73.9143 },
      { id: 'MH-PUN-WAKAD', name: 'Wakad', pincode: '411057', lat: 18.5987, lng: 73.7663 },
      { id: 'MH-PUN-KOREGAON', name: 'Koregaon Park', pincode: '411001', lat: 18.5362, lng: 73.8940 },
      { id: 'MH-PUN-AUNDH', name: 'Aundh', pincode: '411007', lat: 18.5580, lng: 73.8075 },
    ],
  },
  {
    id: 'DL-DEL',
    stateId: 'DL',
    name: 'Delhi',
    lat: 28.6139,
    lng: 77.2090,
    pincode: '110001',
    areas: [
      { id: 'DL-DEL-GENERAL', name: 'General / All Delhi', lat: 28.6139, lng: 77.2090 },
      { id: 'DL-DEL-CP', name: 'Connaught Place', pincode: '110001', lat: 28.6315, lng: 77.2167 },
      { id: 'DL-DEL-SOUTH', name: 'South Extension / Hauz Khas', pincode: '110049', lat: 28.5494, lng: 77.2001 },
      { id: 'DL-DEL-DWARKA', name: 'Dwarka', pincode: '110075', lat: 28.5921, lng: 77.0460 },
      { id: 'DL-DEL-ROHINI', name: 'Rohini', pincode: '110085', lat: 28.7041, lng: 77.1025 },
      { id: 'DL-DEL-LAJPAT', name: 'Lajpat Nagar', pincode: '110024', lat: 28.5677, lng: 77.2433 },
      { id: 'DL-DEL-KAROL', name: 'Karol Bagh', pincode: '110005', lat: 28.6517, lng: 77.1906 },
    ],
  },
  {
    id: 'KA-BLR',
    stateId: 'KA',
    name: 'Bangalore',
    lat: 12.9716,
    lng: 77.5946,
    pincode: '560001',
    areas: [
      { id: 'KA-BLR-GENERAL', name: 'General / All Bangalore', lat: 12.9716, lng: 77.5946 },
      { id: 'KA-BLR-KORAMANGALA', name: 'Koramangala', pincode: '560034', lat: 12.9352, lng: 77.6245 },
      { id: 'KA-BLR-INDIRANAGAR', name: 'Indiranagar', pincode: '560038', lat: 12.9784, lng: 77.6408 },
      { id: 'KA-BLR-HSR', name: 'HSR Layout', pincode: '560102', lat: 12.9121, lng: 77.6446 },
      { id: 'KA-BLR-WHITEFIELD', name: 'Whitefield', pincode: '560066', lat: 12.9698, lng: 77.7500 },
      { id: 'KA-BLR-BELLANDUR', name: 'Bellandur', pincode: '560103', lat: 12.9260, lng: 77.6762 },
      { id: 'KA-BLR-JAYANAGAR', name: 'Jayanagar', pincode: '560011', lat: 12.9308, lng: 77.5838 },
      { id: 'KA-BLR-JPNAGAR', name: 'JP Nagar', pincode: '560078', lat: 12.9077, lng: 77.5855 },
      { id: 'KA-BLR-ELECTRONIC', name: 'Electronic City', pincode: '560100', lat: 12.8452, lng: 77.6602 },
    ],
  },
  {
    id: 'TS-HYD',
    stateId: 'TS',
    name: 'Hyderabad',
    lat: 17.3850,
    lng: 78.4867,
    pincode: '500001',
    areas: [
      { id: 'TS-HYD-GENERAL', name: 'General / All Hyderabad', lat: 17.3850, lng: 78.4867 },
      { id: 'TS-HYD-HITEC', name: 'HITEC City', pincode: '500081', lat: 17.4435, lng: 78.3772 },
      { id: 'TS-HYD-GACHIBOWLI', name: 'Gachibowli', pincode: '500032', lat: 17.4401, lng: 78.3489 },
      { id: 'TS-HYD-MADHAPUR', name: 'Madhapur', pincode: '500081', lat: 17.4483, lng: 78.3915 },
      { id: 'TS-HYD-JUBILEE', name: 'Jubilee Hills', pincode: '500033', lat: 17.4319, lng: 78.4073 },
      { id: 'TS-HYD-BANJARA', name: 'Banjara Hills', pincode: '500034', lat: 17.4156, lng: 78.4352 },
      { id: 'TS-HYD-KONDAPUR', name: 'Kondapur', pincode: '500084', lat: 17.4699, lng: 78.3578 },
      { id: 'TS-HYD-KUKATPALLY', name: 'Kukatpally', pincode: '500072', lat: 17.4849, lng: 78.4138 },
    ],
  },
  {
    id: 'RJ-JAI',
    stateId: 'RJ',
    name: 'Jaipur',
    lat: 26.9124,
    lng: 75.7873,
    pincode: '302001',
    areas: [
      { id: 'RJ-JAI-GENERAL', name: 'General / All Jaipur', lat: 26.9124, lng: 75.7873 },
      { id: 'RJ-JAI-MALVIYA', name: 'Malviya Nagar', pincode: '302017', lat: 26.8520, lng: 75.8130 },
      { id: 'RJ-JAI-VAISHALI', name: 'Vaishali Nagar', pincode: '302021', lat: 26.9030, lng: 75.7480 },
      { id: 'RJ-JAI-CSCHEME', name: 'C-Scheme', pincode: '302001', lat: 26.9100, lng: 75.8000 },
      { id: 'RJ-JAI-MANSAROVAR', name: 'Mansarovar', pincode: '302020', lat: 26.8680, lng: 75.7650 },
    ],
  },
  {
    id: 'UP-LKO',
    stateId: 'UP',
    name: 'Lucknow',
    lat: 26.8467,
    lng: 80.9462,
    pincode: '226001',
    areas: [
      { id: 'UP-LKO-GENERAL', name: 'General / All Lucknow', lat: 26.8467, lng: 80.9462 },
      { id: 'UP-LKO-GOMTI', name: 'Gomti Nagar', pincode: '226010', lat: 26.8500, lng: 81.0000 },
      { id: 'UP-LKO-HAZRAT', name: 'Hazratganj', pincode: '226001', lat: 26.8480, lng: 80.9450 },
      { id: 'UP-LKO-ALIGANJ', name: 'Aliganj', pincode: '226024', lat: 26.8920, lng: 80.9380 },
      { id: 'UP-LKO-INDIRA', name: 'Indira Nagar', pincode: '226016', lat: 26.8850, lng: 80.9950 },
    ],
  },
  {
    id: 'MP-IND',
    stateId: 'MP',
    name: 'Indore',
    lat: 22.7196,
    lng: 75.8577,
    pincode: '452001',
    areas: [
      { id: 'MP-IND-GENERAL', name: 'General / All Indore', lat: 22.7196, lng: 75.8577 },
      { id: 'MP-IND-VIJAY', name: 'Vijay Nagar', pincode: '452010', lat: 22.7533, lng: 75.8937 },
      { id: 'MP-IND-PALASIA', name: 'Old & New Palasia', pincode: '452001', lat: 22.7244, lng: 75.8839 },
      { id: 'MP-IND-BHAWARKUA', name: 'Bhawarkua', pincode: '452001', lat: 22.6926, lng: 75.8676 },
      { id: 'MP-IND-RAJWADA', name: 'Rajwada', pincode: '452002', lat: 22.7186, lng: 75.8550 },
      { id: 'MP-IND-SUPERCORRIDOR', name: 'Super Corridor', pincode: '452005', lat: 22.7712, lng: 75.8021 },
    ],
  },
];

export function findMasterCity(query: string): MasterCity | null {
  const clean = query.trim().toLowerCase();
  for (const c of MASTER_CITIES) {
    if (c.name.toLowerCase() === clean || c.id.toLowerCase() === clean) {
      return c;
    }
  }
  for (const c of MASTER_CITIES) {
    if (c.name.toLowerCase().includes(clean) || clean.includes(c.name.toLowerCase())) {
      return c;
    }
  }
  return null;
}

export function generateFallbackAreas(cityName: string, cityId: string): MasterArea[] {
  const clean = cityName.trim();
  const slug = cityId.toUpperCase();
  return [
    { id: `${slug}-GENERAL`, name: `General / All ${clean}` },
    { id: `${slug}-CENTER`, name: `${clean} City Center / Main Market` },
    { id: `${slug}-STATION`, name: `Station Road / Civil Lines` },
    { id: `${slug}-EAST`, name: `${clean} East` },
    { id: `${slug}-WEST`, name: `${clean} West` },
    { id: `${slug}-NORTH`, name: `${clean} North` },
    { id: `${slug}-SOUTH`, name: `${clean} South` },
    { id: `${slug}-HIGHWAY`, name: `Ring Road / Highway Zone` },
  ];
}
