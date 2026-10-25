import assert from "node:assert/strict";
import { Temporal } from "npm:@js-temporal/polyfill@0.5.1";
import {
  applyWeather,
  buildSchedule,
  cycle,
  defaultPlanDate,
  fetchWeather,
  handler,
  PlanError,
  selectFood,
  weatherReasons,
} from "./index.ts";
import type { Food, Profile, Weather, Workout } from "./index.ts";

const profile: Profile = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Test User",
  latitude: 40.7128,
  longitude: -74.006,
  timezone: "America/New_York",
  cultural_heritages: ["south_asian"],
  dietary_pattern: "lacto_vegetarian",
  metabolic_flags: ["pcos"],
  ramadan_mode: false,
  wake_time: "07:00:00",
  sleep_time: "23:00:00",
  chronotype: "intermediate",
};
const outdoor: Workout = {
  id: "out",
  title: "Outdoor walk",
  environment: "outdoor",
  intensity: "low",
  duration_mins: 20,
  swap_pair_id: "in",
};
const indoor: Workout = {
  ...outdoor,
  id: "in",
  title: "Indoor walk",
  environment: "indoor",
  swap_pair_id: "out",
};
const date = Temporal.PlainDate.from("2026-03-10");
const timetable = {
  fajr_at: "2026-03-10T05:45:00-04:00",
  iftar_at: "2026-03-10T18:00:00-04:00",
  next_fajr_at: "2026-03-11T05:43:00-04:00",
};
const safe = {
  time: 0,
  precipitation: 0,
  precipitation_probability: 50,
  apparent_temperature: 20,
};
function weatherFor(
  blocks: ReturnType<typeof buildSchedule>["blocks"],
): Weather {
  const start = Math.floor(
    Temporal.Instant.from(blocks[0].starts_at).epochMilliseconds / 3600000,
  ) * 3600;
  const end =
    Temporal.Instant.from(blocks.at(-1)!.ends_at).epochMilliseconds / 1000 +
    3600;
  const hourly = [];
  for (let time = start; time <= end; time += 3600) {
    hourly.push({ ...safe, time });
  }
  return {
    available: true,
    fetched_at: new Date().toISOString(),
    current: safe,
    hourly,
  };
}
function assertCode(fn: () => unknown, code: string) {
  assert.throws(fn, (e) => e instanceof PlanError && e.code === code);
}

Deno.test("normal schedule has all events, wake-relative clocks and dinner three hours before sleep", () => {
  const result = buildSchedule(profile, date, outdoor);
  assert.equal(result.blocks.length, 8);
  assert.ok(
    result.blocks.find((b) => b.id === "breakfast")!.local_start.startsWith(
      "2026-03-10T07:45",
    ),
  );
  assert.ok(
    result.blocks.find((b) => b.id === "dinner")!.local_start.startsWith(
      "2026-03-10T20:00",
    ),
  );
  assert.equal(
    result.blocks.find((b) => b.id === "glucose_walk")!.ends_at,
    Temporal.Instant.from(
      result.blocks.find((b) => b.id === "glucose_walk")!.starts_at,
    ).add({ minutes: 15 }).toString(),
  );
});
Deno.test("night shift keeps the active wake date after midnight and sleeps next day", () => {
  const p: Profile = {
    ...profile,
    wake_time: "17:00",
    sleep_time: "09:00",
    chronotype: "night_shift",
  };
  const now = Temporal.ZonedDateTime.from(
    "2026-03-11T02:00-04:00[America/New_York]",
  );
  assert.equal(defaultPlanDate(p, now).toString(), "2026-03-10");
  const result = buildSchedule(p, date, outdoor);
  assert.ok(
    result.blocks.find((b) => b.id === "dinner")!.local_start.startsWith(
      "2026-03-11T06:00",
    ),
  );
});
Deno.test("DST gap shifts nonexistent wake forward; overlap chooses earlier instant", () => {
  const spring = cycle(
    { ...profile, wake_time: "02:30", sleep_time: "20:30" },
    Temporal.PlainDate.from("2026-03-08"),
  );
  assert.equal(spring.wake.hour, 3);
  assert.equal(spring.wake.offset, "-04:00");
  const fall = cycle(
    { ...profile, wake_time: "01:30", sleep_time: "19:30" },
    Temporal.PlainDate.from("2026-11-01"),
  );
  assert.equal(fall.wake.offset, "-04:00");
  assert.equal(fall.sleep.offset, "-05:00");
});
Deno.test("fractional UTC offset is preserved", () => {
  const result = buildSchedule(
    { ...profile, timezone: "Asia/Kolkata" },
    date,
    outdoor,
  );
  assert.ok(result.blocks[0].local_start.includes("+05:30"));
  assert.equal(result.blocks[0].starts_at, "2026-03-10T01:30:00Z");
});
Deno.test("invalid awake interval is rejected", () => {
  assertCode(
    () => cycle({ ...profile, sleep_time: "10:00" }, date),
    "INVALID_SLEEP_WINDOW",
  );
});
Deno.test("weather thresholds are strict and unknown values are conservative", () => {
  for (const apparent_temperature of [4, 33]) {
    assert.deepEqual(weatherReasons({ ...safe, apparent_temperature }), []);
  }
  assert.deepEqual(weatherReasons({ ...safe, precipitation: 0.01 }), [
    "precipitation",
  ]);
  assert.deepEqual(weatherReasons({ ...safe, precipitation_probability: 51 }), [
    "precipitation_probability_above_50",
  ]);
  assert.deepEqual(weatherReasons({ ...safe, apparent_temperature: 3.99 }), [
    "apparent_temperature_below_4c",
  ]);
  assert.deepEqual(weatherReasons({ ...safe, apparent_temperature: 33.01 }), [
    "apparent_temperature_above_33c",
  ]);
  assert.deepEqual(weatherReasons({ ...safe, precipitation: null }), [
    "weather_data_unavailable",
  ]);
});
Deno.test("forecast rain during workout swaps to reciprocal indoor pair despite dry current conditions", () => {
  const { blocks } = buildSchedule(profile, date, outdoor);
  const weather = weatherFor(blocks);
  const workout = blocks.find((b) => b.id === "peak_workout")!;
  const t = Math.ceil(
    Temporal.Instant.from(workout.ends_at).epochMilliseconds / 3600000,
  ) * 3600;
  weather.hourly.find((s) => s.time === t)!.precipitation = 1;
  const decision = applyWeather(blocks, weather, [indoor, outdoor]);
  assert.equal(decision.is_indoor_override, true);
  assert.equal(workout.workout!.id, "in");
});
Deno.test("complete safe weather keeps outdoors; missing interval defaults indoors including glucose walk", () => {
  let blocks = buildSchedule(profile, date, outdoor).blocks;
  assert.equal(
    applyWeather(blocks, weatherFor(blocks), [indoor, outdoor])
      .is_indoor_override,
    false,
  );
  blocks = buildSchedule(profile, date, outdoor).blocks;
  assert.equal(
    applyWeather(blocks, { ...weatherFor(blocks), hourly: [] }, [
      indoor,
      outdoor,
    ]).is_indoor_override,
    true,
  );
  assert.equal(
    blocks.find((b) => b.id === "glucose_walk")!.environment,
    "indoor",
  );
});
Deno.test("Ramadan timetable schedules ingestion and exercise outside fasting hours", () => {
  const result = buildSchedule(
    { ...profile, ramadan_mode: true },
    date,
    outdoor,
    timetable,
  );
  const fajr = Temporal.Instant.from(timetable.fajr_at),
    iftar = Temporal.Instant.from(timetable.iftar_at);
  for (
    const b of result.blocks.filter((b) =>
      ["meal", "hydration", "workout", "walk"].includes(b.kind)
    )
  ) {
    assert.ok(
      Temporal.Instant.compare(b.ends_at, fajr) <= 0 ||
        Temporal.Instant.compare(b.starts_at, iftar) >= 0,
      b.id,
    );
  }
  assert.equal(
    result.blocks.find((b) => b.id === "lunch")!.starts_at,
    iftar.toString(),
  );
});
Deno.test("Ramadan astronomical calculation works with explicit method", () => {
  const result = buildSchedule(
    { ...profile, ramadan_mode: true },
    date,
    outdoor,
    { calculation_method: "NorthAmerica" },
  );
  assert.equal(result.fasting!.source, "adhan:NorthAmerica");
  assert.ok(
    result.blocks.find((b) => b.id === "breakfast")!.local_start.startsWith(
      "2026-03-10",
    ),
  );
});
Deno.test("Ramadan rejects missing, wrong-date and compressed prayer/sleep windows", () => {
  const p = { ...profile, ramadan_mode: true };
  assertCode(() => buildSchedule(p, date, outdoor), "RAMADAN_TIMES_REQUIRED");
  assertCode(
    () =>
      buildSchedule(p, date, outdoor, {
        ...timetable,
        fajr_at: "2026-03-09T05:45:00-04:00",
      }),
    "INVALID_FASTING_WINDOW",
  );
  assertCode(
    () =>
      buildSchedule({ ...p, sleep_time: "21:00" }, date, outdoor, timetable),
    "RAMADAN_SLEEP_CONFLICT",
  );
  assertCode(
    () =>
      buildSchedule(
        {
          ...p,
          wake_time: "20:00",
          sleep_time: "12:00",
          chronotype: "night_shift",
        },
        date,
        outdoor,
        timetable,
      ),
    "RAMADAN_SLEEP_CONFLICT",
  );
});
Deno.test("Ramadan night shift keeps evening activities awake and dinner before next Fajr", () => {
  const result = buildSchedule(
    {
      ...profile,
      wake_time: "17:00",
      sleep_time: "09:00",
      chronotype: "night_shift",
      ramadan_mode: true,
    },
    date,
    outdoor,
    timetable,
  );
  const workout = result.blocks.find((b) => b.id === "peak_workout")!;
  assert.ok(
    Temporal.Instant.compare(workout.starts_at, timetable.iftar_at) >= 0,
  );
  assert.ok(
    Temporal.Instant.compare(workout.ends_at, timetable.next_fajr_at) < 0,
  );
  assert.ok(result.notes.some((note) => note.startsWith("Dinner moved")));
});
Deno.test("metabolic priority beats novelty and prefers fiber within a tier", () => {
  const foods: Food[] = [
    { id: "high", meal_slot: ["lunch"], gl_score: 22, fiber_g: 20 },
    { id: "low", meal_slot: ["lunch"], gl_score: 8, fiber_g: 10 },
    { id: "low_less_fiber", meal_slot: ["lunch"], gl_score: 5, fiber_g: 2 },
  ];
  assert.equal(selectFood(foods, "lunch", 0, true, new Set(["low"])).id, "low");
  assertCode(
    () => selectFood(foods, "snack", 0, true, new Set()),
    "NO_COMPATIBLE_FOOD",
  );
});
Deno.test("weather upstream failure returns explicit unavailable data", async () => {
  const response = await fetchWeather(
    profile,
    (() =>
      Promise.resolve(
        new Response("unavailable", { status: 503 }),
      )) as typeof fetch,
  );
  assert.equal(response.available, false);
  assert.equal(response.current, null);
});
Deno.test("handler permits preflight, rejects wrong method and requires authentication", async () => {
  assert.equal(
    (await handler(new Request("https://test.local", { method: "OPTIONS" })))
      .status,
    204,
  );
  assert.equal((await handler(new Request("https://test.local"))).status, 405);
  assert.equal(
    (await handler(new Request("https://test.local", { method: "POST" })))
      .status,
    401,
  );
});
Deno.test("authenticated handler filters catalog, saves owner plan without resetting adherence, and returns row", async () => {
  const originalFetch = globalThis.fetch;
  const vars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPEN_METEO_API_KEY"];
  const previous = vars.map((k) => Deno.env.get(k));
  Deno.env.set("SUPABASE_URL", "https://vitara-test.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "unit-test-only");
  Deno.env.delete("OPEN_METEO_API_KEY");
  let saved: Record<string, unknown> | undefined;
  const foods: Food[] = [{
    id: "lentils",
    meal_slot: ["breakfast", "lunch", "dinner", "snack"],
    gl_score: 8,
    fiber_g: 10,
  }];
  const json = (x: unknown) =>
    new Response(JSON.stringify(x), {
      headers: { "Content-Type": "application/json" },
    });
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(json({ id: profile.id, aud: "authenticated" }));
    }
    if (url.pathname.endsWith("/profiles")) {
      return Promise.resolve(json(profile));
    }
    if (url.pathname.endsWith("/cultural_foods")) {
      assert.ok(url.searchParams.get("culture")!.includes("south_asian"));
      assert.ok(
        url.searchParams.get("dietary_tags")!.includes("lacto_vegetarian"),
      );
      return Promise.resolve(json(foods));
    }
    if (url.pathname.endsWith("/workouts")) {
      return Promise.resolve(json([outdoor, indoor]));
    }
    if (url.hostname === "api.open-meteo.com") {
      return Promise.resolve(new Response("unavailable", { status: 503 }));
    }
    if (url.pathname.endsWith("/daily_plans")) {
      assert.equal(init?.method, "POST");
      saved = JSON.parse(String(init?.body));
      return Promise.resolve(
        json({ id: "plan", ...saved, adherence_score: 82 }),
      );
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  }) as typeof fetch;
  try {
    const response = await handler(
      new Request("https://test.local", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-test-token" },
        body: "{}",
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(saved!.user_id, profile.id);
    assert.equal(saved!.is_indoor_override, true);
    assert.equal(Object.hasOwn(saved!, "adherence_score"), false);
    assert.equal(body.adherence_score, 82);
    const badDate = await handler(
      new Request("https://test.local", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-test-token" },
        body: '{"plan_date":null}',
      }),
    );
    assert.equal(badDate.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    vars.forEach((k, i) =>
      previous[i] === undefined
        ? Deno.env.delete(k)
        : Deno.env.set(k, previous[i]!)
    );
  }
});
