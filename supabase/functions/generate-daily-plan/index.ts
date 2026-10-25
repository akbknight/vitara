import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { Temporal } from "npm:@js-temporal/polyfill@0.5.1";
import { CalculationMethod, Coordinates, PrayerTimes } from "npm:adhan@4.4.6";

type Clock = Temporal.ZonedDateTime;
type Json = Record<string, unknown>;
export interface Profile {
  id: string;
  full_name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  cultural_heritages: string[];
  dietary_pattern: string;
  metabolic_flags: string[];
  ramadan_mode: boolean;
  wake_time: string;
  sleep_time: string;
  chronotype: "early_bird" | "intermediate" | "night_owl" | "night_shift";
}
export interface Food extends Json {
  id: string;
  meal_slot: string[];
  gl_score: number;
  fiber_g: number;
}
export interface Workout extends Json {
  id: string;
  title: string;
  environment: "indoor" | "outdoor";
  intensity: string;
  duration_mins: number;
  swap_pair_id: string;
}
export interface Block extends Json {
  id: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  local_start: string;
  local_end: string;
  timezone: string;
  food_slot?: string;
  workout?: Workout;
}
interface RamadanInput {
  calculation_method?: string;
  fajr_at?: string;
  iftar_at?: string;
  next_fajr_at?: string;
}
interface Input {
  plan_date?: string;
  ramadan?: RamadanInput;
}
export class PlanError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const fail = (code: string, message: string): never => {
  throw new PlanError(422, code, message);
};
const compare = Temporal.ZonedDateTime.compare;
const minutes = (a: Clock, b: Clock) =>
  (b.epochMilliseconds - a.epochMilliseconds) / 60_000;
const plus = (t: Clock, m: number) => t.add({ minutes: m });
const instant = (s: string, zone: string) =>
  Temporal.Instant.from(s).toZonedDateTimeISO(zone);
const iso = (t: Clock) => t.toInstant().toString();

function at(date: Temporal.PlainDate, time: string, timezone: string): Clock {
  // Compatible = earlier occurrence during a fall overlap, shift forward during a spring gap.
  return date.toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(
    timezone,
    {
      disambiguation: "compatible",
    },
  );
}

export function cycle(profile: Profile, date: Temporal.PlainDate) {
  const wake = at(date, profile.wake_time, profile.timezone);
  let sleep = at(date, profile.sleep_time, profile.timezone);
  if (compare(sleep, wake) <= 0) {
    sleep = at(date.add({ days: 1 }), profile.sleep_time, profile.timezone);
  }
  const awake = minutes(wake, sleep);
  if (awake < 10 * 60 || awake > 20 * 60) {
    fail(
      "INVALID_SLEEP_WINDOW",
      "Set wake_time and sleep_time to an awake interval of 10–20 hours.",
    );
  }
  return { wake, sleep, awake };
}

export function defaultPlanDate(
  profile: Profile,
  now: Clock,
): Temporal.PlainDate {
  const today = now.toPlainDate();
  if (profile.ramadan_mode) return today; // Ramadan plan_date is the fasting civil date.
  const yesterday = cycle(profile, today.subtract({ days: 1 }));
  // After midnight, keep the ongoing night-shift wake cycle's date.
  return compare(now, yesterday.wake) >= 0 && compare(now, yesterday.sleep) < 0
    ? today.subtract({ days: 1 })
    : today;
}

function block(
  id: string,
  kind: string,
  title: string,
  start: Clock,
  duration: number,
  extra: Json = {},
): Block {
  const end = plus(start, duration);
  return {
    id,
    kind,
    title,
    starts_at: iso(start),
    ends_at: iso(end),
    local_start: start.toString(),
    local_end: end.toString(),
    timezone: start.timeZoneId,
    ...extra,
  };
}

const prayerMethods = {
  MuslimWorldLeague: CalculationMethod.MuslimWorldLeague,
  Egyptian: CalculationMethod.Egyptian,
  Karachi: CalculationMethod.Karachi,
  UmmAlQura: CalculationMethod.UmmAlQura,
  Dubai: CalculationMethod.Dubai,
  MoonsightingCommittee: CalculationMethod.MoonsightingCommittee,
  NorthAmerica: CalculationMethod.NorthAmerica,
  Kuwait: CalculationMethod.Kuwait,
  Qatar: CalculationMethod.Qatar,
  Singapore: CalculationMethod.Singapore,
  Tehran: CalculationMethod.Tehran,
  Turkey: CalculationMethod.Turkey,
};

function fastingTimes(
  profile: Profile,
  date: Temporal.PlainDate,
  input?: RamadanInput,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail(
      "RAMADAN_TIMES_REQUIRED",
      "Supply ramadan.calculation_method or an exact fajr_at, iftar_at, next_fajr_at timetable with UTC offsets.",
    );
  }
  let fajr: Clock, iftar: Clock, nextFajr: Clock;
  let source: string;
  if (input.fajr_at || input.iftar_at || input.next_fajr_at) {
    if (
      ![input.fajr_at, input.iftar_at, input.next_fajr_at].every((x) =>
        typeof x === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(x)
      )
    ) {
      return fail(
        "INVALID_RAMADAN_TIMETABLE",
        "All three timetable timestamps must include a UTC offset or Z.",
      );
    }
    try {
      fajr = instant(input.fajr_at!, profile.timezone);
      iftar = instant(input.iftar_at!, profile.timezone);
      nextFajr = instant(input.next_fajr_at!, profile.timezone);
    } catch {
      return fail(
        "INVALID_RAMADAN_TIMETABLE",
        "Invalid prayer timetable timestamp.",
      );
    }
    source = "user_local_timetable";
  } else {
    const method = input.calculation_method;
    if (!method || !Object.hasOwn(prayerMethods, method)) {
      return fail(
        "INVALID_PRAYER_METHOD",
        `Choose one of: ${Object.keys(prayerMethods).join(", ")}.`,
      );
    }
    const calculate = (day: Temporal.PlainDate) => {
      // Adhan reads local date fields (not timezone). Construct a date whose host-local
      // fields equal the requested civil day; the result prayer instants are UTC.
      const civil = new Date(day.year, day.month - 1, day.day, 12);
      return new PrayerTimes(
        new Coordinates(profile.latitude, profile.longitude),
        civil,
        prayerMethods[method as keyof typeof prayerMethods](),
      );
    };
    try {
      const today = calculate(date);
      fajr = instant(today.fajr.toISOString(), profile.timezone);
      iftar = instant(today.maghrib.toISOString(), profile.timezone);
      nextFajr = instant(
        calculate(date.add({ days: 1 })).fajr.toISOString(),
        profile.timezone,
      );
    } catch {
      return fail(
        "PRAYER_TIMES_UNAVAILABLE",
        "Provide a local timetable for this location and date; astronomical prayer times are unavailable.",
      );
    }
    source = `adhan:${method}`;
  }
  if (
    !fajr.toPlainDate().equals(date) || !iftar.toPlainDate().equals(date) ||
    !nextFajr.toPlainDate().equals(date.add({ days: 1 })) ||
    minutes(fajr, iftar) <= 0 || minutes(iftar, nextFajr) < 240
  ) {
    return fail(
      "INVALID_FASTING_WINDOW",
      "Prayer times must match the profile timezone and plan date, with at least four hours between Iftar and next Fajr.",
    );
  }
  return { fajr, iftar, nextFajr, source };
}

export function buildSchedule(
  profile: Profile,
  date: Temporal.PlainDate,
  workout: Workout,
  ramadan?: RamadanInput,
) {
  const { wake, sleep, awake } = cycle(profile, date);
  const notes: string[] = [];
  let blocks: Block[];
  let fasting: Json | null = null;
  if (!profile.ramadan_mode) {
    const breakfast = plus(wake, 45);
    const dinner = plus(sleep, -180);
    const lunch = plus(wake, Math.round(awake * 0.40));
    const snack = plus(lunch, Math.round(minutes(lunch, dinner) * 0.5));
    // These are transparent coaching offsets, not measured physiological peaks.
    const offset = {
      early_bird: 120,
      intermediate: 180,
      night_owl: 240,
      night_shift: 120,
    }[profile.chronotype];
    const exercise = plus(wake, Math.min(offset, Math.floor(awake * 0.25)));
    blocks = [
      block("hydration", "hydration", "Hydration", wake, 5),
      block("breakfast", "meal", "Breakfast", breakfast, 25, {
        food_slot: "breakfast",
      }),
      block(
        "peak_workout",
        "workout",
        "Peak Energy Workout",
        exercise,
        workout.duration_mins,
        { workout, timing_basis: "chronotype_offset_heuristic" },
      ),
      block("lunch", "meal", "Lunch", lunch, 25, { food_slot: "lunch" }),
      block(
        "glucose_walk",
        "walk",
        "15-minute post-meal glucose walk",
        plus(lunch, 30),
        15,
      ),
      block("snack", "meal", "Afternoon Snack", snack, 15, {
        food_slot: "snack",
      }),
      block("dinner", "meal", "Dinner", dinner, 30, {
        food_slot: "dinner",
        timing_basis: "sleep_minus_3_hours",
      }),
      block("wind_down", "wind_down", "Wind-Down", plus(sleep, -60), 30),
    ];
  } else {
    const { fajr, iftar, nextFajr, source } = fastingTimes(
      profile,
      date,
      ramadan,
    );
    // Iftar and evening exercise must fit the actual awake interval, including
    // overnight shifts. Do not silently schedule a workout during primary sleep.
    if (compare(iftar, wake) < 0 || compare(iftar, sleep) >= 0) {
      return fail(
        "RAMADAN_SLEEP_CONFLICT",
        "Set your Ramadan wake/sleep schedule to include Iftar and the following evening activities. Suhoor alone can use a separate wake alarm.",
      );
    }
    const eveningSleep = sleep;
    const feedingEnd = compare(plus(eveningSleep, -60), plus(nextFajr, -60)) < 0
      ? plus(eveningSleep, -60)
      : plus(nextFajr, -60);
    if (minutes(iftar, feedingEnd) < 180) {
      return fail(
        "RAMADAN_SLEEP_CONFLICT",
        "The post-Iftar meal, walk, workout and snack need at least three hours before wind-down or pre-Fajr preparation. Update your Ramadan sleep schedule or local prayer timetable.",
      );
    }
    const preferredDinner = plus(eveningSleep, -180);
    const earliestDinner = plus(iftar, 60);
    const latestDinner = plus(feedingEnd, -120);
    const dinner = compare(preferredDinner, earliestDinner) < 0
      ? earliestDinner
      : compare(preferredDinner, latestDinner) > 0
      ? latestDinner
      : preferredDinner;
    const exercise = plus(dinner, 60);
    const snack = plus(exercise, workout.duration_mins + 15);
    if (compare(dinner, preferredDinner) !== 0) {
      notes.push(
        "Dinner moved from sleep minus three hours to fit the non-fasting window and recovery time.",
      );
    }
    notes.push(
      "Breakfast is Suhoor; lunch and its walk move to Iftar; afternoon snack moves after the evening workout. Suhoor may interrupt primary sleep and requires an explicit wake alarm.",
    );
    fasting = {
      fajr_at: iso(fajr),
      iftar_at: iso(iftar),
      next_fajr_at: iso(nextFajr),
      source,
    };
    blocks = [
      block(
        "hydration",
        "hydration",
        "Pre-Suhoor hydration",
        plus(fajr, -50),
        5,
      ),
      block("breakfast", "meal", "Suhoor (Breakfast)", plus(fajr, -45), 30, {
        food_slot: "breakfast",
        wake_alarm_required: true,
      }),
      block("iftar_hydration", "hydration", "Iftar hydration", iftar, 0),
      block("lunch", "meal", "Iftar (rescheduled Lunch)", iftar, 25, {
        food_slot: "lunch",
      }),
      block(
        "glucose_walk",
        "walk",
        "15-minute post-Iftar glucose walk",
        plus(iftar, 30),
        15,
      ),
      block("dinner", "meal", "Dinner", dinner, 30, { food_slot: "dinner" }),
      block(
        "peak_workout",
        "workout",
        "Post-Iftar Energy Workout",
        exercise,
        workout.duration_mins,
        { workout, timing_basis: "ramadan_non_fasting_override" },
      ),
      block("snack", "meal", "Evening Snack", snack, 15, {
        food_slot: "snack",
      }),
      block("wind_down", "wind_down", "Wind-Down", plus(eveningSleep, -60), 30),
    ];
    for (
      const b of blocks.filter((b) =>
        ["meal", "hydration", "workout", "walk"].includes(b.kind)
      )
    ) {
      const start = instant(b.starts_at, profile.timezone),
        end = instant(b.ends_at, profile.timezone);
      if (
        (compare(start, iftar) < 0 && compare(end, fajr) > 0) ||
        compare(end, nextFajr) >= 0
      ) {
        return fail(
          "RAMADAN_SCHEDULE_CONFLICT",
          "The activity schedule does not fit outside fasting hours.",
        );
      }
    }
  }
  blocks.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (let i = 1; i < blocks.length; i++) {
    if (
      Temporal.Instant.compare(blocks[i - 1].ends_at, blocks[i].starts_at) > 0
    ) {
      fail(
        "SCHEDULE_CONFLICT",
        "The requested wake/sleep window produces overlapping activities.",
      );
    }
  }
  return { blocks, notes, fasting, wake_at: iso(wake), sleep_at: iso(sleep) };
}

export interface WeatherSample {
  time: number;
  precipitation: number | null;
  precipitation_probability: number | null;
  apparent_temperature: number | null;
}
export interface Weather {
  available: boolean;
  fetched_at: string;
  current: WeatherSample | null;
  hourly: WeatherSample[];
  reason?: string;
}
const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
export function weatherReasons(sample: WeatherSample | null): string[] {
  if (
    !sample || !finite(sample.precipitation) || sample.precipitation < 0 ||
    !finite(sample.precipitation_probability) ||
    sample.precipitation_probability < 0 ||
    sample.precipitation_probability > 100 ||
    !finite(sample.apparent_temperature)
  ) return ["weather_data_unavailable"];
  const reasons = [];
  if (sample.precipitation > 0) reasons.push("precipitation");
  if (sample.precipitation_probability > 50) {
    reasons.push("precipitation_probability_above_50");
  }
  if (sample.apparent_temperature < 4) {
    reasons.push("apparent_temperature_below_4c");
  }
  if (sample.apparent_temperature > 33) {
    reasons.push("apparent_temperature_above_33c");
  }
  return reasons;
}

export async function fetchWeather(
  profile: Profile,
  fetcher: typeof fetch = fetch,
): Promise<Weather> {
  const fetched_at = new Date().toISOString();
  const key = Deno.env.get("OPEN_METEO_API_KEY");
  const url = new URL(
    key
      ? "https://customer-api.open-meteo.com/v1/forecast"
      : "https://api.open-meteo.com/v1/forecast",
  );
  url.search = new URLSearchParams({
    latitude: String(profile.latitude),
    longitude: String(profile.longitude),
    current: "precipitation,precipitation_probability,apparent_temperature",
    hourly: "precipitation,precipitation_probability,apparent_temperature",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
    timezone: "UTC",
    timeformat: "unixtime",
    past_days: "2",
    forecast_days: "4",
    ...(key ? { apikey: key } : {}),
  }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("weather_http_error");
    const data = await response.json();
    if (
      data.current_units?.apparent_temperature !== "°C" ||
      data.current_units?.precipitation !== "mm" ||
      data.hourly_units?.apparent_temperature !== "°C" ||
      data.hourly_units?.precipitation !== "mm" ||
      !Array.isArray(data.hourly?.time)
    ) throw new Error("weather_invalid_response");
    const sample = (row: Json): WeatherSample => ({
      time: finite(row.time) ? row.time : NaN,
      precipitation: finite(row.precipitation) ? row.precipitation : null,
      precipitation_probability: finite(row.precipitation_probability)
        ? row.precipitation_probability
        : null,
      apparent_temperature: finite(row.apparent_temperature)
        ? row.apparent_temperature
        : null,
    });
    const current = sample(data.current ?? {});
    if (
      !finite(current.time) || Math.abs(Date.now() / 1000 - current.time) > 7200
    ) throw new Error("weather_stale_current");
    const hourly = data.hourly.time.map((t: unknown, i: number) =>
      sample({
        time: t,
        precipitation: data.hourly.precipitation?.[i],
        precipitation_probability: data.hourly.precipitation_probability?.[i],
        apparent_temperature: data.hourly.apparent_temperature?.[i],
      })
    ).filter((s: WeatherSample) => finite(s.time));
    return { available: true, fetched_at, current, hourly };
  } catch {
    // No invented weather and no error logging that could leak coordinates or API keys.
    return {
      available: false,
      fetched_at,
      current: null,
      hourly: [],
      reason: "weather_fetch_failed_or_invalid",
    };
  }
}

export function applyWeather(
  blocks: Block[],
  weather: Weather,
  workouts: Workout[],
) {
  const allReasons = new Set<string>();
  const checks: Json[] = [];
  for (
    const b of blocks.filter((b) => b.kind === "workout" || b.kind === "walk")
  ) {
    const reasons = new Set(weatherReasons(weather.current));
    const start = Temporal.Instant.from(b.starts_at).epochMilliseconds / 1000;
    const end = Temporal.Instant.from(b.ends_at).epochMilliseconds / 1000;
    // Check bounding hourly samples: precipitation describes the PRECEDING hour,
    // temperature is instantaneous. Both edges conservatively cover each activity.
    const firstHour = Math.floor(start / 3600) * 3600;
    const lastHour = Math.ceil(end / 3600) * 3600;
    for (let t = firstHour; t <= lastHour; t += 3600) {
      weatherReasons(weather.hourly.find((s) => s.time === t) ?? null).forEach((
        r,
      ) => reasons.add(r));
    }
    if (!weather.available) reasons.add("weather_data_unavailable");
    const override = reasons.size > 0;
    reasons.forEach((r) => allReasons.add(r));
    if (b.workout && override && b.workout.environment === "outdoor") {
      const pair = workouts.find((w) =>
        w.id === b.workout!.swap_pair_id && w.environment === "indoor"
      );
      if (
        !pair || pair.swap_pair_id !== b.workout.id ||
        pair.duration_mins !== b.workout.duration_mins ||
        pair.intensity !== b.workout.intensity
      ) {
        throw new PlanError(
          500,
          "WORKOUT_PAIR_INVALID",
          "The selected outdoor workout has no equivalent indoor pair.",
        );
      }
      b.original_workout_id = b.workout.id;
      b.workout = pair;
    }
    b.environment = b.workout?.environment ?? (override ? "indoor" : "outdoor");
    if (b.kind === "walk") {
      b.title = override
        ? "15-minute indoor post-meal walk"
        : "15-minute outdoor post-meal walk";
    }
    b.weather_override_reasons = [...reasons];
    checks.push({
      block_id: b.id,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      reasons: [...reasons],
    });
  }
  return {
    is_indoor_override: allReasons.size > 0,
    reasons: [...allReasons],
    activity_checks: checks,
  };
}

export function selectFood(
  foods: Food[],
  slot: string,
  seed: number,
  metabolic: boolean,
  used: Set<string>,
): Food {
  const options = foods.filter((f) => f.meal_slot.includes(slot));
  if (!options.length) {
    return fail(
      "NO_COMPATIBLE_FOOD",
      `No ${slot} dish matches the selected cultural heritages and dietary pattern. Add verified matching recipes to the catalog.`,
    );
  }
  const score = (f: Food) =>
    metabolic
      ? (Number(f.gl_score) <= 10 ? 0 : Number(f.gl_score) < 20 ? 1 : 2) * 100 -
        Math.min(Number(f.fiber_g), 30)
      : 0;
  options.sort((a, b) =>
    score(a) - score(b) || Number(used.has(a.id)) - Number(used.has(b.id)) ||
    a.id.localeCompare(b.id)
  );
  const best = options.filter((f) =>
    used.has(f.id) === used.has(options[0].id) && score(f) === score(options[0])
  );
  const result = best[((seed % best.length) + best.length) % best.length];
  used.add(result.id);
  return result;
}

function cors(request: Request): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
  });
  const origin = request.headers.get("Origin");
  const allowed = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map((x) =>
    x.trim()
  ).filter(Boolean);
  if (origin && allowed?.length && !allowed.includes(origin)) {
    throw new PlanError(
      403,
      "ORIGIN_DENIED",
      "This browser origin is not allowed.",
    );
  }
  headers.set(
    "Access-Control-Allow-Origin",
    allowed?.length ? origin ?? allowed[0] : "*",
  );
  // Bearer-token auth only; never allow cookie credentials with wildcard origins.
  return headers;
}

export async function handler(request: Request): Promise<Response> {
  let headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  try {
    headers = cors(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      throw new PlanError(405, "METHOD_NOT_ALLOWED", "Use POST.");
    }
    const authorization = request.headers.get("Authorization");
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      throw new PlanError(
        401,
        "UNAUTHENTICATED",
        "A user access token is required.",
      );
    }
    const url = Deno.env.get("SUPABASE_URL"),
      anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) {
      throw new PlanError(
        500,
        "SERVER_CONFIGURATION",
        "Supabase runtime configuration is missing.",
      );
    }
    const db = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data: auth, error: authError } = await db.auth.getUser(
      authorization.replace(/^Bearer\s+/i, ""),
    );
    if (authError || !auth.user) {
      throw new PlanError(
        401,
        "UNAUTHENTICATED",
        "The user access token is invalid or expired.",
      );
    }
    if (Number(request.headers.get("Content-Length") ?? 0) > 8192) {
      throw new PlanError(
        413,
        "BODY_TOO_LARGE",
        "Request body is limited to 8 KiB.",
      );
    }
    // Stream-limit even when Content-Length is omitted or supplied incorrectly.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          throw new PlanError(
            413,
            "BODY_TOO_LARGE",
            "Request body is limited to 8 KiB.",
          );
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, position);
      position += chunk.length;
    }
    let input: Input;
    try {
      input = size ? JSON.parse(new TextDecoder().decode(bytes)) : {};
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some((key) =>
          !["plan_date", "ramadan"].includes(key)
        ) ||
        (Object.hasOwn(input, "plan_date") &&
          (typeof input.plan_date !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(input.plan_date)))
      ) throw new Error();
    } catch {
      throw new PlanError(
        400,
        "INVALID_BODY",
        "Use a JSON object containing only plan_date and optional ramadan settings.",
      );
    }
    const { data: profile, error: profileError } = await db.from("profiles")
      .select("*").eq("id", auth.user.id).maybeSingle();
    if (profileError) {
      throw new PlanError(
        500,
        "PROFILE_READ_FAILED",
        "Could not read the profile.",
      );
    }
    if (!profile) {
      return fail(
        "PROFILE_REQUIRED",
        "Complete your profile before generating a plan.",
      );
    }
    const p = profile as Profile;
    let now: Clock, date: Temporal.PlainDate;
    try {
      now = Temporal.Now.zonedDateTimeISO(p.timezone);
      date = input.plan_date
        ? Temporal.PlainDate.from(input.plan_date)
        : defaultPlanDate(p, now);
      if (
        input.plan_date &&
        (typeof input.plan_date !== "string" ||
          input.plan_date !== date.toString())
      ) throw new Error();
    } catch (error) {
      if (error instanceof PlanError) throw error;
      return fail(
        "INVALID_DATE_OR_TIMEZONE",
        "Use an ISO YYYY-MM-DD plan_date and an IANA profile timezone.",
      );
    }
    const earliest = defaultPlanDate(p, now);
    if (
      Temporal.PlainDate.compare(date, earliest) < 0 ||
      Temporal.PlainDate.compare(date, now.toPlainDate().add({ days: 1 })) > 0
    ) {
      return fail(
        "DATE_OUT_OF_RANGE",
        "Generate a plan for the current wake cycle, today, or tomorrow.",
      );
    }
    const metabolic = p.metabolic_flags.some((f) =>
      ["t2d_family_history", "pcos"].includes(f)
    );
    // Compatibility uses tags rather than enum equality: a vegan dish also suits
    // lacto-vegetarian, eggetarian and halal eaters; uncertified meat never does.
    let foodQuery = db.from("cultural_foods").select("*")
      .in("culture", p.cultural_heritages).contains("dietary_tags", [
        p.dietary_pattern,
      ]);
    if (metabolic) {
      foodQuery = foodQuery.order("gl_score", { ascending: true }).order(
        "fiber_g",
        { ascending: false },
      );
    }
    const [foodResult, workoutResult] = await Promise.all([
      foodQuery.limit(1000),
      db.from("workouts").select("*").order("id"),
    ]);
    if (foodResult.error || workoutResult.error) {
      throw new PlanError(
        500,
        "CATALOG_READ_FAILED",
        "Could not read the food or workout catalog.",
      );
    }
    const foods = (foodResult.data ?? []) as Food[],
      workouts = (workoutResult.data ?? []) as Workout[];
    const pool = workouts.filter((w) =>
      w.environment === "outdoor" && w.intensity === "low" &&
      w.duration_mins <= 30
    );
    if (!pool.length) {
      throw new PlanError(
        500,
        "NO_WORKOUT",
        "The catalog needs a low-intensity outdoor workout with an indoor pair.",
      );
    }
    // Stable per user and day, no opaque randomness or unnecessary vigorous default.
    const seed = [...auth.user.id + date.toString()].reduce(
      (n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0,
      0,
    );
    const workout = pool[seed % pool.length];
    const schedule = buildSchedule(p, date, workout, input.ramadan);
    const used = new Set<string>();
    for (const b of schedule.blocks) {
      if (b.food_slot) {
        b.food = selectFood(
          foods,
          b.food_slot,
          seed + used.size,
          metabolic,
          used,
        );
      }
    }
    const weather = await fetchWeather(p);
    const decision = applyWeather(schedule.blocks, weather, workouts);
    const row = {
      user_id: auth.user.id,
      plan_date: date.toString(),
      is_indoor_override: decision.is_indoor_override,
      weather_summary_json: {
        provider: "Open-Meteo",
        attribution_url: "https://open-meteo.com/",
        license: "CC BY 4.0",
        status: weather.available ? "available" : "unavailable",
        fetched_at: weather.fetched_at,
        current: weather.current,
        ...decision,
        schedule_metadata: {
          version: 1,
          timezone: p.timezone,
          wake_at: schedule.wake_at,
          sleep_at: schedule.sleep_at,
          date_basis: p.ramadan_mode
            ? "fasting_civil_date"
            : "wake_cycle_start_date",
          fasting: schedule.fasting,
          notes: schedule.notes,
          dst_policy: "earlier_on_overlap_shift_forward_on_gap",
          meal_selection: metabolic
            ? "prefer_low_medium_gl_high_fiber"
            : "dietary_and_cultural_compatibility",
        },
      },
      schedule_blocks_json: schedule.blocks,
    };
    // Atomic unique-key upsert avoids duplicate concurrent plans. Omit adherence_score:
    // regeneration must never erase a user's recorded adherence. No service-role key.
    const { data: plan, error } = await db.from("daily_plans")
      .upsert(row, { onConflict: "user_id,plan_date", defaultToNull: false })
      .select("*").single();
    if (error) {
      throw new PlanError(
        500,
        "PLAN_SAVE_FAILED",
        "Could not save the daily plan.",
      );
    }
    return new Response(JSON.stringify(plan), { status: 200, headers });
  } catch (error) {
    const known = error instanceof PlanError;
    return new Response(
      JSON.stringify({
        error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "Daily plan generation failed.",
        },
      }),
      { status: known ? error.status : 500, headers },
    );
  }
}

if (import.meta.main) Deno.serve(handler);
