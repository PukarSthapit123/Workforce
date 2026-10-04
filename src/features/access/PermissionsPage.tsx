import { useState } from 'react';
import { Eye, Lock } from 'lucide-react';
import { tid } from '@/testids';
import { cn } from '@/lib/utils';
import { buildNav } from '@/domain/nav';
import { AdminCard, Button, Caution, Page, PageHead, Pill, Row, ScopeBadge, SectionHead } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCapabilities, useCapabilityGroups, useUserTypes, useUsers, useSetTemplateCapability, type Capability, type Self, type UserType } from '@/api/access';
import { useCurrentSession } from '@/shell/SessionProvider';
import { useTenant } from '@/shell/shellData';
import { UserExceptions } from './UserExceptions';
import { RenameRolesDialog } from './RenameRoles';

function exceptionsSummary(typeName: string, grants: readonly string[], revocations: readonly string[]): string {
  const n = grants.length + revocations.length;
  if (n === 0) return typeName;
  return `${typeName} + ${n} exception${n === 1 ? '' : 's'}`;
}

const HEAD = { title: 'Permissions', crumb: 'Qnipay setup · Permissions',
  tip: 'Personas over one application. A manager is an employee record with extra capabilities.' };
/* The capabilities the prototype lists as a persona's extra actions, beyond
   the pages it can reach (admPermissions, v15:8352). */
const EXTRA_ACTIONS = ['claim', 'proxy'];

/* Layout follows the prototype's admPermissions (qnipay-workforce-v15.html:8323-8367):
   a template matrix, then what each persona can reach as a result, then who
   holds each persona. Per-user exceptions (the users table and UserExceptions
   modal) are new in this rebuild: the prototype only ever toggled the shared
   template. They take the prototype's persona table's look. */
export function PermissionsPage() {
  const capabilities = useCapabilities();
  const groups = useCapabilityGroups();
  const userTypes = useUserTypes();
  const users = useUsers();
  const tenant = useTenant();
  const session = useCurrentSession();
  const self: Self | null = session ? { userType: session.account.userType, email: session.account.email } : null;
  const onScreenType = session?.viewingAs?.userType ?? session?.account.userType;
  const setCap = useSetTemplateCapability(self);
  const [exceptionsForEmail, setExceptionsForEmail] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  if (capabilities.isPending || groups.isPending || userTypes.isPending || users.isPending) {
    return (
      <Page testId={tid.page('aperm')}>
        <PageHead {...HEAD} tipTestId={tid.head.tip('aperm')} />
        <p className="text-text-secondary">Loading permissions&hellip;</p>
      </Page>);
  }
  if (capabilities.isError || groups.isError || userTypes.isError || users.isError) {
    return (
      <Page testId={tid.page('aperm')}>
        <PageHead {...HEAD} tipTestId={tid.head.tip('aperm')} />
        <p className="text-err">Permissions could not be loaded. Nothing has changed.</p>
      </Page>);
  }

  const caps = capabilities.data;
  const types = userTypes.data;
  const typeName = (id: string) => types.find(t => t.id === id)?.name ?? id;

  /* The guard is here as well as in the hook: a pending cell keeps focus
     (aria-disabled, not disabled), so a click or a key press still arrives. */
  function toggle(c: Capability, t: UserType) {
    if (setCap.isPending(t.id) || c.lockedFor.includes(t.id)) return;
    const had = t.capabilities.includes(c.id);
    setCap.mutate({ id: t.id, cap: c.id, granted: !had, ifMatch: t.version });
  }

  const exceptionsUser = users.data.find(u => u.email === exceptionsForEmail) ?? null;
  const exceptionsUserTemplate = exceptionsUser ? types.find(t => t.id === exceptionsUser.userType) : undefined;

  return (
    <Page testId={tid.page('aperm')}>
      <PageHead {...HEAD} tipTestId={tid.head.tip('aperm')}
        actions={/* Ported from the prototype's admPermissions head (v15:8334-8335): Rename
            roles, then the caution. There the checks ran in the browser; here the server enforces them. */
          <>
            <Button testId={tid.roleNames.open} kind="ghost" small onClick={() => setRenaming(true)}>Rename roles</Button>
            <Caution testId={tid.access.caution} text="These switches are live and apply to everyone at once. The server enforces each one, so hiding a control is never the only thing refusing the request, and every change is recorded in the audit log." />
          </>} />
      {renaming && <RenameRolesDialog types={types} self={self} onClose={() => setRenaming(false)} />}

      <Table data-testid={tid.access.table} variant="matrix">
        <TableHeader>
          <TableRow>
            <TableHead>Capability</TableHead>
            <TableHead>What it controls</TableHead>
            {types.map(t => <TableHead key={t.id} data-testid={tid.access.userTypeName(t.id)} className="text-center">
              {t.name}{t.id === onScreenType && <ScopeBadge>You</ScopeBadge>}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.data.flatMap(g => {
            const capsInGroup = caps.filter(c => c.group === g.id);
            if (!capsInGroup.length) return [];
            return [
              <Row key={`group-${g.id}`} testId={tid.access.groupRow(g.id)}>
                <TableCell colSpan={2 + types.length} className="bg-surface-tint max-md:first:bg-surface-tint">
                  <strong>{g.label}</strong> <span className="text-xs text-text-muted">{g.description}</span>
                </TableCell>
              </Row>,
              ...capsInGroup.map(c => (
                <Row key={c.id} testId={tid.access.capRow(c.id)}>
                  <TableCell>{c.label}</TableCell>
                  <TableCell className="text-xs text-text-muted">{c.gate}</TableCell>
                  {types.map(t => {
                    const on = t.capabilities.includes(c.id);
                    const locked = c.lockedFor.includes(t.id);
                    /* M3: while a change to this template is in flight, its
                       cells wait. Every cell in the column sends the same
                       If-Match, so a second click would only earn a 412.
                       Pending is tracked per template, so a save to another
                       template's column stays guarded on its own. */
                    const saving = setCap.isPending(t.id);
                    return (
                      <TableCell key={t.id} className="text-center">
                        <button type="button" data-testid={tid.access.cell(c.id, t.id)} aria-pressed={on} disabled={locked} aria-disabled={saving || undefined}
                          aria-label={`${c.label}, ${t.name}: ${on ? 'granted' : 'not granted'}${locked ? ', locked' : ''}`} aria-busy={saving || undefined}
                          title={locked ? 'Locked. An administrator cannot remove their own access to this page.' : undefined}
                          onClick={() => toggle(c, t)} className={permCell(on, locked)}>
                          {locked ? <><Lock aria-hidden="true" className="size-[13px]" />✓</> : on ? '✓' : '—'}
                        </button>
                      </TableCell>);
                  })}
                </Row>
              )),
            ];
          })}
        </TableBody>
      </Table>

      {tenant.isSuccess && <AdminCard testId={tid.access.reach} icon={<Eye />} title="What each persona can reach right now"
        tip="Worked out from the matrix above, so it changes as you change it." tipTestId={tid.access.reachTip}>
        <div className="grid grid-cols-3 gap-md max-lg:grid-cols-1">
          {types.map(t => {
            const reach = buildNav({ caps: new Set(t.capabilities), modules: tenant.data.modules, flags: tenant.data.flags, onboarding: false });
            const extras = caps.filter(c => EXTRA_ACTIONS.includes(c.id) && t.capabilities.includes(c.id)).map(c => c.label);
            const line = 'block border-b py-sm last:border-b-0';
            return (
              <div key={t.id}>
                <div className="mb-sm text-xs font-bold tracking-[.08em] text-text-muted">{t.name}</div>
                {reach.length ? reach.map(g => <div key={g.key} className={line}>
                  <strong className="text-xs">{g.label}</strong>
                  <div className="text-xs text-text-muted">{g.tabs.map(x => x.label).join(' · ')}</div></div>)
                  : <div className="text-xs text-text-muted">No sections at all. This persona cannot reach anything.</div>}
                <div className={line}><strong className="text-xs">Extra actions</strong>
                  <div className="text-xs text-text-muted">{extras.join(' · ') || 'None'}</div></div>
              </div>);
          })}
        </div>
      </AdminCard>}

      <SectionHead title="People with a persona" tip="Their template, plus any exceptions for that person only." tipTestId={tid.access.usersTip} />
      <Table data-testid={tid.access.usersTable} variant="records">
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead><TableHead>Employee ID</TableHead><TableHead>Persona</TableHead>
            <TableHead>Exceptions</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data.map(u => (
            <Row key={u.email} testId={tid.access.userRow(u.email)}>
              <TableCell kind="title"><strong>{u.name}</strong><span className="block text-xs font-normal text-text-muted">{u.email}</span></TableCell>
              <TableCell label="Employee ID" className="tabular-nums">{u.personCode}</TableCell>
              <TableCell label="Persona"><Pill tone="info">{typeName(u.userType)}</Pill></TableCell>
              <TableCell label="Exceptions" data-testid={tid.access.exceptions(u.email)}>{exceptionsSummary(typeName(u.userType), u.grants, u.revocations)}</TableCell>
              <TableCell kind="foot" className="text-right">
                <Button testId={tid.access.exceptionAdd(u.email)} kind="ghost" small onClick={() => setExceptionsForEmail(u.email)}>Add exception</Button>
              </TableCell>
            </Row>))}
        </TableBody>
      </Table>

      <UserExceptions user={exceptionsUser} capabilities={caps} typeName={exceptionsUser ? typeName(exceptionsUser.userType) : ''}
        templateCapabilities={exceptionsUserTemplate?.capabilities ?? []} self={self} onClose={() => setExceptionsForEmail(null)} />
    </Page>);
}

/* The prototype's .permcell (v15:675-682): 38x28, radius 4, 14px/700. Off is
   the card surface with a strong border and a muted dash; on is the success
   surface with a success border and tick; hover draws the border and ink in
   brand (the accent in dark). A locked cell reads as a success pill with a
   padlock. The cell keeps its drawn size and takes a phone's 44px tap on a
   transparent square around it. */
function permCell(on: boolean, locked: boolean): string {
  return cn(
    'relative inline-grid place-items-center text-sm font-bold transition-[background-color,border-color,color] duration-(--qp-duration-fast) ease-qp before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-1/2',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    locked
      ? 'cursor-not-allowed grid-flow-col gap-xs rounded-pill bg-ok-surface px-[9px] py-[2px] text-xs leading-[1.6] font-semibold text-ok'
      : cn('h-7 w-[38px] rounded-sm border hover:border-brand hover:text-brand dark:hover:border-brand-accent dark:hover:text-brand-accent',
        on ? 'border-ok bg-ok-surface text-ok' : 'border-border-strong bg-surface-card text-text-muted'));
}
