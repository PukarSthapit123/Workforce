import { useCurrentSession } from '@/shell/SessionProvider';
import { useCaps } from '@/shell/useCaps';
import { ProfileQueue } from '@/features/profile/ProfileQueue';
import { EmployeesWorkspace } from './EmployeesWorkspace';

/* My team · Employees (mgrEmployees, qnipay-workforce-v15.html:7613): the employees at
   the manager's own location (plan 1b decision D5), with the profile changes
   awaiting them above, as the prototype puts them. */
export function TeamEmployeesPage() {
  const where = useCurrentSession()?.account.locationName, caps = useCaps();
  return <EmployeesWorkspace variant="team" view="temployees" crumb="My team · Employees"
    tip={where ? `The employees at ${where}.` : 'The employees at your location.'}
    above={caps.has('profile_appr') ? <ProfileQueue stage="manager" /> : undefined} />;
}
