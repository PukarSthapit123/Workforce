import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { tid } from '@/testids';

export function AccountMenu({ onSignOut }: { onSignOut(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid={tid.shell.account} aria-label="Account" className="inline-flex min-h-touch shrink-0 items-center whitespace-nowrap rounded-pill bg-brand-accent px-sm py-xs text-text-on-accent">Account</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid={tid.shell.signOut} onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
