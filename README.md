# portal
Public, token-gated home for outside parties working with Rosably Engagement Rooms (portal.rosably.com).
A bare Next.js 16 app deployed as its own Vercel project. It has no data and no links; anyone without a room link sees a plain landing page.
Phase 1 is scaffold only (home page, `/api/health`, secure default headers). Phase 2 adds `/r/[token]`, the room itself, which exchanges a link token for a short-lived grant.
Env vars (Phase 2 onward): PORTAL_DATABASE_URL (pooled connection as the limited `portal_app` role; the portal holds no Supabase secret key), ROOM_GRANT_SECRET, ROOM_SESSION_SECRET, PORTAL_ORIGIN, NEXT_PUBLIC_PREVIEW_URL.
Phase 3 adds document deliverables: `POST /api/room/versions/[id]/document-url` returns a 2-minute `<preview host>/d/<grant>` URL (the portal holds no Storage credential and never sends a storage path to the browser). The visitor's browser navigates to it and the preview host streams the file as an attachment; documents are never rendered or framed in the portal. `lib/grant.ts` and `lib/grant.test.ts` are byte-identical copies of the dashboard's `src/lib/rooms/` files; do not edit them here.
