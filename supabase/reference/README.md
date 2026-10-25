# Expanded food SQL reference

`002_vitara_expanded_dishes.sql` preserves the additional 84-dish submission exactly as it existed in the local code folder. It is source material for a future migration and is intentionally outside `supabase/migrations`, so `supabase db push` does not execute it.

The first 52 inserts omit required `dietary_tags` and `nutrition_source_json` fields and use culture names such as `North Indian` and `West African`, which do not match the active schema's canonical keys. Those inserts fail against migration 001. The remaining 32 entries have some matching fields but lack ingredient-level quantities and nutrient references sufficient to reproduce their macro estimates. The source also includes physiological and quantitative claims that have not been validated by this implementation.

Before promoting these entries into the deployed catalog, normalize culture keys, supply dietary compatibility and sourcing requirements, document verifiable nutrient inputs, reconcile overlapping recipes, review nutrition claims, and validate the entire migration against the database constraints. The original file is retained unchanged for traceability; the active migration continues to seed the 20 documented recipes.
