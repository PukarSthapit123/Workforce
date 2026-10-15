import { useCaps } from '@/shell/useCaps';
import { ProfileQueue } from '@/features/profile/ProfileQueue';
import { EmployeesWorkspace } from './EmployeesWorkspace';

/* Qnipay setup · Employees (admEmployees, qnipay-workforce-v15.html:8041). Bank
   detail changes a manager has approved wait here for payroll (D3). */
export function AdminEmployeesPage() {
  const caps = useCaps();
  return <EmployeesWorkspace variant="admin" view="aemployees" crumb="Qnipay setup · Employees"
    tip="The one employee record. Timesheet, Rota and Leave all read this list."
    above={caps.has('bank_verify') ? <ProfileQueue stage="payroll" /> : undefined} />;
}
