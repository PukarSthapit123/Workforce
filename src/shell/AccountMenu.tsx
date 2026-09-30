import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { useViewAsPeople } from '@/api/session';
import { tid } from '@/testids';

export interface MenuAccount { name: string; email: string; personCode: string; roleName: string; roleDescription: string; locationName: string }

/* The prototype's initials(): the first letter of each word, two at most. */
const initials = (name: string) => name.split(' ').map(w => w.charAt(0)).join('').slice(0, 2).toUpperCase();

/* Ported from the prototype's drawMenu (qnipay-workforce-v15.html:10765-10790):
   who you are signed in as (name, email, role, location and ID), a "Your
   account" line, then, for a holder of perm_cfg, one person per role to look
   at the app as. While viewing as someone the menu names them and offers the
   way back instead, since starting another view is refused until then.

   Its look is the prototype's .menu (v15:321-337, 1553): 308px, radius 12, a
   light border, shadow-lg, 8px in; a header block over a rule; section labels
   at 12px/700 with .08em tracking; the role you hold filled with the brand's
   subtle tint and a brand tick. The trigger is the avatar: a 30px accent disc
   with your initials, then ▾ (.avbtn, .av; v15:316-320), inside a 44px
   target. */
export function AccountMenu({ account, viewingAs, canViewAs, onSignOut, onViewAs, onEndViewAs }: {
  account: MenuAccount; viewingAs: string | null; canViewAs: boolean;
  onSignOut(): void; onViewAs(personCode: string): void; onEndViewAs(): void;
}) {
  const [open, setOpen] = useState(false);
  const offerViewAs = canViewAs && !viewingAs;
  const people = useViewAsPeople(open && offerViewAs);
  const sub = 'block text-xs font-normal text-text-muted';
  const label = 'px-[11px] pt-[9px] pb-xs';
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger data-testid={tid.shell.account} aria-label={`Account: ${account.name}`}
        className="group inline-flex min-h-touch shrink-0 items-center rounded-pill focus-visible:shadow-none">
        <span className="flex items-center gap-[7px] rounded-pill py-[3px] pr-sm pl-[3px] text-text-on-inverse transition-colors duration-(--qp-duration-fast) group-hover:bg-shell-hover group-focus-visible:shadow-focus group-data-[state=open]:bg-shell-hover">
          <span aria-hidden="true" className="grid size-[30px] shrink-0 place-items-center rounded-pill bg-brand-accent text-xs font-bold text-text-on-accent">{initials(account.name)}</span>
          <span aria-hidden="true" className="text-xs">▾</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={0} className="w-[308px] max-h-[78vh] max-md:w-[min(340px,calc(100vw-24px))]">
        <div data-testid={tid.shell.menuAccount} className="mb-[6px] border-b p-md">
          <div className="text-sm font-semibold">{account.name}</div>
          <div className="text-xs text-text-muted">{account.email}</div>
          <div className="mt-[2px] text-xs text-text-muted">{[account.roleName, account.locationName, account.personCode].filter(Boolean).join(' · ')}</div>
        </div>
        <DropdownMenuLabel className={label}>Your account</DropdownMenuLabel>
        <div data-testid={tid.shell.menuRole} className="flex items-center gap-[10px] rounded-sm bg-brand-subtle px-[11px] py-[9px] text-sm font-semibold">
          <span>{account.roleName}<span className={sub}>{account.roleDescription}</span></span>
          <span aria-hidden="true" className="ml-auto font-bold text-brand dark:text-brand-accent">✓</span>
        </div>
        {viewingAs && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className={label}>Looking at the app as {viewingAs}</DropdownMenuLabel>
          <DropdownMenuItem data-testid={tid.shell.menuViewAsEnd} onSelect={onEndViewAs} className="min-h-touch">
            <span>Return to my account<span className={sub}>{account.name}</span></span>
          </DropdownMenuItem>
        </>}
        {offerViewAs && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className={label}>Look at the app as somebody else</DropdownMenuLabel>
          {people.isPending && <p data-testid={tid.shell.menuViewAsLoading} className="px-[11px] py-[9px] text-xs text-text-muted">Loading people&hellip;</p>}
          {people.isError && <p data-testid={tid.shell.menuViewAsError} className="px-[11px] py-[9px] text-xs text-err">The list could not be loaded. Close the menu and open it again to retry.</p>}
          {people.data?.map(p => (
            <DropdownMenuItem key={p.personCode} data-testid={tid.shell.viewAs(p.personCode)} onSelect={() => onViewAs(p.personCode)} className="min-h-touch">
              <span>{p.name}<span className={sub}>{[p.roleName, p.locationName, p.onboarding ? 'onboarding' : ''].filter(Boolean).join(' · ')}</span></span>
            </DropdownMenuItem>))}
        </>}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid={tid.shell.signOut} onSelect={onSignOut} className="min-h-touch">Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
