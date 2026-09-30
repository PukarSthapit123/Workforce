import { useCurrentSession } from '@/shell/SessionProvider';
import { useCaps } from '@/shell/useCaps';
import { ProfileQueue } from '@/features/profile/ProfileQueue';
import { PeopleWorkspace } from './PeopleWorkspace';

/* My team · People (mgrPeople, qnipay-workforce-v15.html:7613): the people at
   the manager's own location (plan 1b decision D5), with the profile changes
   awaiting them above, as the prototype puts them. */
export function TeamPeoplePage() {
  const where = useCurrentSession()?.account.locationName, caps = useCaps();
  return <PeopleWorkspace variant="team" view="tpeople" crumb="My team · People"
    tip={where ? `The people at ${where}.` : 'The people at your location.'}
    above={caps.has('profile_appr') ? <ProfileQueue stage="manager" /> : undefined} />;
}
