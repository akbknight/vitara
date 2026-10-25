# VITARA — Adaptive Health Coaching

**Live:** https://akbknight.github.io/vitara/

Startup landing page for VITARA — an adaptive health coaching platform that generates diet, exercise, and wellness plans calibrated to the user's cultural background, location, and body rhythm.

## What this is

The public site is a static website built for GitHub Pages. The repository also contains the Supabase backend for VITARA's adaptive daily planning engine.

## Daily planning backend

Start with the [Supabase setup and API guide](supabase/README.md). The backend includes:

- [Schema and seed migration](supabase/migrations/001_vitara_schema_and_seed.sql): user profiles, cultural foods, workouts, daily plans, row-level security, 20 recipe-based dishes, and 10 indoor/outdoor workout pairs.
- [Daily-plan Edge Function](supabase/functions/generate-daily-plan/index.ts): authenticated plan generation, weather-based swaps, cultural food selection, timezone-aware schedules, and Ramadan support.
- [Edge Function tests](supabase/functions/generate-daily-plan/index_test.ts) and [database/RLS tests](supabase/tests/schema_test.mjs), with pinned function dependencies.
- [Additional food SQL reference](supabase/reference/README.md): the expanded dish submission is preserved unchanged for future reconciliation with the active schema.

The Supabase guide covers deployment, required profile data, nutrition provenance, weather API licensing, and prayer-time inputs. Publishing this repository to GitHub does not deploy its Supabase database or Edge Function.

## Public site

**Design system:**
- Typography: Cormorant Garamond (display) + Plus Jakarta Sans (body/UI)
- Palette: Warm cream `#F8F7F3` base, single forest green `#1A5C3F` accent
- Motion: IntersectionObserver reveal only — no decorative animation

**Sections:** Hero → Problem → Approach → Comparison → Who It's For → Why Now → Roadmap → Founder → Waitlist

## Strategy context

All VITARA strategy documents live at `Downloads/ai-health-coach/`:
- `VITARA_PROJECT_CONTEXT.md` — vision, positioning, core differentiator
- `VITARA_STARTUP_STRATEGY.md` — feature tiers, beachhead, MVP scope
- `VITARA_CUSTOMER_DISCOVERY_PLAN.md` — 25-interview plan
- `VITARA_BUSINESS_MODEL_DISCOVERY.md` — WTP, revenue model, GTM
- `VITARA_PITCH_REFINEMENT.md` — pitch structure and positioning forms

## Running locally

```
open index.html
```

Or any static server:

```
npx serve .
```

## Deploying

Pushes to `main` automatically update the GitHub Pages site. No CI needed.
