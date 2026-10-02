/* The one source of test ids. Components and Playwright import the same names,
   so a rename is a type error, not a broken test. Format: area-element[-recordId],
   kebab-case, never display text. */
const k = (...parts: (string | number)[]) =>
  parts.map(p => String(p).replace(/[^A-Za-z0-9-]+/g, '-')).join('-');

export const tid = {
  app: 'app-root',
  page: (view: string) => k('page', view),
  signIn: {
    form: 'sign-in-form', email: 'sign-in-email', password: 'sign-in-password', submit: 'sign-in-submit',
    error: 'sign-in-error', showAccounts: 'sign-in-show-accounts', storageNote: 'sign-in-storage-note', account: (email: string) => k('sign-in-account', email),
    storageTip: 'sign-in-storage-tip',
  },
  nav: {
    group: (key: string) => k('nav-group', key),
    tab: (view: string) => k('nav-tab', view),
    menu: (group: string) => k('nav-menu', group),
    bottom: (view: string) => k('nav-bottom', view),
    more: 'nav-bottom-more',
  },
  shell: {
    rolePill: 'shell-role-pill', bell: 'shell-bell', bellCount: 'shell-bell-count', theme: 'shell-theme',
    account: 'shell-account', signOut: 'shell-sign-out', viewAsEnd: 'shell-view-as-end',
    viewAs: (personCode: string) => k('shell-view-as', personCode),
    menuAccount: 'shell-menu-account', menuRole: 'shell-menu-role', menuViewAsEnd: 'shell-menu-view-as-end',
    menuViewAsLoading: 'shell-menu-view-as-loading', menuViewAsError: 'shell-menu-view-as-error',
    loading: 'shell-loading', error: 'shell-error', retry: 'shell-retry',
  },
  notBuilt: { root: 'not-built', subProject: 'not-built-sub-project' },
  setup: { card: (view: string) => k('setup-card', view), cardDescription: (view: string) => k('setup-description', view) },
  access: {
    table: 'access-table',
    cell: (cap: string, userType: string) => k('access-cell', cap, userType),
    userTypeName: (userType: string) => k('access-user-type-name', userType),
    groupRow: (group: string) => k('access-group-row', group),
    capRow: (cap: string) => k('access-cap-row', cap),
    usersTable: 'access-users-table', caution: 'access-caution',
    userRow: (email: string) => k('access-user-row', email),
    exceptions: (email: string) => k('access-user-exceptions', email),
    exceptionAdd: (email: string) => k('access-exception-add', email),
    exceptionCap: 'access-exception-cap', exceptionMode: 'access-exception-mode',
    exceptionReason: 'access-exception-reason', exceptionSave: 'access-exception-save',
    exceptionRemove: (email: string, cap: string) => k('access-exception-remove', email, cap),
    reach: 'access-reach', reachTip: 'access-reach-tip', usersTip: 'access-users-tip',
  },
  audit: {
    table: 'audit-table', row: (id: string) => k('audit-row', id),
    filterEntity: 'audit-filter-entity', filterWho: 'audit-filter-who', filterText: 'audit-filter-text',
    error: 'audit-error',
  },
  /* plan 1b: the people lists, the person record, the person form and the lifecycle dialog */
  people: {
    table: 'people-table', row: (code: string) => k('people-row', code), search: 'people-search', stateFilter: 'people-state-filter',
    locationFilter: 'people-location-filter', typeFilter: 'people-type-filter', categoryFilter: 'people-category-filter',
    count: 'people-count', empty: 'people-empty', error: 'people-error', add: 'people-add',
    open: (code: string) => k('people-open', code), edit: (code: string) => k('people-edit', code), state: (code: string) => k('people-state', code),
  },
  person: {
    record: 'person-record', state: 'person-state', history: 'person-history', historyRow: (id: string) => k('person-history-row', id),
    close: 'person-close', fact: (key: string) => k('person-fact', key), stat: (key: string) => k('person-stat', key),
    edit: 'person-edit', changeState: 'person-change-state', error: 'person-error',
  },
  personForm: {
    root: 'person-form', field: (name: string) => k('person-form', name), save: 'person-form-save',
    cancel: 'person-form-cancel', warn: 'person-form-warn', changeState: 'person-form-change-state',
  },
  lifecycle: {
    from: 'lifecycle-from', option: (state: string) => k('lifecycle-option', state), reason: 'lifecycle-reason',
    save: 'lifecycle-save', cancel: 'lifecycle-cancel', warn: 'lifecycle-warn', caution: 'lifecycle-caution',
  },
  /* plan 1b: My profile, proposing a change, and the manager and payroll approval queues */
  profile: {
    propose: 'profile-propose', value: (key: string) => k('profile-value', key), pending: (key: string) => k('profile-pending', key),
    pendingCount: 'profile-pending-count', field: (key: string) => k('profile-field', key), payroll: (key: string) => k('profile-payroll', key),
    note: 'profile-note', send: 'profile-send', cancel: 'profile-cancel', warn: 'profile-warn', fact: (key: string) => k('profile-fact', key),
    off: 'profile-off', state: 'profile-state', error: 'profile-error', managedTip: 'profile-managed-tip', detailsTip: 'profile-details-tip',
  },
  queue: {
    root: (stage: string) => k('profile-queue', stage), row: (id: string) => k('profile-queue-row', id),
    approve: (id: string) => k('profile-queue-approve', id), decline: (id: string) => k('profile-queue-decline', id),
    payroll: (id: string) => k('profile-queue-payroll', id), reason: 'profile-queue-reason',
    confirmDecline: 'profile-queue-confirm-decline', cancelDecline: 'profile-queue-cancel-decline', warn: 'profile-queue-warn',
    count: (stage: string) => k('profile-queue-count', stage),
  },
  /* plan 1b: Dimensions (aloc) and Contracts (acon) */
  dims: {
    card: (kind: string) => k('dims-card', kind), cardDescription: (kind: string) => k('dims-description', kind), back: 'dims-back', add: 'dims-add',
    table: 'dims-table', row: (code: string) => k('dims-row', code), edit: (code: string) => k('dims-edit', code),
    cell: (code: string, key: string) => k('dims-cell', code, key), field: (key: string) => k('dims-form', key),
    save: 'dims-form-save', remove: 'dims-form-remove', cancel: 'dims-form-cancel', warn: 'dims-form-warn',
    groupTip: (kind: string) => k('dims-group', kind, 'tip'), empty: 'dims-empty', error: 'dims-error',
  },
  contracts: {
    table: 'contracts-table', row: (code: string) => k('contracts-row', code), edit: (code: string) => k('contracts-edit', code),
    hours: 'contracts-hours', max: 'contracts-max', save: 'contracts-save', cancel: 'contracts-cancel', warn: 'contracts-warn',
    state: (code: string) => k('contracts-state', code), error: 'contracts-error',
  },
  /* plan 1b: Employee types (atypes) */
  types: {
    list: 'types-list', chip: (code: string) => k('types-chip', code), add: 'types-add', detail: 'types-detail',
    field: (key: string) => k('types-form', key), cap: (code: string) => k('types-cap', code), save: 'types-save',
    remove: 'types-remove', warn: 'types-warn', jobs: 'types-jobs', jobsLink: 'types-jobs-link', tip: 'types-tip',
    newField: (key: string) => k('types-new', key), newSave: 'types-new-save', newCancel: 'types-new-cancel', newWarn: 'types-new-warn',
    error: 'types-error', heldBy: 'types-held-by',
  },
  /* A Field's own ids come from the control it wraps, so a form never types one by hand. */
  field: { root: (controlTestId: string) => `${controlTestId}-field`, tip: (controlTestId: string) => `${controlTestId}-field-tip` },
  modal: { root: 'modal', title: 'modal-title', close: 'modal-close', confirm: 'modal-confirm', cancel: 'modal-cancel' },
  toast: { info: 'toast-info', error: 'toast-error', next: 'toast-next' },
  /* A page head's own affordances (src/ui/Page.tsx): its i tip and its standing caution. */
  head: { tip: (view: string) => k('head-tip', view), caution: (view: string) => k('head-caution', view) },
  /* module 2: a page's guide behind `?` (src/ui/Guide.tsx) */
  guide: { open: (view: string) => k('guide-open', view), close: 'guide-close' },
  /* module 2: My timesheet (ts): the page, the day view's frame and the week view's frame */
  ts: {
    view: (v: string) => k('ts-view', v), error: 'ts-error',
    dayPrev: 'ts-day-prev', dayNext: 'ts-day-next', dayToday: 'ts-day-today', dayLabel: 'ts-day-label', dayState: 'ts-day-state',
    nonWorking: 'ts-non-working', copyDay: 'ts-copy-day', reason: 'ts-reason', reasonNotes: 'ts-reason-notes',
    workedAnyway: 'ts-worked-anyway', submitReason: 'ts-submit-reason', entryTip: 'ts-entry-tip', banner: (kind: string) => k('ts-banner', kind),
    weekPrev: 'ts-week-prev', weekNext: 'ts-week-next', weekToday: 'ts-week-today', weekLabel: 'ts-week-label', weekState: 'ts-week-state',
    fillRota: 'ts-fill-rota', submitWeek: 'ts-submit-week', weekTotal: 'ts-week-total', contracted: 'ts-contracted', weekResult: 'ts-week-result',
    multiweek: 'ts-multiweek', mwTip: 'ts-multiweek-tip', mwAll: 'ts-multiweek-all', mwRow: (ws: string) => k('ts-multiweek-row', ws),
    mwCheck: (ws: string) => k('ts-multiweek-check', ws), mwState: (ws: string) => k('ts-multiweek-state', ws), mwSubmit: 'ts-multiweek-submit',
    mwResult: 'ts-multiweek-result',
  },
  /* module 2: the day form, shared by My timesheet and proxy entry */
  dayForm: {
    field: (code: string) => k('day-form', code), tip: (code: string) => k('day-form-tip', code), group: (key: string) => k('day-form-group', key),
    addBreak: 'day-form-add-break', save: 'day-form-save', submit: 'day-form-submit', warn: 'day-form-warn', check: 'day-form-check',
    stat: (key: string) => k('day-form-stat', key), rateTip: 'day-form-rate-tip', empty: 'day-form-empty', refusal: 'day-form-refusal',
  },
  /* module 2: the weekly grid in its three layouts, shared by My timesheet and proxy entry */
  week: {
    grid: 'week-grid', empty: 'week-empty', allocRow: (row: number) => k('week-alloc-row', row), row: (row: number) => k('week-row', row),
    cell: (row: number, day: number, part: string) => k('week-cell', row, day, part), ctx: (row: number, field: string) => k('week-ctx', row, field),
    addAlloc: 'week-add-alloc', delAlloc: (row: number) => k('week-del-alloc', row), rowTotal: (row: number) => k('week-row-total', row),
    dayTotal: (day: number) => k('week-day-total', day), total: 'week-total', alloc: 'week-alloc', allocTip: 'week-alloc-tip',
    day: (day: number) => k('week-day', day), addLine: (day: number) => k('week-add-line', day), delLine: (day: number, line: number) => k('week-del-line', day, line),
    lineCtx: (day: number, line: number, field: string) => k('week-line-ctx', day, line, field),
    lineCell: (day: number, line: number, part: string) => k('week-line-cell', day, line, part), closed: (day: number) => k('week-closed', day),
  },
} as const;
