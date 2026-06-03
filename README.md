# VITARA — Adaptive Health Coaching

**Live:** https://akbknight.github.io/vitara/

Startup landing page for VITARA — an adaptive health coaching platform that generates diet, exercise, and wellness plans calibrated to the user's cultural background, location, and body rhythm.

## What this is

A single-file static website built for GitHub Pages. No framework, no build step, no dependencies beyond Google Fonts.

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
