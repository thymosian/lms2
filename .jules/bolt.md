## 2025-03-17 - [Missing Database Indexes for Dashboard Queries]
**Learning:** The dashboard and training pages perform frequent filtering queries against `Course.createdBy`, `Enrollment.courseId` (for joins and filtering), and `Notification.userId` (for header polling). However, the `prisma/schema.prisma` file is missing indexes for these fields. This is a common pattern where nested relation queries or frequent polling on un-indexed foreign keys can cause slow full table scans as data grows.
**Action:** Always verify foreign keys and frequently queried fields in `schema.prisma` have the appropriate `@@index` decorators, especially when used in dashboard analytics or layout polling.

<<<<<<< HEAD
## 2025-03-17 - [Unused Code in DashboardCharts.tsx]
**Learning:** During a code health task to remove an unused `Button` import in `src/components/dashboard/DashboardCharts.tsx` (which had already been removed), it was noticed that the `COLORS` object and `truncateLabel` function are currently defined but unused in the file.
**Action:** Log a future task to review, test, and potentially remove the `COLORS` object and `truncateLabel` function in `src/components/dashboard/DashboardCharts.tsx` to improve code maintainability.

=======
>>>>>>> origin/bolt-dashboard-stats-optimization-3644226783387250353
## 2024-03-18 - [Prisma N+1 and Redundant Query Opt]
**Learning:** Found a pattern where data returned implicitly by Prisma `include` is re-queried explicitly in a separate query (e.g. `courses.include({ enrollments: true })` followed by `enrollments.findMany()`). This creates a complete N+1 anti-pattern via redundant `Promise.all` fetching that wastes database connections and compute.
**Action:** Always inspect the full return shape of existing Prisma queries in a module before initiating a new query. If the data is already eager-loaded via `include`, use JS transformations (e.g., `.flatMap()`) on the application server rather than making a second database trip.

<<<<<<< HEAD
## 2025-03-22 - [Merge Dashboard Data Queries]
**Learning:** Found an anti-pattern in `src/app/dashboard/(main)/page.tsx` and `src/app/dashboard/(main)/training/page.tsx` where both `getCourses()` and `getDashboardStats()` were called in parallel. Both queried the database for all `course` objects and associated `enrollments` + `lessons` using `prisma.course.findMany()`, resulting in a redundant database request (Prisma N+1 / redundant query anti-pattern).
**Action:** Replaced both calls with a single `getDashboardData()` query that returns `{ courses, stats }` in one pass, slicing database queries in half for dashboard rendering.


## 2025-03-22 - [Merge Auditor Dashboard Queries]
**Learning:** Found a pattern in `src/app/dashboard/(main)/auditor-pack/page.tsx` where `getAuditorOverviewStats()` and `getAuditorCourses()` were executed in parallel via `Promise.all`. Both functions performed the exact same initial query (`prisma.user.findMany`) to resolve `orgUserIds` for the organization before proceeding with their respective statistical and relation queries. This caused redundant initial database hits.
**Action:** When a dashboard requires multiple aggregations or relation sets for the same root entities (e.g., users within an organization), merge the operations into a single unified data fetching function (e.g., `getAuditorPackData()`) that fetches the shared scope variables once and then uses `Promise.all` internally to execute the actual aggregations and queries concurrently.

## 2025-03-22 - [React Cache for Redundant Query Prevention]
**Learning:** In the dashboard pages, functions like `getAuditorOverviewStats()` and `getAuditorCourses()` are executed in parallel via `Promise.all`. However, they both performed an identical database query (`prisma.user.findMany`) to resolve `orgUserIds` first. Attempting to solve this by merging the functions into a single `getAuditorPackData(search)` led to a performance regression where searching unnecessarily re-calculated overview stats.
**Action:** When parallel server actions depend on a shared, identical database query (like fetching context IDs), extract that query into a helper function and wrap it in `React.cache()`. This ensures that when the actions execute concurrently within the same request lifecycle (e.g., initial page load), Next.js automatically deduplicates the query, hitting the database only once without forcing unrelated endpoints to be bundled together.
=======
## 2025-03-17 - [Unused Code in DashboardCharts.tsx]
**Learning:** During a code health task to remove an unused `Button` import in `src/components/dashboard/DashboardCharts.tsx` (which had already been removed), it was noticed that the `COLORS` object and `truncateLabel` function are currently defined but unused in the file.
**Action:** Log a future task to review, test, and potentially remove the `COLORS` object and `truncateLabel` function in `src/components/dashboard/DashboardCharts.tsx` to improve code maintainability.

## 2025-03-22 - [Merge Dashboard Data Queries]
**Learning:** Found an anti-pattern in `src/app/dashboard/(main)/page.tsx` and `src/app/dashboard/(main)/training/page.tsx` where both `getCourses()` and `getDashboardStats()` were called in parallel. Both queried the database for all `course` objects and associated `enrollments` + `lessons` using `prisma.course.findMany()`, resulting in a redundant database request (Prisma N+1 / redundant query anti-pattern).
**Action:** Replaced both calls with a single `getDashboardData()` query that returns `{ courses, stats }` in one pass, slicing database queries in half for dashboard rendering.
>>>>>>> origin/bolt-dashboard-stats-optimization-3644226783387250353
