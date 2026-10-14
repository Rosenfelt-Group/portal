# portal
Public, token-gated home for outside parties working with Rosably Engagement Rooms (portal.rosably.com).
A bare Next.js 16 app deployed as its own Vercel project. It has no data and no links; anyone without a room link sees a plain landing page.
Phase 1 is scaffold only (home page, `/api/health`, secure default headers). Phase 2 adds `/r/[token]`, the room itself, which exchanges a link token for a short-lived grant.
Env vars (Phase 2 onward): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ROOM_GRANT_SECRET, NEXT_PUBLIC_PREVIEW_URL.
