import { DashboardRedirect } from './_redirect';

// /dashboard is a thin client-side redirector. It hits
// /dashboard/available, then pushes to the user's primary variant
// (/dashboard/employee | /manager | /admin). We keep it client-side
// so the same ['dashboard','available'] query cache backs the header
// switcher dropdown without a duplicate server fetch.
export default function DashboardIndex() {
  return <DashboardRedirect />;
}
