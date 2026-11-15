// Executive Dashboard (V40): rebuilt in pages/executive. Kept as the entry point ModulePage already imports.
import { ExecutiveDashboard } from './executive/ExecutiveDashboard';
import type { User } from '../types';

export function DashboardPage({ user }: { user: User }) {
  return <ExecutiveDashboard user={user} />;
}
