import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { useViewAsPeople } from '@/api/session';
import { tid } from '@/testids';

export interface MenuAccount { name: string; email: string; personCode: string; roleName: string; roleDescription: string; locationName: string }

/* Ported from the prototype's drawMenu (qnipay-workforce-v15.html:10765-10790):
   who you are signed in as (name, email, role, location and ID), a "Your
   account" line, then, for a holder of perm_cfg, one person per role to look
   at the app as. While viewing as someone the menu names them and offers the
   way back instead, since starting another view is refused until then. */
export function AccountMenu({ account, viewingAs, canViewAs, onSignOut, onViewAs, onEndViewAs }: {
  account: MenuAccount; viewingAs: string | null; canViewAs: boolean;
  onSignOut(): void; onViewAs(personCode: string): void; onEndViewAs(): void;
}) {
  const [open, setOpen] = useState(false);
  const offerViewAs = canViewAs && !viewingAs;
  const people = useViewAsPeople(open && offerViewAs);
  const sub = 'block text-xs text-text-secondary';
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger data-testid={tid.shell.account} aria-label={`Account: ${account.name}`} className="inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-pill bg-brand-accent px-sm py-xs text-text-on-accent">Account</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-xs">
        <div data-testid={tid.shell.menuAccount} className="px-sm py-xs">
          <div className="font-semibold">{account.name}</div>
          <div className="text-xs text-text-secondary">{account.email}</div>
          <div className="text-xs text-text-secondary">{[account.roleName, account.locationName, account.personCode].filter(Boolean).join(' · ')}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-text-secondary">Your account</DropdownMenuLabel>
        <div data-testid={tid.shell.menuRole} className="flex items-start justify-between gap-sm px-sm py-xs">
          <span>{account.roleName}<span className={sub}>{account.roleDescription}</span></span>
          <span aria-hidden="true">✓</span>
        </div>
        {viewingAs && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-text-secondary">Looking at the app as {viewingAs}</DropdownMenuLabel>
          <DropdownMenuItem data-testid={tid.shell.menuViewAsEnd} onSelect={onEndViewAs} className="min-h-touch">
            <span>Return to my account<span className={sub}>{account.name}</span></span>
          </DropdownMenuItem>
        </>}
        {offerViewAs && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-text-secondary">Look at the app as somebody else</DropdownMenuLabel>
          {people.isPending && <p data-testid={tid.shell.menuViewAsLoading} className="px-sm py-xs text-xs text-text-secondary">Loading people&hellip;</p>}
          {people.isError && <p data-testid={tid.shell.menuViewAsError} className="px-sm py-xs text-xs text-err">The list could not be loaded. Close the menu and open it again to retry.</p>}
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
