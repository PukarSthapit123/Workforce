import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Row } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCapabilities, useCapabilityGroups, useUserTypes, useUsers, useSetTemplateCapability, type Capability, type UserType } from '@/api/access';
import { UserExceptions } from './UserExceptions';

function exceptionsSummary(typeName: string, grants: readonly string[], revocations: readonly string[]): string {
  const n = grants.length + revocations.length;
  if (n === 0) return typeName;
  return `${typeName} + ${n} exception${n === 1 ? '' : 's'}`;
}

/* Layout follows the prototype's admPermissions (qnipay-workforce-v15.html:7900-7930):
   a template matrix, then who holds each persona. Per-user exceptions (the
   users table and UserExceptions modal) are new in this rebuild: the
   prototype only ever toggled the shared template. */
export function PermissionsPage() {
  const capabilities = useCapabilities();
  const groups = useCapabilityGroups();
  const userTypes = useUserTypes();
  const users = useUsers();
  const setCap = useSetTemplateCapability();
  const [exceptionsForEmail, setExceptionsForEmail] = useState<string | null>(null);

  if (capabilities.isPending || groups.isPending || userTypes.isPending || users.isPending) {
    return (
      <section data-testid={tid.page('aperm')} className="mx-auto max-w-5xl p-xl">
        <p className="text-text-secondary">Loading permissions&hellip;</p>
      </section>);
  }
  if (capabilities.isError || groups.isError || userTypes.isError || users.isError) {
    return (
      <section data-testid={tid.page('aperm')} className="mx-auto max-w-5xl p-xl">
        <p className="text-err">Permissions could not be loaded. Nothing has changed.</p>
      </section>);
  }

  const caps = capabilities.data;
  const types = userTypes.data;
  const typeName = (id: string) => types.find(t => t.id === id)?.name ?? id;

  function toggle(c: Capability, t: UserType) {
    const had = t.capabilities.includes(c.id);
    setCap.mutate({ id: t.id, cap: c.id, granted: !had, ifMatch: t.version });
  }

  const exceptionsUser = users.data.find(u => u.email === exceptionsForEmail) ?? null;
  const exceptionsUserTemplate = exceptionsUser ? types.find(t => t.id === exceptionsUser.userType) : undefined;

  return (
    <section data-testid={tid.page('aperm')} className="mx-auto flex max-w-5xl flex-col gap-lg p-xl">
      <div>
        <h1 className="text-[length:var(--qp-text-20)] font-semibold">Permissions</h1>
        <p className="text-text-secondary">Personas over one application. A manager is an employee record with extra capabilities.</p>
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface-card">
        <Table data-testid={tid.access.table}>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-surface-card">Capability</TableHead>
              <TableHead>What it controls</TableHead>
              {types.map(t => <TableHead key={t.id} data-testid={tid.access.userTypeName(t.id)} className="text-center">{t.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.data.flatMap(g => {
              const capsInGroup = caps.filter(c => c.group === g.id);
              if (!capsInGroup.length) return [];
              return [
                <Row key={`group-${g.id}`} testId={tid.access.groupRow(g.id)} className="bg-surface-sunken">
                  <TableCell colSpan={2 + types.length}>
                    <strong>{g.label}</strong> <span className="text-xs text-text-secondary">{g.description}</span>
                  </TableCell>
                </Row>,
                ...capsInGroup.map(c => (
                  <Row key={c.id} testId={tid.access.capRow(c.id)}>
                    <TableCell className="sticky left-0 bg-surface-card">{c.label}</TableCell>
                    <TableCell className="text-xs text-text-secondary">{c.gate}</TableCell>
                    {types.map(t => {
                      const on = t.capabilities.includes(c.id);
                      const locked = c.lockedFor.includes(t.id);
                      /* M3: while a change to this template is in flight, its
                         cells wait. Every cell in the column sends the same
                         If-Match, so a second click would only earn a 412. */
                      const saving = setCap.isPending && setCap.variables?.id === t.id;
                      return (
                        <TableCell key={t.id} className="text-center">
                          <button type="button" data-testid={tid.access.cell(c.id, t.id)} aria-pressed={on} disabled={locked || saving}
                            aria-label={`${c.label}, ${t.name}: ${on ? 'granted' : 'not granted'}${locked ? ', locked' : ''}`} aria-busy={saving || undefined}
                            title={locked ? 'Locked. An administrator cannot remove their own access to this page.' : undefined}
                            onClick={() => toggle(c, t)}
                            className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-control border ${on ? 'border-brand bg-brand-accent' : 'border-border'} disabled:cursor-not-allowed disabled:opacity-60`}>
                            {on ? '✓' : '—'}
                          </button>
                        </TableCell>);
                    })}
                  </Row>
                )),
              ];
            })}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="font-semibold">People with a persona</h2>
        <p className="text-text-secondary">Their template, plus any exceptions for that person only.</p>
      </div>
      <div className="overflow-x-auto rounded-card border border-border">
        <Table data-testid={tid.access.usersTable}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Persona</TableHead>
              <TableHead>Exceptions</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.map(u => (
              <Row key={u.email} testId={tid.access.userRow(u.email)}>
                <TableCell><strong>{u.name}</strong></TableCell>
                <TableCell className="text-text-secondary">{u.email}</TableCell>
                <TableCell>{typeName(u.userType)}</TableCell>
                <TableCell data-testid={tid.access.exceptions(u.email)}>{exceptionsSummary(typeName(u.userType), u.grants, u.revocations)}</TableCell>
                <TableCell className="text-right">
                  <Button testId={tid.access.exceptionAdd(u.email)} kind="ghost" small onClick={() => setExceptionsForEmail(u.email)}>Add exception</Button>
                </TableCell>
              </Row>))}
          </TableBody>
        </Table>
      </div>

      <UserExceptions user={exceptionsUser} capabilities={caps} typeName={exceptionsUser ? typeName(exceptionsUser.userType) : ''}
        templateCapabilities={exceptionsUserTemplate?.capabilities ?? []} onClose={() => setExceptionsForEmail(null)} />
    </section>);
}
