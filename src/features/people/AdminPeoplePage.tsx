import { PeopleWorkspace } from './PeopleWorkspace';

/* Qnipay setup · People (admPeople, qnipay-workforce-v15.html:8041). */
export function AdminPeoplePage() {
  return <PeopleWorkspace variant="admin" view="apeople" crumb="Qnipay setup · People"
    tip="The one employee record. Timesheet, Rota and Leave all read this list." />;
}
