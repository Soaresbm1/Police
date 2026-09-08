import type { RNG } from "../random/rng";
import type { Location, LocationType } from "../types/location";
import { WIFI_SSID_PREFIXES } from "./data";
import { districtForCoordinates } from "./city";

const TOWN_SIZE_KM = 8;

interface InfraTemplate {
  type: LocationType;
  namePool: string[];
  count: number;
  cameraChance: number;
  wifiChance: number;
  badgeChance: number;
  openingHours: { open: number; close: number } | null;
}

const INFRA_TEMPLATES: InfraTemplate[] = [
  {
    type: "police_station",
    namePool: ["Commissariat central de Vironval"],
    count: 1,
    cameraChance: 1,
    wifiChance: 0.5,
    badgeChance: 1,
    openingHours: null,
  },
  {
    type: "restaurant",
    namePool: ["Le Vieux Pont", "La Table de Julie", "Chez Antoine", "Le Cerf"],
    count: 2,
    cameraChance: 0.6,
    wifiChance: 0.8,
    badgeChance: 0,
    openingHours: { open: 11 * 60, close: 23 * 60 },
  },
  {
    type: "bar",
    namePool: ["Le Nocturne", "Bar des Sports", "L'Escale"],
    count: 1,
    cameraChance: 0.7,
    wifiChance: 0.7,
    badgeChance: 0,
    openingHours: { open: 17 * 60, close: 2 * 60 },
  },
  {
    type: "bank",
    namePool: ["Banque Cantonale de Vironval", "Crédit Régional"],
    count: 1,
    cameraChance: 1,
    wifiChance: 0.2,
    badgeChance: 1,
    openingHours: { open: 8 * 60, close: 17 * 60 },
  },
  {
    type: "pharmacy",
    namePool: ["Pharmacie du Centre", "Pharmacie de la Gare"],
    count: 1,
    cameraChance: 0.8,
    wifiChance: 0.1,
    badgeChance: 0,
    openingHours: { open: 8 * 60, close: 19 * 60 },
  },
  {
    type: "hospital",
    namePool: ["Hôpital régional de Vironval"],
    count: 1,
    cameraChance: 0.9,
    wifiChance: 0.9,
    badgeChance: 1,
    openingHours: null,
  },
  {
    type: "train_station",
    namePool: ["Gare de Vironval"],
    count: 1,
    cameraChance: 0.9,
    wifiChance: 0.9,
    badgeChance: 0,
    openingHours: null,
  },
  {
    type: "gas_station",
    namePool: ["Station-service Nord", "Station-service Sud"],
    count: 2,
    cameraChance: 0.95,
    wifiChance: 0.3,
    badgeChance: 0,
    openingHours: null,
  },
  {
    type: "shop",
    namePool: ["Épicerie du Marché", "Superette Migros", "Boutique Coop"],
    count: 2,
    cameraChance: 0.8,
    wifiChance: 0.2,
    badgeChance: 0,
    openingHours: { open: 7 * 60, close: 20 * 60 },
  },
  {
    type: "hotel",
    namePool: ["Hôtel du Lac", "Auberge des Voyageurs"],
    count: 1,
    cameraChance: 0.85,
    wifiChance: 0.9,
    badgeChance: 1,
    openingHours: null,
  },
  {
    type: "park",
    namePool: ["Parc des Tilleuls", "Jardin public"],
    count: 1,
    cameraChance: 0.2,
    wifiChance: 0,
    badgeChance: 0,
    openingHours: null,
  },
  {
    type: "warehouse",
    namePool: ["Entrepôt Lambert", "Dépôt municipal"],
    count: 1,
    cameraChance: 0.3,
    wifiChance: 0,
    badgeChance: 0.7,
    openingHours: null,
  },
  {
    type: "parking",
    namePool: ["Parking de la Gare", "Parking du Centre"],
    count: 2,
    cameraChance: 0.6,
    wifiChance: 0,
    badgeChance: 0.3,
    openingHours: null,
  },
  {
    type: "office",
    namePool: ["Immeuble de bureaux Riviera", "Centre d'affaires du Stand"],
    count: 2,
    cameraChance: 0.7,
    wifiChance: 0.9,
    badgeChance: 0.9,
    openingHours: { open: 7 * 60, close: 19 * 60 },
  },
];

function chance(rng: RNG, p: number): boolean {
  return rng.bool(p);
}

function randomCoordinates(rng: RNG): { x: number; y: number } {
  return { x: rng.range(0, TOWN_SIZE_KM), y: rng.range(0, TOWN_SIZE_KM) };
}

/** Address + district, drawn together so the street always belongs to the
 * district the coordinates actually fall in (see world/city.ts). */
function addressFor(rng: RNG, coordinates: { x: number; y: number }): { address: string; district: string } {
  const district = districtForCoordinates(coordinates.x, coordinates.y);
  const street = rng.pick(district.streets);
  const num = rng.int(1, 90);
  return { address: `${num}, ${street}`, district: district.name };
}

/** Generates the fixed public infrastructure of the town: everything that
 * isn't someone's private home or workplace-of-convenience. */
export function generateTownInfrastructure(rng: RNG): Location[] {
  const locations: Location[] = [];
  for (const template of INFRA_TEMPLATES) {
    const names = rng.shuffle(template.namePool);
    for (let i = 0; i < template.count; i++) {
      const name = names[i % names.length];
      const hasWifi = chance(rng, template.wifiChance);
      const hasCameras = chance(rng, template.cameraChance);
      const coordinates = randomCoordinates(rng);
      const { address, district } = addressFor(rng, coordinates);
      locations.push({
        id: rng.id("loc"),
        name,
        type: template.type,
        address,
        district,
        coordinates,
        hasCameras,
        cameraZones: hasCameras ? ["entrée", "intérieur"] : [],
        hasWifi,
        wifiSsid: hasWifi ? `${rng.pick(WIFI_SSID_PREFIXES)}-${template.type}` : null,
        hasBadgeAccess: chance(rng, template.badgeChance),
        openingHours: template.openingHours,
        employeePersonIds: [],
        residentPersonIds: [],
      });
    }
  }
  return locations;
}

/** Creates a fresh private residence (apartment or house). */
export function createHomeLocation(rng: RNG, wealthChf: number): Location {
  const isHouse = wealthChf > 400_000 && chance(rng, 0.6);
  const type: LocationType = isHouse ? "house" : "apartment";
  const hasWifi = chance(rng, 0.85);
  const coordinates = randomCoordinates(rng);
  const { address, district } = addressFor(rng, coordinates);
  return {
    id: rng.id("loc"),
    name: isHouse ? "Maison privée" : "Appartement privé",
    type,
    address,
    district,
    coordinates,
    hasCameras: chance(rng, isHouse ? 0.25 : 0.1),
    cameraZones: [],
    hasWifi,
    wifiSsid: hasWifi ? `Domicile-${rng.id("wifi")}` : null,
    hasBadgeAccess: !isHouse && chance(rng, 0.4),
    openingHours: null,
    employeePersonIds: [],
    residentPersonIds: [],
  };
}
