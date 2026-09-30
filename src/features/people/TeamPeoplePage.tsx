import { useCurrentSession } from '@/shell/SessionProvider';
import { PeopleWorkspace } from './PeopleWorkspace';

/* My team · People (mgrPeople, qnipay-workforce-v15.html:7613): the people at
   the manager's own location (plan 1b decision D5). */
export function TeamPeoplePage() {
  const where = useCurrentSession()?.account.locationName;
  return <PeopleWorkspace variant="team" view="tpeople" crumb="My team · People"
    tip={where ? `The people at ${where}.` : 'The people at your location.'} />;
}
