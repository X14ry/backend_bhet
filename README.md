# BHET Social Discovery - Backend (Node.js + Express + MySQL)

REST API and MySQL database for the BHET prototype (Flutter client). It implements the flows in the design report:
intention choice (friendship / dating), discovery cards with a "why shown" reason, mutual connection, in-app chat,
public-venue meetup planner, trusted-contact sharing, hide/pause, unmatch, block and report. Only a **broad area**
is stored for users - never exact coordinates.

## Requirements
- Node.js 18+ (tested on 22)
- MySQL 8.0+

## Setup
```bash
npm install
cp .env.example .env        # then edit DB_PASSWORD and JWT_SECRET
npm run db:migrate          # creates database `bhet_db`, all tables, interests + public venues
npm run db:seed             # optional: fictional demo users (password: Demo12345)
npm start                   # http://localhost:3000   (npm run dev = auto-restart)
```
`npm run db:reset` drops and rebuilds the database (and re-seeds demo users).
Test everything end to end (server running, fresh DB): `npm run db:reset` then `npm run test:smoke`.

Demo accounts: `mina@`, `sita@`, `rohan@` (friendship); `aarav@`, `priya@`, `kiran@` (dating);
`admin@` (admin) - all `@bhet.test`, password `Demo12345`.

**Common error:** `ER_NOT_SUPPORTED_AUTH_MODE` / "Access denied" -> check DB_USER / DB_PASSWORD in `.env`.

## Database (database/schema.sql)
| Table | Purpose |
|---|---|
| users | account, email, bcrypt hash, date of birth (18+), role, status |
| profiles | display name, bio, photo URL, **intention**, **broad_area** |
| interests / user_interests | selectable interests (chips) and each user's choices |
| discovery_preferences | area, age range, pause discovery |
| likes | like/pass decision per ordered pair |
| connections | mutual match, ordered pair (user_one < user_two), status active/unmatched/blocked, shared-interest summary |
| messages | in-app chat with read receipts |
| venues | public meetup venues only |
| meetup_plans | proposed/accepted/declined/cancelled plans, trusted-contact sharing flag |
| trusted_contacts | up to 5 per user |
| blocks | blocker -> blocked |
| reports | reports with reason + status; kept if account is deleted |

## API (all JSON; send `Authorization: Bearer <token>` except register/login)
**Auth** - `POST /api/auth/register` `{email,password,dateOfBirth:"YYYY-MM-DD",confirmAdult:true}` ·
`POST /api/auth/login` · `GET /api/auth/me` · `DELETE /api/auth/account` `{password}`

**Profile & onboarding** - `GET /api/interests` · `GET|PUT /api/profile`
`{displayName,shortBio?,photoUrl?,intention,broadArea}` · `PUT /api/profile/interests` `{interestIds:[..]}` ·
`GET|PUT /api/preferences` `{broadArea?,minAge?,maxAge?,isPaused?}`

**Discovery** - `GET /api/discover?limit=20` (cards include `whyShown`, `sharedInterests`) ·
`POST /api/discover/:userId/like` (returns `mutual`, `connectionId`) · `POST /api/discover/:userId/pass`

**Connections & chat** - `GET /api/connections` · `POST /api/connections/:id/unmatch` ·
`GET|POST /api/connections/:id/messages` (`?before=&limit=`)

**Meetups** - `GET /api/venues` · `GET|POST /api/connections/:id/meetups`
`{venueId,scheduledAt (ISO 8601),shareWithTrustedContact}` · `PATCH /api/meetups/:id` `{status: accepted|declined|cancelled}`

**Safety** - `POST /api/safety/blocks/:userId` · `GET /api/safety/blocks` · `DELETE /api/safety/blocks/:userId` ·
`POST /api/safety/reports` `{reportedUserId,connectionId?,reason,details?,alsoBlock?}` ·
`GET|POST /api/safety/trusted-contacts` · `DELETE /api/safety/trusted-contacts/:id`

**Admin** (role `admin`) - `GET /api/admin/reports?status=` · `PATCH /api/admin/reports/:id` `{status,suspendReportedUser?}`

Errors always look like `{ "error": "message", "details": [...] }` with a proper HTTP status (400, 401, 403, 404, 409, 500).

## Flutter notes
- Android emulator reaches your PC at `http://10.0.2.2:3000`; iOS simulator at `http://localhost:3000`.
- Store the JWT securely (e.g. `flutter_secure_storage`) and send it in the `Authorization` header.
- Chat uses simple polling (`GET .../messages`). WebSockets are left as future work.

## Scope / limits (matches the report)
Prototype only: no identity or age verification (the 18+ check is self-declared date of birth), no live moderation,
no payments, no live tracking. Before any real use you would still need a threat model, HTTPS, refresh tokens,
email verification, push notifications, and a data-retention policy.
