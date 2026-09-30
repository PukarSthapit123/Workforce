import { useCaps } from '@/shell/useCaps';
import { ProfileQueue } from '@/features/profile/ProfileQueue';
import { PeopleWorkspace } from './PeopleWorkspace';

/* Qnipay setup · People (admPeople, qnipay-workforce-v15.html:8041). Bank
   detail changes a manager has approved wait here for payroll (D3). */
export function AdminPeoplePage() {
  const caps = useCaps();
  return <PeopleWorkspace variant="admin" view="apeople" crumb="Qnipay setup · People"
    tip="The one employee record. Timesheet, Rota and Leave all read this list."
    above={caps.has('bank_verify') ? <ProfileQueue stage="payroll" /> : undefined} />;
}
