// Deterministic Indian-format test data (fictitious names only). Same output on every run.
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Valid GSTIN: 2-digit state + PAN + entity digit + 'Z' + mod-36 check character. */
export function gstin(state: string, pan: string, entity = '1'): string {
  const body = `${state}${pan}${entity}Z`;
  let sum = 0;
  [...body].forEach((c, i) => {
    const prod = CH.indexOf(c) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  });
  return body + CH[(36 - (sum % 36)) % 36];
}

/** PAN shape AAAAA9999A built from a number so it is stable and unique. */
export function pan(n: number): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const a = (k: number) => L[(n * 7 + k * 5) % L.length];
  return `${a(1)}${a(2)}${a(3)}${a(4)}${a(5)}${String(1000 + ((n * 137) % 9000))}${a(6)}`;
}

export function mobile(n: number): string {
  return `${['9', '8', '7'][n % 3]}${String(100000000 + ((n * 7919123) % 899999999)).slice(0, 9)}`;
}

const CITIES: [string, string][] = [['Pune', '27'], ['Mumbai', '27'], ['Nashik', '27'], ['Nagpur', '27'], ['Aurangabad', '27'], ['Kolhapur', '27'], ['Ahmedabad', '24'], ['Bengaluru', '29']];
const CUST = ['Asha Steel Works', 'Bharat Fabricators', 'Citra Engineering', 'Deccan Auto Components', 'Everest Precision Tools', 'Falcon Powertrain', 'Ganga Castings', 'Hindustan Gearbox', 'Indus Motors', 'Jai Hind Forge', 'Kiran Hydraulics', 'Lotus Switchgear', 'Mahalaxmi Alloys', 'Navkar Machines', 'Omkar Pumps', 'Pragati Valves', 'Quest Automation', 'Rajhans Wire Products', 'Shivneri Cables', 'Tulsi Fasteners'];
const SUPP = ['Alfa Metals', 'Bhavani Steel Traders', 'Chaitanya Copper', 'Dhanlaxmi Bearings', 'Eagle Packaging', 'Fortune Polymers', 'Gajanan Tools', 'Harsh Electricals', 'Ishwar Magnets', 'Jaykar Coatings', 'Krishna Fasteners', 'Laxmi Lubricants', 'Mangal Castings', 'Nirmal Abrasives', 'Om Sai Wires', 'Parag Enamel', 'Rasika Rubber', 'Samarth Laminations', 'Trimurti Springs', 'Uday Industrial Gases'];

export interface Party { name: string; gstin: string; city: string; mobile: string }
export function parties(kind: 'C' | 'S'): Party[] {
  const names = kind === 'C' ? CUST : SUPP;
  return names.map((n, i) => {
    const [city, st] = CITIES[i % CITIES.length]!;
    return { name: `${n} Pvt Ltd`, gstin: gstin(st, pan(i + (kind === 'C' ? 1 : 101))), city, mobile: mobile(i + (kind === 'C' ? 3 : 53)) };
  });
}

export interface Item { code: string; name: string; type: string; category: string; hsn: string; uom: string; cost: number; price: number; reorder: number }
const RM = ['MS Plate 10mm', 'MS Plate 6mm', 'SS 304 Sheet 2mm', 'GI Sheet 1.2mm', 'Copper Wire 1.5 sqmm', 'Copper Wire 2.5 sqmm', 'Aluminium Bar 25mm', 'Silicon Steel Lamination', 'Neodymium Magnet N42', 'Epoxy Powder Coat Grey', 'Enamelled Wire 0.5mm', 'MS Round Bar 20mm', 'Brass Rod 12mm', 'Insulation Paper', 'Cast Iron Block'];
const FG = ['BLDC Motor 250W', 'BLDC Motor 500W', 'BLDC Motor 1kW', 'Servo Drive 2kW', 'Gear Box 1:10', 'Gear Box 1:20', 'SPPM Machine Model A', 'SPPM Machine Model B', 'Control Panel 3-Phase', 'Pump Assembly 1HP', 'Pump Assembly 3HP', 'Wiring Harness Type 1', 'Wiring Harness Type 2', 'Fan Motor 120W', 'Winding Machine Std'];
const SP = ['Ball Bearing 6204', 'Ball Bearing 6305', 'Oil Seal 35mm', 'Coupling 20mm', 'V-Belt B52', 'Contactor 25A', 'Relay 24V', 'Limit Switch', 'Proximity Sensor', 'Fuse 16A', 'Carbon Brush', 'Gasket Set', 'Hydraulic Hose 1m', 'Pressure Gauge', 'Cutting Insert CNMG'];
const CN = ['Cutting Oil 20L', 'Grease EP2 1kg', 'Welding Rod 3.15mm', 'Abrasive Disc 4in', 'Cotton Waste 5kg', 'Safety Gloves', 'Safety Goggles', 'Masking Tape', 'Packing Tape', 'Cable Tie 200mm', 'Paint Thinner 5L', 'Degreaser 5L', 'Stretch Film', 'Corrugated Box Large', 'Label Roll 100x50'];
export const ITEMS: Item[] = [
  ...RM.map((n, i) => mk('RM', n, 'Raw Material', '720810', 'KG', 80 + i * 12, 0, 200, i)),
  ...FG.map((n, i) => mk('FG', n, 'Finished Goods', '850110', 'NOS', 4000 + i * 650, 5200 + i * 800, 10, i)),
  ...SP.map((n, i) => mk('SP', n, 'Spare', '848210', 'NOS', 150 + i * 40, 0, 20, i)),
  ...CN.map((n, i) => mk('CN', n, 'Consumable', '340319', 'NOS', 60 + i * 15, 0, 50, i)),
];
function mk(prefix: string, name: string, type: string, hsn: string, uom: string, cost: number, price: number, reorder: number, i: number): Item {
  return { code: `${prefix}-${String(i + 1).padStart(3, '0')}`, name, type, category: type, hsn, uom, cost, price, reorder };
}

// ---- people (fictitious) ----
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
/** 12-digit Aadhaar-shaped number with a valid Verhoeff check digit (first digit 2-9). */
export function aadhaar(n: number): string {
  const base = String(200000000000 + ((n * 7919377) % 700000000000)).slice(0, 11);
  let c = 0;
  [...base].reverse().forEach((ch, i) => { c = D[c]![P[(i + 1) % 8]![Number(ch)]!]!; });
  return base + String(INV[c]);
}
export function personPan(n: number): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const a = (k: number) => L[(n * 11 + k * 7) % L.length];
  return `${a(1)}${a(2)}${a(3)}P${a(4)}${String(1000 + ((n * 313) % 9000))}${a(5)}`;
}
const FIRST = ['Aarav', 'Vihaan', 'Aditya', 'Arjun', 'Rohan', 'Sneha', 'Pooja', 'Anjali', 'Kavya', 'Ritu', 'Nikhil', 'Sagar', 'Tejas', 'Omkar', 'Pranav', 'Shruti', 'Neha', 'Madhuri', 'Swapnil', 'Akash'];
const LAST = ['Kulkarni', 'Patil', 'Shinde', 'Joshi', 'Deshmukh', 'Pawar', 'More', 'Jadhav', 'Gaikwad', 'Chavan'];
export interface Person { first: string; last: string; gender: string; dept: string; plant: string; dob: string; doj: string; mobile: string; aadhaar: string; pan: string }
const DEPTS = ['Production', 'Quality', 'Warehouse', 'Purchase', 'Sales', 'Maintenance', 'Finance', 'HR'];
export const PEOPLE: Person[] = Array.from({ length: 40 }, (_, i) => ({
  first: FIRST[i % FIRST.length]!,
  last: LAST[(i * 3) % LAST.length]!,
  gender: i % 3 === 1 ? 'Female' : 'Male',
  dept: DEPTS[i % DEPTS.length]!,
  plant: ['Talwade', 'Sawardari', 'Varale'][i % 3]!,
  dob: `${1975 + (i % 25)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + ((i * 3) % 27)).padStart(2, '0')}`,
  doj: `${2015 + (i % 10)}-${String(1 + ((i + 5) % 12)).padStart(2, '0')}-${String(1 + ((i * 5) % 27)).padStart(2, '0')}`,
  mobile: mobile(i + 200),
  aadhaar: aadhaar(i + 1),
  pan: personPan(i + 1),
}));
