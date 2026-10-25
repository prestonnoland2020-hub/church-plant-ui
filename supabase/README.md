Server-side pieces added for photos (already applied to the Supabase project "Church Planting Tracker"):

- Migration `group_photos_and_required_notes`: private `group-photos` bucket (JPEG, 3 MB max),
  `groups.photos text[]` (max 5), `submit_group` now requires notes (10+ chars) and 1–5 uploaded photos,
  `groups_export` gains a "Photos" column (storage paths).
- Migration `submit_group_keep_photo_order`: keeps photos in the order they were added.
- Edge Function `upload-photo` (source in functions/upload-photo/index.ts), verify_jwt off; it checks the team code itself.
