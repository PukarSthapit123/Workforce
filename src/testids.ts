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
  /* A Field's own ids come from the control it wraps, so a form never types one by hand. */
  field: { root: (controlTestId: string) => `${controlTestId}-field`, tip: (controlTestId: string) => `${controlTestId}-field-tip` },
  modal: { root: 'modal', title: 'modal-title', close: 'modal-close', confirm: 'modal-confirm', cancel: 'modal-cancel' },
  toast: { info: 'toast-info', error: 'toast-error', next: 'toast-next' },
  /* A page head's own affordances (src/ui/Page.tsx): its i tip and its standing caution. */
  head: { tip: (view: string) => k('head-tip', view), caution: (view: string) => k('head-caution', view) },
} as const;
