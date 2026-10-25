/**
 * Run the exact migration against embedded PostgreSQL, including its extensions.
 * Install: npm install --prefix supabase/tests --no-save --package-lock=false @electric-sql/pglite@0.5.11
 * Run: node supabase/tests/schema_test.mjs
 * An existing installation can alternatively be provided through NODE_PATH.
 * Supabase's auth service is represented only by its users table and auth.uid().
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");
const { uuid_ossp } = require("@electric-sql/pglite/contrib/uuid_ossp");
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
const migration = await readFile(new URL("../migrations/001_vitara_schema_and_seed.sql", import.meta.url), "utf8");
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const unknown = "33333333-3333-4333-8333-333333333333";
let passed = 0;

async function check(name, operation) {
  await operation();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function as(role, userId, operation) {
  assert.ok(["authenticated", "anon"].includes(role));
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await operation();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

async function denied(sql, values = [], code = "42501") {
  await assert.rejects(db.query(sql, values), (error) => error.code === code);
}

async function addProfile(userId) {
  return await db.query(`
    INSERT INTO public.profiles
      (id, full_name, city, latitude, longitude, timezone, cultural_heritages,
       dietary_pattern, metabolic_flags, ramadan_mode, wake_time, sleep_time, chronotype)
    VALUES ($1, 'Test Person', 'New York', 40.7128, -74.006, 'America/New_York',
      ARRAY['south_asian'], 'lacto_vegetarian', ARRAY['t2d_family_history'], false,
      '07:00', '23:00', 'intermediate') RETURNING id
  `, [userId]);
}

async function addPlan(userId, date) {
  return await db.query(`
    INSERT INTO public.daily_plans
      (user_id, plan_date, weather_summary_json, is_indoor_override, schedule_blocks_json, adherence_score)
    VALUES ($1, $2, '{"source":"test"}'::jsonb, false, '[{"id":"hydration"}]'::jsonb, 0) RETURNING id
  `, [userId, date]);
}

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  `);

  await check("migration executes unchanged with pgcrypto and uuid-ossp", async () => {
    await db.exec(migration);
    const result = await db.query("SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'uuid-ossp') ORDER BY extname");
    assert.deepEqual(result.rows.map((row) => row.extname), ["pgcrypto", "uuid-ossp"]);
  });

  await check("20 cultural dishes and 10 reciprocal indoor/outdoor pairs", async () => {
    const foods = (await db.query("SELECT * FROM public.cultural_foods")).rows;
    const workouts = (await db.query("SELECT * FROM public.workouts")).rows;
    assert.equal(foods.length, 20);
    assert.equal(workouts.length, 20);
    assert.equal(new Set(foods.map((food) => food.culture)).size, 4);
    assert.equal(workouts.filter((workout) => workout.environment === "indoor").length, 10);
    assert.equal(workouts.filter((workout) => workout.environment === "outdoor").length, 10);
    for (const workout of workouts) {
      const pair = workouts.find((candidate) => candidate.id === workout.swap_pair_id);
      assert.ok(pair, `Missing paired workout for ${workout.title}`);
      assert.equal(pair.swap_pair_id, workout.id);
      assert.notEqual(pair.environment, workout.environment);
      assert.equal(pair.duration_mins, workout.duration_mins);
      assert.equal(pair.intensity, workout.intensity);
    }
  });

  await check("GL is derived from available carbohydrate and determines its tier", async () => {
    const foods = (await db.query("SELECT * FROM public.cultural_foods")).rows;
    for (const food of foods) {
      const carbs = Number(food.carbs_g);
      const fiber = Number(food.fiber_g);
      const expected = Math.round(Number(food.gi_estimate) * (carbs - fiber)) / 100;
      const gl = Number(food.gl_score);
      assert.ok(carbs >= fiber, `${food.dish_name}: fiber exceeds total carbohydrate`);
      assert.ok(Math.abs(gl - expected) < 0.0001, `${food.dish_name}: GL mismatch`);
      assert.equal(food.glycemic_tier, gl <= 10 ? "low" : gl < 20 ? "medium" : "high");
      assert.ok(Number(food.serving_grams) > 0);
      assert.ok(Number(food.calories) > 0);
    }
  });

  await check("catalog constraints reject inconsistent nutrition and broken workout pairs", async () => {
    const food = (await db.query("SELECT id FROM public.cultural_foods LIMIT 1")).rows[0];
    const workout = (await db.query("SELECT id FROM public.workouts LIMIT 1")).rows[0];
    await assert.rejects(db.query("UPDATE public.cultural_foods SET fiber_g = carbs_g + 1 WHERE id = $1", [food.id]));
    await assert.rejects(db.query("UPDATE public.cultural_foods SET protein_g = -1 WHERE id = $1", [food.id]));
    await assert.rejects(db.query("UPDATE public.cultural_foods SET gl_score = 0 WHERE id = $1", [food.id]));
    await assert.rejects(db.query("UPDATE public.workouts SET swap_pair_id = id WHERE id = $1", [workout.id]));
    await assert.rejects(db.query("UPDATE public.workouts SET duration_mins = duration_mins + 1 WHERE id = $1", [workout.id]));
  });

  await check("recipe macros reproduce USDA ingredient sums and every diet/culture has every slot", async () => {
    const foods = (await db.query("SELECT * FROM public.cultural_foods")).rows;
    for (const food of foods) {
      const ingredients = food.nutrition_source_json.ingredients;
      for (const nutrient of ["calories", "protein_g", "carbs_g", "fiber_g", "fat_g"]) {
        const calculated = ingredients.reduce((sum, x) => sum + x.grams * x.per_100g[nutrient] / 100, 0);
        assert.ok(Math.abs(Number(food[nutrient]) - calculated) <= 0.00501, `${food.dish_name}: ${nutrient}`);
      }
    }
    for (const culture of ["south_asian", "west_african", "middle_eastern", "latin_american"]) {
      for (const diet of ["vegan", "lacto_vegetarian", "eggetarian", "halal", "omnivore"]) {
        for (const slot of ["breakfast", "lunch", "dinner", "snack"]) {
          assert.ok(foods.some((f) => f.culture === culture && f.dietary_tags.includes(diet) && f.meal_slot.includes(slot)), `${culture}/${diet}/${slot} missing`);
        }
      }
    }
  });

  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, 'alice@example.com'), ($2, 'bob@example.com')", [alice, bob]);

  await check("each identity can create and read only its own profile", async () => {
    for (const owner of [alice, bob]) {
      await as("authenticated", owner, async () => {
        await addProfile(owner);
        const visible = await db.query("SELECT id FROM public.profiles");
        assert.deepEqual(visible.rows, [{ id: owner }]);
      });
    }
    await as("authenticated", alice, async () => {
      await assert.rejects(addProfile(unknown), (error) => error.code === "42501");
      assert.deepEqual((await db.query("SELECT id FROM public.profiles WHERE id = $1", [bob])).rows, []);
    });
  });

  await check("profile update and delete enforce both row visibility and ownership", async () => {
    await as("authenticated", alice, async () => {
      assert.equal((await db.query("UPDATE public.profiles SET city = 'Boston' WHERE id = $1 RETURNING id", [alice])).rows.length, 1);
      assert.equal((await db.query("UPDATE public.profiles SET city = 'Boston' WHERE id = $1 RETURNING id", [bob])).rows.length, 0);
      assert.equal((await db.query("DELETE FROM public.profiles WHERE id = $1 RETURNING id", [bob])).rows.length, 0);
      await denied("UPDATE public.profiles SET id = $1 WHERE id = $2", [unknown, alice]);
    });
  });

  await check("each identity can create and read only its own daily plans", async () => {
    for (const owner of [alice, bob]) {
      await as("authenticated", owner, async () => {
        await addPlan(owner, "2026-10-23");
        const plans = await db.query("SELECT user_id FROM public.daily_plans");
        assert.deepEqual(plans.rows, [{ user_id: owner }]);
      });
    }
    await as("authenticated", alice, async () => {
      await assert.rejects(addPlan(bob, "2026-10-24"), (error) => error.code === "42501");
      assert.equal((await db.query("SELECT * FROM public.daily_plans WHERE user_id = $1", [bob])).rows.length, 0);
    });
  });

  await check("plan updates/deletes cannot cross users or transfer ownership", async () => {
    await as("authenticated", alice, async () => {
      const edited = await db.query("UPDATE public.daily_plans SET adherence_score = 87 WHERE user_id = $1 RETURNING adherence_score", [alice]);
      assert.deepEqual(edited.rows, [{ adherence_score: 87 }]);
      assert.equal((await db.query("UPDATE public.daily_plans SET adherence_score = 10 WHERE user_id = $1 RETURNING id", [bob])).rows.length, 0);
      assert.equal((await db.query("DELETE FROM public.daily_plans WHERE user_id = $1 RETURNING id", [bob])).rows.length, 0);
      await denied("UPDATE public.daily_plans SET user_id = $1 WHERE user_id = $2", [bob, alice]);
      const own = await addPlan(alice, "2026-10-24");
      assert.equal((await db.query("DELETE FROM public.daily_plans WHERE id = $1 RETURNING id", [own.rows[0].id])).rows.length, 1);
    });
  });

  await check("one plan per user and date, bounded adherence and valid JSON shapes", async () => {
    await as("authenticated", alice, async () => {
      await assert.rejects(addPlan(alice, "2026-10-23"), (error) => error.code === "23505");
      await denied("UPDATE public.daily_plans SET adherence_score = 101 WHERE user_id = $1", [alice], "23514");
      await denied("UPDATE public.daily_plans SET adherence_score = -1 WHERE user_id = $1", [alice], "23514");
      await denied("UPDATE public.daily_plans SET schedule_blocks_json = '{}'::jsonb WHERE user_id = $1", [alice], "23514");
      await denied("UPDATE public.daily_plans SET weather_summary_json = '[]'::jsonb WHERE user_id = $1", [alice], "23514");
    });
  });

  await check("authenticated users can read catalogs but cannot insert/update/delete them", async () => {
    await as("authenticated", alice, async () => {
      for (const table of ["cultural_foods", "workouts"]) {
        assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 20);
        await denied(`DELETE FROM public.${table}`);
      }
      await denied("UPDATE public.cultural_foods SET calories = 1");
      await denied("UPDATE public.workouts SET duration_mins = 1");
      await denied("INSERT INTO public.cultural_foods (dish_name) VALUES ('Forbidden')");
      await denied("INSERT INTO public.workouts (title) VALUES ('Forbidden')");
    });
  });

  await check("anonymous users cannot read or mutate user data or catalogs", async () => {
    await as("anon", null, async () => {
      for (const table of ["profiles", "daily_plans", "cultural_foods", "workouts"]) {
        await denied(`SELECT * FROM public.${table}`);
        await denied(`DELETE FROM public.${table}`);
      }
      await assert.rejects(addProfile(alice), (error) => error.code === "42501");
      await assert.rejects(addPlan(alice, "2026-10-25"), (error) => error.code === "42501");
    });
  });

  await check("malformed timezones and coordinates are rejected", async () => {
    await as("authenticated", alice, async () => {
      await assert.rejects(db.query("UPDATE public.profiles SET timezone = 'Invalid/Zone' WHERE id = $1", [alice]));
      await denied("UPDATE public.profiles SET latitude = 91 WHERE id = $1", [alice], "23514");
      await denied("UPDATE public.profiles SET longitude = 181 WHERE id = $1", [alice], "23514");
    });
  });

  await check("owners can delete profiles and dependent plans are removed", async () => {
    await as("authenticated", alice, async () => {
      assert.equal((await db.query("DELETE FROM public.profiles WHERE id = $1 RETURNING id", [alice])).rows.length, 1);
      assert.equal((await db.query("SELECT * FROM public.daily_plans")).rows.length, 0);
    });
    await as("authenticated", bob, async () => {
      assert.equal((await db.query("SELECT * FROM public.profiles")).rows.length, 1);
      assert.equal((await db.query("SELECT * FROM public.daily_plans")).rows.length, 1);
    });
  });

  console.log(`\n${passed} schema checks passed against PostgreSQL ${db.version ?? "(PGlite)"}.`);
} finally {
  await db.close();
}
