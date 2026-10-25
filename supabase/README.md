# VITARA daily planning backend

The migration and Edge Function are complete implementations. No Supabase project was deployed or modified during development. Apply the migration once to a new Supabase schema, then deploy the function to the linked project. Existing unrelated public tables named `profiles`, `workouts`, `cultural_foods`, or `daily_plans` require an explicit reconciliation migration; this migration deliberately does not overwrite them.

The additional expanded-food SQL submission is preserved unchanged under [`reference/`](reference/README.md). It requires schema and nutrition-source reconciliation before becoming an executable migration. `db push` applies only the validated files under `migrations/`.

## Deploy

From the repository root, after logging in and linking the intended project with the Supabase CLI:

```sh
supabase db push
supabase functions deploy generate-daily-plan
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the deployed runtime. The function authenticates the access token with `auth.getUser` and sends that same token to PostgreSQL through the client, preserving RLS. It does not use a service-role key. Gateway JWT verification is enabled in `config.toml`.

`ALLOWED_ORIGINS` optionally accepts a comma-separated list of the deployed PWA origins. Without it, bearer-authenticated cross-origin requests are allowed with `*`; cookies are never used. An authenticated client invokes:

```ts
const { data: plan, error } = await supabase.functions.invoke('generate-daily-plan', {
  body: {},
});
if (error) throw error;
console.log(plan.schedule_blocks_json);
```

Create the user's `profiles` row during onboarding. Required values are actual user inputs: `id` matching the signed-in user, `full_name`, `city`, `latitude`, `longitude`, IANA `timezone`, `cultural_heritages`, `dietary_pattern`, `wake_time`, `sleep_time`, and `chronotype`. Coordinates, timezone and personal schedule have no fabricated defaults. Recognized cuisine keys are `south_asian`, `west_african`, `middle_eastern`, `latin_american`. Recognized metabolic-ranking flags are `t2d_family_history` and `pcos`. Other flags are stored but do not imply additional medical logic.

The response is the saved `daily_plans` row. For example, incomplete onboarding returns `{ "error": { "code": "PROFILE_REQUIRED", "message": "Complete your profile before generating a plan." } }`. HTTP 401 means invalid authentication, 422 means profile/catalog/schedule input needs correction, and 500 means a server/database failure. Weather failure alone does not fail the plan: it explicitly defaults exercise indoors.

## Clock and date semantics

Normal mode uses the local date on which the wake cycle starts. Overnight workers who request a plan after midnight but before sleep retain yesterday's wake-cycle date. An optional `plan_date` must be exactly `YYYY-MM-DD`, within the current wake cycle through tomorrow. Every block contains UTC `starts_at`/`ends_at`, zoned `local_start`/`local_end` including the date and offset, and the IANA timezone. Never display a UTC timestamp as if it were local time.

Wake and sleep are interpreted as local wall-clock inputs. If sleep's clock is earlier than wake, sleep is next day. Offsets thereafter are elapsed minutes, including across DST. Ambiguous fall-back inputs choose the earlier occurrence; nonexistent spring-forward inputs move forward through the gap. Awake windows outside 10–20 hours are rejected instead of generating overlapping meals.

Normal offsets:

| Event | Timing |
|---|---|
| Hydration | Wake |
| Breakfast | Wake + 45 minutes |
| Peak Energy Workout | Wake + 120 / 180 / 240 / 120 minutes for early bird / intermediate / night owl / night shift; capped at 25% of awake time |
| Lunch | 40% through awake time |
| Glucose walk | Lunch + 30 minutes, for 15 minutes |
| Snack | Halfway between lunch and dinner |
| Dinner | Sleep − 3 hours |
| Wind-down | Sleep − 1 hour |

Workout timing is a coaching heuristic, not a measured energy peak. Initial selection uses low-intensity workouts because the requested profile contains no fitness assessment. All 10 pairs remain available in the catalog. These portions are meal suggestions, not a calorie-targeted full nutrition prescription: the profile has no age, weight, energy needs, allergies or medication information.

## Ramadan

Fajr is not sunrise. When `ramadan_mode` is true, the request must provide either a chosen calculation method or the three exact local-timetable timestamps. No method is silently selected for the user. Astronomical calculations use pinned `adhan` and the user's coordinates; a local timetable takes precedence.

```ts
const { data: plan, error } = await supabase.functions.invoke('generate-daily-plan', {
  body: { ramadan: { calculation_method: 'NorthAmerica' } },
});
if (error) throw error;
```

Supported methods: `MuslimWorldLeague`, `Egyptian`, `Karachi`, `UmmAlQura`, `Dubai`, `MoonsightingCommittee`, `NorthAmerica`, `Kuwait`, `Qatar`, `Singapore`, `Tehran`, `Turkey`. Select the user's local authority's method. Alternatively, supply `ramadan.fajr_at`, `ramadan.iftar_at`, and `ramadan.next_fajr_at` as ISO timestamps with `Z` or numeric offsets. The first two must fall on `plan_date` in the profile timezone, and the third on its next date. At locations where astronomical times are unavailable, an exact local timetable is required.

Ramadan `plan_date` means the fasting civil date. Hydration is Fajr − 50 minutes; Suhoor starts Fajr − 45 minutes and ends 15 minutes before Fajr. Suhoor explicitly carries a wake-alarm flag and may interrupt primary sleep. Lunch becomes Iftar at Maghrib, followed by a 15-minute walk 30 minutes later. Dinner prefers sleep − 3 hours but moves if needed to remain outside fasting and leave recovery time. Exercise follows dinner by one hour; snack follows exercise by 15 minutes. No food, hydration, workout or glucose walk is placed inside the fasting interval.

Iftar must be inside the user's awake interval. At least three hours must be available after Iftar before wind-down or next-Fajr preparation, and at least four hours between Iftar and next Fajr. Incompatible schedules return `RAMADAN_SLEEP_CONFLICT` or `INVALID_FASTING_WINDOW`, rather than inventing a sleep adjustment or putting meals into fasting hours. Night-shift users therefore need their actual Ramadan wake/sleep times in the profile. A split-sleep model beyond the explicit Suhoor alarm would require more profile data.

## Weather and swaps

The default endpoint is the requested no-key `https://api.open-meteo.com/v1/forecast`. Current and hourly precipitation, probability and apparent temperature are requested in mm and Celsius with Unix timestamps. Both bounding hourly samples of each workout and glucose-walk interval are checked, including the following hour because accumulated precipitation describes the preceding interval.

Any precipitation > 0, probability > 50%, apparent temperature < 4°C or > 33°C triggers the paired indoor workout. Exact boundary values 4, 33 and 50 do not independently trigger a swap. Unsafe current conditions also trigger the override, as requested. Missing, stale, malformed or failed weather defaults indoors with a recorded reason; it never invents dry weather. The database enforces equal duration/intensity and reciprocal opposite-environment pair links.

**Commercial deployment:** Open-Meteo's free API is restricted to non-commercial use. Set the `OPEN_METEO_API_KEY` Edge secret for a licensed subscription; the function then switches to `https://customer-api.open-meteo.com/v1/forecast`. The response includes Open-Meteo attribution and CC BY 4.0 information for display in the PWA. Refresh by invoking again when the user opens the plan or weather changes; this function does not itself schedule a background monitor.

## Nutrition provenance and compatibility

There are 20 actual dishes and 20 workout rows (10 pairs). Each food includes exact ingredient weights, preparation, FDC IDs, source URLs and per-100g nutrient values in `nutrition_source_json`. Calories, protein, total carbohydrate, fiber and fat are sums of USDA SR Legacy ingredient values for the specified recipe and yield. These are reproducible recipe estimates, **not laboratory measurements of a finished dish**. Cooking losses, ingredient/brand variation and added side dishes are not modeled.

Mixed-dish GI values are explicitly unvalidated estimates, not measured GI or predictions of personal glucose response. The verified research table mentioned in the request was not present in the workspace; this seed is not represented as that table. Replace estimated GI with verified recipe-specific values when available. GL and its tier are generated by PostgreSQL and cannot drift from the recipe macros: `GI × (total carbohydrate − fiber) / 100`, rounded to two decimals; low ≤ 10, medium > 10 and < 20, high ≥ 20.

`dietary_pattern` classifies the recipe, while `dietary_tags` expresses compatible users. For example, a vegan dish can suit a lacto-vegetarian; enum equality would incorrectly exclude it. Meat recipes tagged halal explicitly require certified-halal sourcing and alcohol-free seasonings; USDA nutrient records do not establish religious certification. All four cuisines have a compatible choice in every meal slot for each of the five patterns. Metabolic flags rank GL tier first, fiber second, then variety. They do not exclude all high-GL options or claim to treat PCOS/diabetes.

The unique `(user_id, plan_date)` key supports atomic regeneration. Existing adherence is preserved because the upsert omits `adherence_score`; a newly generated plan starts with null adherence. Concurrent generations use last-writer-wins for the plan content, with no duplicate rows.

## Validation

Run Edge validation from `supabase/functions/generate-daily-plan`:

```sh
npx --yes deno task check
npx --yes deno task lint
npx --yes deno task test
```

Run the schema/RLS suite from the repository root:

```sh
npm install --prefix supabase/tests --no-save --package-lock=false @electric-sql/pglite@0.5.11
node supabase/tests/schema_test.mjs
```

The SQL suite runs the complete unmodified migration in embedded PostgreSQL with both real extensions. It represents Supabase Auth using `auth.users`, roles and `auth.uid()`; it does not run a hosted Supabase Auth/PostgREST deployment. Edge tests mock external services for reproducibility. A live Open-Meteo probe also confirmed the requested current/hourly variables. Deployment-specific Auth/gateway behavior and secrets still need verification in the intended Supabase project.

## Sources

- [Open-Meteo forecast API](https://open-meteo.com/en/docs) and [usage terms](https://open-meteo.com/en/terms)
- [Supabase authenticated user verification](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Adhan prayer-time calculation library](https://github.com/batoulapps/adhan-js)
- [Official USDA SR Legacy JSON dataset](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip)
- [University of Sydney glycemic-load explanation](https://glycemicindex.com/2021/11/how-to-enjoy-a-moderate-glycemic-load-diet/)
