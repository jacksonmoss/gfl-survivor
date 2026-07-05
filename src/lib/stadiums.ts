// NFL stadium coordinates + indoor flag, keyed by home-team abbreviation.
// Static data — used to look up weather (see src/lib/weather.ts). City-level
// lat/lon is plenty for a forecast; no external geocoding needed.
//
// `indoor` means "no weather on the field": fixed domes, fixed-roof stadiums
// (SoFi's canopy), AND retractable-roof stadiums (which we treat as indoor —
// the roof is usually closed in bad weather, so a forecast would mislead).
//
// NOTE: this list was double-checked against the ticket, which incorrectly
// listed Seattle (Lumen Field) as retractable. Lumen Field is OPEN-AIR — only
// the seating bowl is roofed, the field is exposed — so SEA is outdoor here.
// MetLife (NYG/NYJ) is also open-air. The indoor teams are exactly:
// ARI, ATL, DAL, DET, HOU, IND, LV, LAC, LAR, MIN, NO (11 teams, 10 stadiums).

export interface Stadium {
  /** Home-team abbreviation (matches src/lib/nfl-teams.ts). */
  team: string;
  name: string;
  lat: number;
  lon: number;
  /** True for domes / fixed roofs / retractable roofs — skip weather. */
  indoor: boolean;
}

export const STADIUMS: Record<string, Stadium> = {
  ARI: { team: "ARI", name: "State Farm Stadium", lat: 33.5276, lon: -112.2626, indoor: true }, // retractable
  ATL: { team: "ATL", name: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.4008, indoor: true }, // retractable
  BAL: { team: "BAL", name: "M&T Bank Stadium", lat: 39.278, lon: -76.6227, indoor: false },
  BUF: { team: "BUF", name: "Highmark Stadium", lat: 42.7738, lon: -78.787, indoor: false },
  CAR: { team: "CAR", name: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, indoor: false },
  CHI: { team: "CHI", name: "Soldier Field", lat: 41.8623, lon: -87.6167, indoor: false },
  CIN: { team: "CIN", name: "Paycor Stadium", lat: 39.0954, lon: -84.516, indoor: false },
  CLE: { team: "CLE", name: "Huntington Bank Field", lat: 41.5061, lon: -81.6995, indoor: false },
  DAL: { team: "DAL", name: "AT&T Stadium", lat: 32.7473, lon: -97.0945, indoor: true }, // retractable
  DEN: { team: "DEN", name: "Empower Field at Mile High", lat: 39.7439, lon: -105.0201, indoor: false },
  DET: { team: "DET", name: "Ford Field", lat: 42.34, lon: -83.0456, indoor: true }, // fixed dome
  GB: { team: "GB", name: "Lambeau Field", lat: 44.5013, lon: -88.0622, indoor: false },
  HOU: { team: "HOU", name: "NRG Stadium", lat: 29.6847, lon: -95.4107, indoor: true }, // retractable
  IND: { team: "IND", name: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, indoor: true }, // retractable
  JAX: { team: "JAX", name: "EverBank Stadium", lat: 30.3239, lon: -81.6373, indoor: false },
  KC: { team: "KC", name: "Arrowhead Stadium", lat: 39.0489, lon: -94.4839, indoor: false },
  LV: { team: "LV", name: "Allegiant Stadium", lat: 36.0909, lon: -115.1833, indoor: true }, // fixed dome
  LAC: { team: "LAC", name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, indoor: true }, // fixed roof
  LAR: { team: "LAR", name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, indoor: true }, // fixed roof
  MIA: { team: "MIA", name: "Hard Rock Stadium", lat: 25.958, lon: -80.2389, indoor: false }, // canopy, field open
  MIN: { team: "MIN", name: "U.S. Bank Stadium", lat: 44.9736, lon: -93.2575, indoor: true }, // fixed dome
  NE: { team: "NE", name: "Gillette Stadium", lat: 42.0909, lon: -71.2643, indoor: false },
  NO: { team: "NO", name: "Caesars Superdome", lat: 29.9511, lon: -90.0812, indoor: true }, // fixed dome
  NYG: { team: "NYG", name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, indoor: false },
  NYJ: { team: "NYJ", name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, indoor: false },
  PHI: { team: "PHI", name: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, indoor: false },
  PIT: { team: "PIT", name: "Acrisure Stadium", lat: 40.4468, lon: -80.0158, indoor: false },
  SF: { team: "SF", name: "Levi's Stadium", lat: 37.403, lon: -121.97, indoor: false },
  SEA: { team: "SEA", name: "Lumen Field", lat: 47.5952, lon: -122.3316, indoor: false }, // open-air (NOT retractable)
  TB: { team: "TB", name: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, indoor: false },
  TEN: { team: "TEN", name: "Nissan Stadium", lat: 36.1665, lon: -86.7713, indoor: false },
  WAS: { team: "WAS", name: "Northwest Stadium", lat: 38.9078, lon: -76.8645, indoor: false },
};

export function getStadium(abbr: string): Stadium | null {
  return STADIUMS[abbr] ?? null;
}

export function isIndoorStadium(abbr: string): boolean {
  return STADIUMS[abbr]?.indoor ?? false;
}
