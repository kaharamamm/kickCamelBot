const YENIMAHALLE = { lat: 39.9667, lon: 32.7833 };
const TTL_MS = 10 * 60_000;

let cache: { at: number; text: string } | undefined;
let pending: Promise<string> | undefined;

const WMO: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "rime fog",
  51: "light drizzle",
  53: "drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  80: "rain showers",
  95: "thunder",
};

export async function yenimahalleWeather(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  if (pending) return pending;
  pending = fetchWeather()
    .catch(() => cache?.text ?? "Yenimahalle weather unavailable right now.")
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function weatherCached(): string {
  return cache?.text ?? "Yenimahalle weather not fetched yet.";
}

async function fetchWeather(): Promise<string> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${YENIMAHALLE.lat}&longitude=${YENIMAHALLE.lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Europe%2FIstanbul`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  };
  const cur = json.current;
  if (!cur || typeof cur.temperature_2m !== "number") throw new Error("no weather");
  const code = Number(cur.weather_code) || 0;
  const sky = WMO[code] ?? "weird sky";
  const text =
    `Yenimahalle/Ankara right now: ${Math.round(cur.temperature_2m)}°C, ${sky}, ` +
    `humidity ${Math.round(cur.relative_humidity_2m ?? 0)}%, wind ${Math.round(cur.wind_speed_10m ?? 0)} km/h.`;
  cache = { at: Date.now(), text };
  return text;
}
