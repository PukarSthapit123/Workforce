import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { tid } from '@/testids';

export function AccountMenu({ onSignOut }: { onSignOut(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid={tid.shell.account} aria-label="Account" className="rounded-pill bg-brand-accent px-sm py-xs text-foreground">Account</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid={tid.shell.signOut} onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
