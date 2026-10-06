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
    /* 1c group 8: the phone's Go to sheet behind More (v15:12072) */
    goToList: 'nav-goto-list', goTo: (view: string) => k('nav-goto', view),
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
    /* 1c group 8: the way to My documents under the profile (essProfile, v15:5647) */
    docs: 'profile-docs',
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
    /* 1c group 8: where a type's capture fields, rota eligibility and leave policy are set */
    setupLink: (view: string) => k('types-setup-link', view),
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
  /* module 2: Team timesheets (tteam): the day queue, the week matrix, and the bulk approval and return dialogs */
  tteam: {
    view: (v: string) => k('tteam-view', v), error: 'tteam-error', pending: 'tteam-pending', clear: 'tteam-clear', approveAll: 'tteam-approve-all',
    filter: (f: string) => k('tteam-filter', f), search: 'tteam-search', table: 'tteam-table', row: (id: string) => k('tteam-row', id),
    proxyPill: (id: string) => k('tteam-proxy', id), dot: (id: string) => k('tteam-dot', id), state: (id: string) => k('tteam-state', id),
    history: (id: string) => k('tteam-history', id), approve: (id: string) => k('tteam-approve', id), ret: (id: string) => k('tteam-return', id),
    empty: 'tteam-empty', more: 'tteam-more', refusal: 'tteam-refusal', held: 'tteam-held', elementsTip: 'tteam-elements-tip',
    matrix: 'tteam-matrix', mxAll: 'tteam-mx-all', mxRow: (code: string) => k('tteam-mx-row', code), mxCheck: (code: string) => k('tteam-mx-check', code),
    pip: (code: string, day: number) => k('tteam-pip', code, day), approveSelected: 'tteam-approve-selected',
    weekPrev: 'tteam-week-prev', weekNext: 'tteam-week-next', weekNow: 'tteam-week-now', weekLabel: 'tteam-week-label',
    bulkStat: (key: string) => k('tteam-bulk-stat', key), bulkFlagRow: (id: string) => k('tteam-bulk-flag', id), bulkOutside: 'tteam-bulk-outside',
    bulkAck: 'tteam-bulk-ack', bulkWarn: 'tteam-bulk-warn', bulkConfirm: 'tteam-bulk-confirm', bulkCancel: 'tteam-bulk-cancel',
    returnReason: 'tteam-return-reason', returnConfirm: 'tteam-return-confirm', returnCancel: 'tteam-return-cancel', returnWarn: 'tteam-return-warn',
  },
  /* module 2: proxy entry, opened from a team member's record */
  proxy: {
    open: 'proxy-open', view: (v: string) => k('proxy-view', v), banner: 'proxy-banner', error: 'proxy-error',
    submitDay: 'proxy-submit-day', submitWeek: 'proxy-submit-week', refusal: 'proxy-refusal', held: 'proxy-held',
  },
  /* module 2: Timesheet setup (mts): capture fields, capture rules, allowances and pay rules by type, overtime, the BC boundary */
  mts: {
    error: 'mts-error', warn: 'mts-warn', save: 'mts-save', cancel: 'mts-cancel', dirty: 'mts-dirty',
    card: (key: string) => k('mts-card', key), tip: (key: string) => k('mts-tip', key),
    fieldType: (code: string) => k('mts-field-type', code), fieldCat: (cat: string) => k('mts-field-cat', cat),
    fieldRow: (c: string) => k('mts-field-row', c), fieldVis: (c: string) => k('mts-field-vis', c), fieldMand: (c: string) => k('mts-field-mand', c),
    fieldsEmpty: 'mts-fields-empty', rule: (key: string) => k('mts-rule', key), weekGrid: 'mts-week-grid', weekLayout: 'mts-week-layout',
    type: (code: string) => k('mts-type', code), allowRow: (code: string) => k('mts-allow-row', code),
    allowLabel: (code: string) => k('mts-allow-label', code), allowOn: (code: string) => k('mts-allow-on', code),
    allowAdd: 'mts-allow-add', allowName: 'mts-allow-name', allowConfirm: 'mts-allow-confirm', allowCancel: 'mts-allow-cancel',
    payRow: (i: number) => k('mts-pay-row', i), payTrigger: (i: number) => k('mts-pay-trigger', i), payWhen: (i: number) => k('mts-pay-when', i),
    payCode: (i: number) => k('mts-pay-code', i), payValue: (i: number) => k('mts-pay-value', i), payHow: (i: number) => k('mts-pay-how', i),
    payRemove: (i: number) => k('mts-pay-remove', i), payEmpty: 'mts-pay-empty', payAdd: 'mts-pay-add',
    ot: (key: string) => k('mts-ot', key), otDay: 'mts-ot-day',
  },
  /* module 3: Team rota (trota): the week bar, banners, filters, palette, grid, day view, suggested cover, history and dialogs */
  trota: {
    error: 'trota-error', loading: 'trota-loading', location: 'trota-location', tip: 'trota-tip',
    weekbar: 'trota-weekbar', weekPrev: 'trota-week-prev', weekNext: 'trota-week-next', weekNow: 'trota-week-now', weekLabel: 'trota-week-label',
    state: 'trota-state', amended: 'trota-amended', isoWeek: 'trota-iso-week',
    horizon: 'trota-horizon', copy: 'trota-copy', repeat: 'trota-repeat', clear: 'trota-clear', review: 'trota-review', adhoc: 'trota-adhoc',
    publish: 'trota-publish',
    gaps: 'trota-gaps', covered: 'trota-covered', over: 'trota-over', suggest: 'trota-suggest', showFlags: 'trota-show-flags',
    search: 'trota-search', role: 'trota-role', type: 'trota-type', flags: 'trota-flags', count: 'trota-count',
    palette: 'trota-palette', pchip: (code: string) => k('trota-pchip', code), newShift: 'trota-new-shift',
    grid: 'trota-grid', cell: (person: string, day: number) => k('trota-cell', person, day), add: (person: string, day: number) => k('trota-add', person, day),
    chip: (person: string, day: number) => k('trota-chip', person, day), hours: (person: string) => k('trota-hours', person),
    cov: (day: number) => k('trota-cov', day), fill: (day: number) => k('trota-fill', day), key: 'trota-key',
    dayview: 'trota-dayview', dayPill: 'trota-day-pill', dayFill: 'trota-day-fill', day: (day: number) => k('trota-day', day),
    dayRow: (person: string) => k('trota-day-row', person), dayEmpty: 'trota-day-empty',
    plan: 'trota-plan', planItem: (i: number) => k('trota-plan-item', i), planAccept: (i: number) => k('trota-plan-accept', i),
    planAsk: (i: number) => k('trota-plan-ask', i), planSkip: (i: number) => k('trota-plan-skip', i), planAcceptAll: 'trota-plan-accept-all',
    planDismiss: 'trota-plan-dismiss', planNone: 'trota-plan-none',
    history: 'trota-history', historyNote: 'trota-history-note', change: (i: number) => k('trota-change', i), changesMore: 'trota-changes-more',
    changesEmpty: 'trota-changes-empty', pub: (i: number) => k('trota-pub', i),
    pick: 'trota-pick', pickHint: 'trota-pick-hint', assignThis: 'trota-assign-this', sug: (person: string) => k('trota-sug', person),
    sugAssign: (person: string) => k('trota-sug-assign', person), sugAsk: (person: string) => k('trota-sug-ask', person),
    sugMore: 'trota-sug-more', sugNone: 'trota-sug-none', ruled: (person: string) => k('trota-ruled', person), sugTip: 'trota-sug-tip',
    ruledTip: 'trota-ruled-tip', advertise: 'trota-advertise', cancel: 'trota-cancel',
    fact: (key: string) => k('trota-fact', key), changeShift: 'trota-change-shift', remove: 'trota-remove',
    clearConfirm: 'trota-clear-confirm', repeatWeeks: 'trota-repeat-weeks', repeatConfirm: 'trota-repeat-confirm',
    horizonRow: (month: string) => k('trota-horizon-row', month), horizonView: (month: string) => k('trota-horizon-view', month),
    horizonPublish: 'trota-horizon-publish',
    adhocDay: 'trota-adhoc-day', adhocCode: 'trota-adhoc-code', adhocWhy: 'trota-adhoc-why', adhocUrgent: 'trota-adhoc-urgent',
    adhocSuggest: 'trota-adhoc-suggest', adhocAdvertise: 'trota-adhoc-advertise', adhocTip: 'trota-adhoc-tip',
  },
  /* module 3: Shift catalogue (tshifts) and its body, shared with Rota setup */
  tshifts: {
    error: 'tshifts-error', loading: 'tshifts-loading', catalogue: 'tshifts-catalogue', cardTip: 'tshifts-card-tip',
    row: (code: string) => k('tshifts-row', code), name: (code: string) => k('tshifts-name', code), from: (code: string) => k('tshifts-from', code),
    to: (code: string) => k('tshifts-to', code), cross: (code: string) => k('tshifts-cross', code), brk: (code: string) => k('tshifts-break', code),
    paid: (code: string) => k('tshifts-paid', code), night: (code: string) => k('tshifts-night', code), tone: (code: string) => k('tshifts-tone', code),
    usage: (code: string) => k('tshifts-usage', code), save: (code: string) => k('tshifts-save', code), cancel: (code: string) => k('tshifts-cancel', code),
    remove: (code: string) => k('tshifts-remove', code), add: 'tshifts-add',
    newCode: 'tshifts-new-code', newName: 'tshifts-new-name', newFrom: 'tshifts-new-from', newTo: 'tshifts-new-to', newBreak: 'tshifts-new-break',
    newTone: 'tshifts-new-tone', newNight: 'tshifts-new-night', newEligible: 'tshifts-new-eligible', newNightTip: 'tshifts-new-night-tip',
    newEligibleTip: 'tshifts-new-eligible-tip', newCancel: 'tshifts-new-cancel', newCreate: 'tshifts-new-create',
  },
  /* module 3: Working patterns (tpat): the list, the editor window, a new pattern, adding people, generating */
  tpat: {
    error: 'tpat-error', loading: 'tpat-loading', list: 'tpat-list', cardTip: 'tpat-card-tip', empty: 'tpat-empty', newPattern: 'tpat-new',
    row: (code: string) => k('tpat-row', code), state: (code: string) => k('tpat-state', code), open: (code: string) => k('tpat-open', code),
    addPerson: (code: string) => k('tpat-add-person', code), generate: (code: string) => k('tpat-generate', code),
    editor: 'tpat-editor', summary: 'tpat-summary', name: 'tpat-name', cycle: 'tpat-cycle', starts: 'tpat-starts', active: 'tpat-active',
    day: (i: number) => k('tpat-day', i), legend: 'tpat-legend', unknown: 'tpat-unknown',
    addLocation: 'tpat-add-location', dropLocation: (code: string) => k('tpat-drop-location', code),
    addJob: 'tpat-add-job', dropJob: (code: string) => k('tpat-drop-job', code), costCentre: 'tpat-cost-centre', gen: 'tpat-gen',
    genFrom: 'tpat-gen-from', genTo: 'tpat-gen-to', range: 'tpat-range', peopleTip: 'tpat-people-tip', people: 'tpat-people',
    person: (code: string) => k('tpat-person', code), offset: (code: string) => k('tpat-offset', code), first: (code: string) => k('tpat-first', code),
    removePerson: (code: string) => k('tpat-remove-person', code), noPeople: 'tpat-no-people',
    run: 'tpat-run', editorAdd: 'tpat-editor-add', remove: 'tpat-remove', close: 'tpat-close', cancel: 'tpat-cancel', save: 'tpat-save', dirty: 'tpat-dirty',
    newName: 'tpat-new-name', newCycle: 'tpat-new-cycle', newStart: 'tpat-new-start', newBase: 'tpat-new-base', newLocs: 'tpat-new-locs',
    newLocsTip: 'tpat-new-locs-tip', newJobs: 'tpat-new-jobs', newCc: 'tpat-new-cc', newGen: 'tpat-new-gen', newCancel: 'tpat-new-cancel',
    newCreate: 'tpat-new-create', newTip: 'tpat-new-tip',
    pick: (code: string) => k('tpat-pick', code), pickNone: 'tpat-pick-none', pickWhoTip: 'tpat-pick-who-tip', pickWhereTip: 'tpat-pick-where-tip',
    pickMode: 'tpat-pick-mode', pickStart: 'tpat-pick-start', pickWarn: 'tpat-pick-warn', pickCancel: 'tpat-pick-cancel', pickAdd: 'tpat-pick-add',
  },
  /* module 3: Cover requests (tcover): stages, open requests, suggestions, filled shifts */
  tcover: {
    error: 'tcover-error', loading: 'tcover-loading', tip: 'tcover-tip', location: 'tcover-location', adhoc: 'tcover-adhoc',
    stages: 'tcover-stages', stagesTip: 'tcover-stages-tip', configure: 'tcover-configure', stage: (n: number) => k('tcover-stage', n),
    search: 'tcover-search', filter: (f: string) => k('tcover-filter', f), count: 'tcover-count', empty: 'tcover-empty',
    request: (id: string) => k('tcover-request', id), urgent: (id: string) => k('tcover-urgent', id), reason: (id: string) => k('tcover-reason', id),
    askedTip: (id: string) => k('tcover-asked-tip', id), log: (id: string) => k('tcover-log', id), noReason: (id: string) => k('tcover-no-reason', id),
    sugTip: (id: string) => k('tcover-sug-tip', id), sug: (id: string, person: string) => k('tcover-sug', id, person),
    assign: (id: string, person: string) => k('tcover-assign', id, person), askFirst: (id: string, person: string) => k('tcover-ask-first', id, person),
    ruledTip: (id: string) => k('tcover-ruled-tip', id), ruled: (id: string, person: string) => k('tcover-ruled', id, person),
    nobody: (id: string) => k('tcover-nobody', id),
    fill: (id: string) => k('tcover-fill', id), askAll: (id: string) => k('tcover-ask-all', id), escalate: (id: string) => k('tcover-escalate', id),
    filled: (id: string) => k('tcover-filled', id), it: (id: string) => k('tcover-it', id), confirmed: (id: string) => k('tcover-confirmed', id),
    confirm: (id: string) => k('tcover-confirm', id), confirmTip: (id: string) => k('tcover-confirm-tip', id),
  },
  /* module 3: My shifts (shifts): the published week, next shift, rest days, open shifts to claim */
  shifts: {
    error: 'shifts-error', loading: 'shifts-loading', cards: 'shifts-cards', published: 'shifts-published', publishedTip: 'shifts-published-tip',
    outlook: 'shifts-outlook', teamRota: 'shifts-team-rota', next: 'shifts-next', nextWhen: 'shifts-next-when', week: 'shifts-week',
    weekHead: 'shifts-week-head', day: (date: string) => k('shifts-day', date), noShifts: 'shifts-no-shifts', notPublished: 'shifts-not-published',
    rest: 'shifts-rest', open: 'shifts-open', openTip: 'shifts-open-tip', offer: (id: string) => k('shifts-offer', id),
    urgent: (id: string) => k('shifts-urgent', id), claim: (id: string) => k('shifts-claim', id), notPermitted: (id: string) => k('shifts-not-permitted', id),
    whoOn: 'shifts-who-on',
  },
  /* module 3: Rota setup (mrota): catalogue, patterns, staffing, fulfilment stages, safe-worker rules, calendars, per-type limits */
  mrota: {
    error: 'mrota-error', loading: 'mrota-loading', off: 'mrota-off', warn: 'mrota-warn', save: 'mrota-save', cancel: 'mrota-cancel', dirty: 'mrota-dirty',
    card: (key: string) => k('mrota-card', key), tip: (key: string) => k('mrota-tip', key),
    patterns: 'mrota-patterns', patternsEmpty: 'mrota-patterns-empty', patternsError: 'mrota-patterns-error', pattern: (code: string) => k('mrota-pattern', code),
    patternOpen: (code: string) => k('mrota-pattern-open', code), newPattern: 'mrota-new-pattern',
    flag: (code: string) => k('mrota-flag', code), num: (key: string) => k('mrota-num', key), toggle: (key: string) => k('mrota-toggle', key),
    builtBy: 'mrota-built-by', horizon: 'mrota-horizon', level: (code: string) => k('mrota-level', code),
    stage: (i: number) => k('mrota-stage', i), stageAudience: (i: number) => k('mrota-stage-audience', i), stageWait: (i: number) => k('mrota-stage-wait', i),
    stageChannel: (i: number) => k('mrota-stage-channel', i), stageNext: (i: number) => k('mrota-stage-next', i),
    stageRemove: (i: number) => k('mrota-stage-remove', i), stageAdd: 'mrota-stage-add', safe: (key: string) => k('mrota-safe', key),
    type: (code: string) => k('mrota-type', code), typeShift: (code: string) => k('mrota-type-shift', code), typeNight: 'mrota-type-night',
    typeNum: (key: string) => k('mrota-type-num', key), typeFlexible: 'mrota-type-flexible',
    patternsBlocked: 'mrota-patterns-blocked',
  },
  /* module 3: Upload working patterns (simulated): the validation preview, its error report and the import that writes nothing */
  patUpload: {
    open: 'pat-upload-open', editorOpen: 'pat-upload-editor-open', file: 'pat-upload-file', rows: 'pat-upload-rows', valid: 'pat-upload-valid',
    invalid: 'pat-upload-invalid', error: (row: number) => k('pat-upload-error', row), warning: (row: number) => k('pat-upload-warning', row),
    horizon: 'pat-upload-horizon', cancel: 'pat-upload-cancel', download: 'pat-upload-download', import: 'pat-upload-import',
  },
  /* module 3: the rota on the timesheet: the rota banner's link to My shifts, and whose rota a week grid was seeded from */
  tsRota: { seeShift: 'ts-rota-see-shift', seeded: 'ts-rota-seeded' },
  /* module 4: My leave (leave): balances, days to take, my requests with Cancel, history, the request, entitlement and simulation dialogs */
  leave: {
    error: 'leave-error', loading: 'leave-loading', offSick: 'leave-off-sick', offSickTip: 'leave-off-sick-tip', tellMgr: 'leave-tell-mgr',
    cards: 'leave-cards', balances: 'leave-balances', balancesTip: 'leave-balances-tip', annual: 'leave-annual', other: 'leave-other-unit',
    taken: 'leave-taken', pending: 'leave-pending', toil: 'leave-toil', toilTip: 'leave-toil-tip', carry: 'leave-carry', entShow: 'leave-ent-show',
    toTake: 'leave-to-take', requests: 'leave-requests', requestsTip: 'leave-requests-tip', noRequests: 'leave-no-requests',
    request: (id: string) => k('leave-request', id), state: (id: string) => k('leave-state', id), cancel: (id: string) => k('leave-cancel', id),
    reason: (id: string) => k('leave-reason', id), history: 'leave-history', historyTip: 'leave-history-tip', noHistory: 'leave-no-history',
    ledger: (id: string) => k('leave-ledger', id), requestOpen: 'leave-request-open',
    /* the request dialog (leaveRequestModal) */
    type: 'leave-type', from: 'leave-from', to: 'leave-to', part: 'leave-part', qty: 'leave-qty', note: 'leave-note', evidence: 'leave-evidence',
    sla: 'leave-sla', formWarn: 'leave-form-warn', send: 'leave-send', sendCancel: 'leave-send-cancel',
    /* the entitlement dialog (entitlementModal) */
    entPolicy: 'leave-ent-policy', entLine: (i: number) => k('leave-ent-line', i), entEntitlement: 'leave-ent-entitlement', entTaken: 'leave-ent-taken',
    entPending: 'leave-ent-pending', entRemaining: 'leave-ent-remaining', entStatutory: 'leave-ent-statutory', entService: 'leave-ent-service',
    entCarry: 'leave-ent-carry', entBh: 'leave-ent-bh', entClose: 'leave-ent-close', simulate: 'leave-simulate',
    /* the pro-rata simulation (proRataModal), which writes nothing */
    simNow: 'leave-sim-now', simHours: 'leave-sim-hours', simBefore: 'leave-sim-before', simAfter: 'leave-sim-after', simChange: 'leave-sim-change',
    simNote: 'leave-sim-note', simClose: 'leave-sim-close',
  },
  /* module 4: Team leave (tleave): filters, the escalated banner, waiting requests with Approve and Decline, team balances, leaver reconciliation */
  tleave: {
    error: 'tleave-error', loading: 'tleave-loading', tip: 'tleave-tip', count: 'tleave-count', breached: 'tleave-breached',
    search: 'tleave-search', type: 'tleave-type', short: 'tleave-short', empty: 'tleave-empty',
    card: (id: string) => k('tleave-card', id), sla: (id: string) => k('tleave-sla', id), slaTip: (id: string) => k('tleave-sla-tip', id),
    balance: (id: string) => k('tleave-balance', id), balanceTip: (id: string) => k('tleave-balance-tip', id), how: (id: string) => k('tleave-how', id),
    cover: (id: string) => k('tleave-cover', id), stage: (id: string) => k('tleave-stage', id), note: (id: string) => k('tleave-note', id),
    advisory: (id: string) => k('tleave-advisory', id), warn: (id: string) => k('tleave-warn', id),
    approve: (id: string) => k('tleave-approve', id), decline: (id: string) => k('tleave-decline', id), rota: (id: string) => k('tleave-rota', id),
    /* team balances */
    balances: 'tleave-balances', balanceRow: (code: string) => k('tleave-balance-row', code), next: (code: string) => k('tleave-next', code),
    ent: (code: string) => k('tleave-ent', code), entLoading: 'tleave-ent-loading',
    /* leaver reconciliation (LV_LEAVER) */
    leaversTip: 'tleave-leavers-tip', leaver: (code: string) => k('tleave-leaver', code), leaverVerdict: (code: string) => k('tleave-leaver-verdict', code),
    leaverAction: (code: string) => k('tleave-leaver-action', code), leaverRow: (code: string, row: string) => k('tleave-leaver-row', code, row),
    /* the decline dialog: the reason the colleague sees (D4) */
    reason: 'tleave-reason', declineConfirm: 'tleave-decline-confirm', declineCancel: 'tleave-decline-cancel', declineWarn: 'tleave-decline-warn',
  },
  /* module 4: Sickness (tsick): the trigger banner, the Bradford table, recording an absence, and sickness during booked leave */
  tsick: {
    error: 'tsick-error', loading: 'tsick-loading', count: 'tsick-count', banner: 'tsick-banner', arrange: 'tsick-arrange', arranged: 'tsick-arranged',
    search: 'tsick-search', triggers: 'tsick-triggers', table: 'tsick-table', scoreTip: 'tsick-score-tip', empty: 'tsick-empty',
    row: (code: string) => k('tsick-row', code), score: (code: string) => k('tsick-score', code), next: (code: string) => k('tsick-next', code),
    /* Record an absence */
    record: 'tsick-record', who: 'tsick-who', from: 'tsick-from', to: 'tsick-to', reason: 'tsick-reason', save: 'tsick-save', warn: 'tsick-warn',
    /* Sick during booked leave (D10) */
    onLeave: 'tsick-on-leave', onLeaveTip: 'tsick-on-leave-tip', onLeaveDay: (code: string, date: string) => k('tsick-on-leave-day', code, date),
    giveBack: 'tsick-give-back', gbPerson: 'tsick-gb-person', gbDay: (date: string) => k('tsick-gb-day', date), gbConfirm: 'tsick-gb-confirm',
    gbCancel: 'tsick-gb-cancel', gbWarn: 'tsick-gb-warn',
  },
  /* module 4: Leave setup (mleave): leave types, policies, entitlement rules, the booking workflow, Leave and Rota, leavers, per-type policy */
  mleave: {
    error: 'mleave-error', loading: 'mleave-loading', off: 'mleave-off', warn: 'mleave-warn', save: 'mleave-save', cancel: 'mleave-cancel', dirty: 'mleave-dirty',
    card: (key: string) => k('mleave-card', key), tip: (key: string) => k('mleave-tip', key), flag: (code: string) => k('mleave-flag', code),
    type: (i: number) => k('mleave-type', i), typeName: (i: number) => k('mleave-type-name', i), typePolicy: (i: number) => k('mleave-type-policy', i),
    typeUnit: (i: number) => k('mleave-type-unit', i), typeCount: (i: number) => k('mleave-type-count', i), typeActive: (i: number) => k('mleave-type-active', i),
    typeAdd: 'mleave-type-add',
    policy: (i: number) => k('mleave-policy', i), policyUnit: (i: number) => k('mleave-policy-unit', i),
    policyNum: (i: number, key: string) => k('mleave-policy-num', i, key),
    num: (key: string) => k('mleave-num', key), toggle: (key: string) => k('mleave-toggle', key), unit: 'mleave-unit', finYear: 'mleave-fin-year',
    toilWindow: 'mleave-toil-window', escalateTo: 'mleave-escalate-to', rotaOff: 'mleave-rota-off',
    stage: (i: number) => k('mleave-stage', i), stageWho: (i: number) => k('mleave-stage-who', i), stageAction: (i: number) => k('mleave-stage-action', i),
    stageWait: (i: number) => k('mleave-stage-wait', i), stageChannel: (i: number) => k('mleave-stage-channel', i),
    stageRemove: (i: number) => k('mleave-stage-remove', i), stageAdd: 'mleave-stage-add',
    leavers: 'mleave-leavers', leaver: (code: string) => k('mleave-leaver', code),
    empType: (code: string) => k('mleave-emp-type', code), tlPolicy: 'mleave-tl-policy', tlUnit: 'mleave-tl-unit', tlNote: 'mleave-tl-note',
  },
  /* module 4 links: proxy entry on a day of leave or sickness (D8) */
  leaveLink: { proxyAnyway: 'proxy-worked-anyway' },
  /* 1c: Modules & features (amods): the index cards and the drill-in per module */
  amods: {
    error: 'amods-error', loading: 'amods-loading', search: 'amods-search', empty: 'amods-empty',
    card: (code: string) => k('amods-card', code), cardState: (code: string) => k('amods-card-state', code), cardCounts: (code: string) => k('amods-card-counts', code),
    offPill: 'amods-off-pill', moduleCard: 'amods-module-card', moduleTip: 'amods-module-tip', enableNote: 'amods-enable-note',
    features: 'amods-features', featuresTip: 'amods-features-tip', offBanner: 'amods-off-banner', noFeatures: 'amods-no-features',
    mod: (code: string) => k('amods-mod', code), flag: (code: string) => k('amods-flag', code), row: (code: string) => k('amods-row', code),
    weekGrid: 'amods-week-grid', weekLayout: 'amods-week-layout',
    stepDown: (key: string) => k('amods-step-down', key), stepUp: (key: string) => k('amods-step-up', key), stepValue: (key: string) => k('amods-step-value', key),
  },
  /* 1c: Calendar and saved data (acal) */
  acal: {
    error: 'acal-error', loading: 'acal-loading', card: (key: string) => k('acal-card', key), tip: (key: string) => k('acal-tip', key),
    finYear: 'acal-fin-year', weekStart: 'acal-week-start', horizon: 'acal-horizon', holidays: 'acal-holidays',
    holiday: (date: string) => k('acal-holiday', date), treatment: (date: string) => k('acal-treatment', date), noHolidays: 'acal-no-holidays',
    saving: 'acal-saving', size: 'acal-size', export: 'acal-export', reset: 'acal-reset', restore: 'acal-restore', build: 'acal-build',
  },
  /* 1c: the Rename roles dialog on Permissions (D11) */
  roleNames: { open: 'role-names-open', field: (id: string) => k('role-names-field', id), save: 'role-names-save', cancel: 'role-names-cancel', warn: 'role-names-warn' },
  /* 1c D6: Timesheet setup points at the weekly grid's row in Modules & features */
  mtsPointer: { weekly: 'mts-weekly-pointer', link: 'mts-weekly-link' },
  /* 1c: Organisation (aorg): the configuration spine, templates, company, compliance and pay periods */
  aorg: {
    error: 'aorg-error', loading: 'aorg-loading', card: (key: string) => k('aorg-card', key), tip: (key: string) => k('aorg-tip', key),
    spine: 'aorg-spine', template: (key: string) => k('aorg-template', key), live: 'aorg-live',
    saveOpen: 'aorg-save-open', importOpen: 'aorg-import-open', importFile: 'aorg-import-file',
    saved: 'aorg-saved', savedRow: (key: string) => k('aorg-saved-row', key), noSaved: 'aorg-no-saved',
    export: (key: string) => k('aorg-export', key), remove: (key: string) => k('aorg-remove', key),
    saveName: 'aorg-save-name', saveDesc: 'aorg-save-desc', scope: (s: string) => k('aorg-scope', s), save: 'aorg-save', saveCancel: 'aorg-save-cancel', saveWarn: 'aorg-save-warn',
    plan: (part: string) => k('aorg-plan', part), planLoading: 'aorg-plan-loading', planError: 'aorg-plan-error', apply: 'aorg-apply', applyCancel: 'aorg-apply-cancel',
    name: 'aorg-name', registration: 'aorg-registration', address: 'aorg-address', country: 'aorg-country',
    nmw: 'aorg-nmw', bankHolidays: 'aorg-bank-holidays', payFrequency: 'aorg-pay-frequency', weekEnding: 'aorg-week-ending',
    firstPayDate: 'aorg-first-pay-date', cutoff: 'aorg-cutoff', cutoffLink: 'aorg-cutoff-link',
  },
  /* 1c group 4: the bell's inbox panel (D9) */
  inbox: {
    panel: 'inbox-panel', markAll: 'inbox-mark-all', empty: 'inbox-empty', loading: 'inbox-loading', error: 'inbox-error',
    item: (id: string) => k('inbox-item', id), dot: (id: string) => k('inbox-dot', id), dest: (id: string) => k('inbox-dest', id),
  },
  /* 1c: a link to a page that does not exist, or that this person cannot open (D9) */
  unavailable: { root: 'unavailable', home: 'unavailable-home' },
  /* 1c group 4: Notifications (anotif): the event x user type channel matrix */
  anotif: {
    error: 'anotif-error', loading: 'anotif-loading', tip: 'anotif-tip', table: 'anotif-table',
    group: (module: string) => k('anotif-group', module), row: (code: string) => k('anotif-row', code),
    cell: (code: string, persona: string) => k('anotif-cell', code, persona), never: (code: string, persona: string) => k('anotif-never', code, persona),
    notConnected: 'anotif-not-connected', evidence: 'anotif-evidence', evidenceTip: 'anotif-evidence-tip', evidenceRow: (ref: string) => k('anotif-evidence-row', ref),
    save: 'anotif-save', cancel: 'anotif-cancel',
  },
  /* 1c group 5: Approvals (aappr): the chain per module, sign-off settings and delegations (D8) */
  aappr: {
    error: 'aappr-error', loading: 'aappr-loading', tip: 'aappr-tip',
    chain: 'aappr-chain', chainTip: 'aappr-chain-tip', chainTable: 'aappr-chain-table', fixedTip: 'aappr-fixed-tip',
    group: (module: string) => k('aappr-group', module), edit: (module: string) => k('aappr-edit', module),
    row: (module: string, i: number) => k('aappr-row', module, i),
    role: (i: number) => k('aappr-role', i), scope: (i: number) => k('aappr-scope', i), when: (i: number) => k('aappr-when', i),
    slaN: (i: number) => k('aappr-sla-n', i), slaUnit: (i: number) => k('aappr-sla-unit', i), remove: (i: number) => k('aappr-remove', i),
    layer: (i: number) => k('aappr-layer', i), add: 'aappr-add', dialogFixedTip: 'aappr-dialog-fixed-tip',
    chainSave: 'aappr-chain-save', chainCancel: 'aappr-chain-cancel', chainWarn: 'aappr-chain-warn',
    signOff: 'aappr-signoff', signOffTip: 'aappr-signoff-tip', methodTip: 'aappr-method-tip', method: 'aappr-method', methodLink: 'aappr-method-link',
    cutoff: 'aappr-cutoff', cutoffLink: 'aappr-cutoff-link', enforceTip: 'aappr-enforce-tip', enforce: 'aappr-enforce', enforceLink: 'aappr-enforce-link',
    current: 'aappr-current', previous: 'aappr-previous', reasonTip: 'aappr-reason-tip', reason: 'aappr-reason', reasonLink: 'aappr-reason-link',
    deleg: 'aappr-deleg', delegTip: 'aappr-deleg-tip', delegTable: 'aappr-deleg-table', delegError: 'aappr-deleg-error', delegLoading: 'aappr-deleg-loading',
    delegRow: (id: string) => k('aappr-deleg-row', id), delegRemove: (id: string) => k('aappr-deleg-remove', id), delegEmpty: 'aappr-deleg-empty',
    delegAdd: 'aappr-deleg-add', who: 'aappr-deleg-who', to: 'aappr-deleg-to', from: 'aappr-deleg-from', until: 'aappr-deleg-until',
    module: (m: string) => k('aappr-deleg-module', m), delegSave: 'aappr-deleg-save', delegCancel: 'aappr-deleg-cancel', delegWarn: 'aappr-deleg-warn',
  },
  /* 1c group 5: the manager's "While you are away" card on Team leave (mgrLeave, v15:7907) */
  away: { card: 'away-card', tip: 'away-tip', cover: 'away-cover', row: (id: string) => k('away-row', id) },
  /* 1c group 6: My work → Notices (essNotices, v15:5828) and its read dialog (noticeReadBox) */
  notices: {
    error: 'notices-error', loading: 'notices-loading', seg: (v: string) => k('notices-seg', v), table: 'notices-table', empty: 'notices-empty',
    row: (id: string) => k('notices-row', id), you: (id: string) => k('notices-you', id), read: (id: string) => k('notices-read', id), ack: (id: string) => k('notices-ack', id),
    readBody: 'notices-read-body', readMeta: 'notices-read-meta', readChanged: 'notices-read-changed', readAck: 'notices-read-ack', readState: 'notices-read-state',
    readClose: 'notices-read-close',
  },
  /* 1c group 6: the Notices card on My home (noticeHomeCard, v15:5811) */
  noticeHome: {
    card: 'notice-home-card', owed: 'notice-home-owed', all: 'notice-home-all', row: (id: string) => k('notice-home-row', id),
    ack: (id: string) => k('notice-home-ack', id), state: (id: string) => k('notice-home-state', id), more: 'notice-home-more',
  },
  /* 1c group 6: My team → Notices (mgrNotices, v15:5870) and its dialogs (noticeEditBox, noticeTrackBox, noticeWithdrawBox) */
  tnotices: {
    error: 'tnotices-error', loading: 'tnotices-loading', tip: 'tnotices-tip', add: 'tnotices-add', filter: (v: string) => k('tnotices-filter', v), table: 'tnotices-table',
    empty: 'tnotices-empty', emptyAdd: 'tnotices-empty-add', row: (id: string) => k('tnotices-row', id), state: (id: string) => k('tnotices-state', id),
    acks: (id: string) => k('tnotices-acks', id), open: (id: string) => k('tnotices-open', id), post: (id: string) => k('tnotices-post', id),
    readOnly: (id: string) => k('tnotices-read-only', id),
    title: 'tnotices-title', body: 'tnotices-body', scope: 'tnotices-scope', from: 'tnotices-from', until: 'tnotices-until',
    mustAck: 'tnotices-must-ack', pinned: 'tnotices-pinned', urgent: 'tnotices-urgent', mustAckTip: 'tnotices-must-ack-tip', urgentTip: 'tnotices-urgent-tip',
    resetWarn: 'tnotices-reset-warn', warn: 'tnotices-warn', saveDraft: 'tnotices-save-draft', postNow: 'tnotices-post-now', save: 'tnotices-save', cancel: 'tnotices-cancel',
    trackMeta: 'tnotices-track-meta', trackBody: 'tnotices-track-body', trackWithdrawn: 'tnotices-track-withdrawn', trackAcks: 'tnotices-track-acks',
    trackTable: 'tnotices-track-table', trackRow: (code: string) => k('tnotices-track-row', code), trackStatus: (code: string) => k('tnotices-track-status', code),
    trackNobody: 'tnotices-track-nobody', history: 'tnotices-history', historyRow: (v: number) => k('tnotices-history-row', v), trail: 'tnotices-trail',
    trailRow: (id: string) => k('tnotices-trail-row', id), trailEmpty: 'tnotices-trail-empty',
    trackClose: 'tnotices-track-close', trackDelete: 'tnotices-track-delete', trackEdit: 'tnotices-track-edit', trackPost: 'tnotices-track-post',
    trackWithdraw: 'tnotices-track-withdraw', trackPin: 'tnotices-track-pin',
    reason: 'tnotices-reason', withdrawOk: 'tnotices-withdraw-ok', withdrawCancel: 'tnotices-withdraw-cancel', withdrawWarn: 'tnotices-withdraw-warn',
  },
  /* 1c group 7: My home (essHome, v15:5323), its month and live key (calKey, 6244) and the day dialog (empDayBox, 5435) */
  home: {
    error: 'home-error', loading: 'home-loading', missing: 'home-missing', sentBack: 'home-sent-back', fixIt: 'home-fix-it',
    next: 'home-next', today: 'home-today', week: 'home-week', balance: 'home-balance',
    month: 'home-month', prev: 'home-prev', nextMonth: 'home-next-month', thisMonth: 'home-this-month', summary: 'home-summary', grid: 'home-grid',
    day: (date: string) => k('home-day', date), key: 'home-key', keyItem: (kind: string, id: string | number) => k('home-key', kind, id), keyEmpty: 'home-key-empty',
    dayState: 'home-day-state', dayShift: 'home-day-shift', dayLocation: 'home-day-location', daySource: 'home-day-source', dayBank: 'home-day-bank',
    dayHours: 'home-day-hours', dayAgainst: 'home-day-against', dayLocked: 'home-day-locked', dayLeave: 'home-day-leave', dayLeaveDates: 'home-day-leave-dates',
    dayClose: 'home-day-close', dayShifts: 'home-day-shifts', dayLeaveLink: 'home-day-leave-link', bookLeave: 'home-book-leave', recordHours: 'home-record-hours',
  },
  /* 1c group 7: My Team → Team Home (mgrTeamHome, v15:10555) */
  thome: { tip: 'thome-tip', grid: 'thome-grid', card: (view: string) => k('thome-card', view), count: (view: string) => k('thome-count', view) },
  /* 1c group 7: My work → Documents (essDocs, v15:5673) */
  docs: {
    error: 'docs-error', loading: 'docs-loading', card: 'docs-card', tip: 'docs-tip', source: 'docs-source', row: (id: string) => k('docs-row', id),
    empty: 'docs-empty', openNote: 'docs-open-note', payroll: 'docs-payroll', payrollRow: (id: string) => k('docs-payroll-row', id), salary: 'docs-salary',
  },
  /* 1c fix B: the live state pill on Permissions (admPermissions, v15:8336) */
  accessState: { pill: 'access-state-pill' },
  /* 1c fix B: why the Saved data card has a session set aside (D14) */
  acalSetAside: { why: 'acal-set-aside-why' },
  /* module 2b: the clock card on My timesheet's day view (.clockcard, v15:6382-6386), the forgotten clock-out
     banner, the Late and Closed later pills on the day and in Team timesheets, and the not-built feature rows */
  clock: {
    card: 'clock-card', ring: 'clock-ring', ringPct: 'clock-ring-pct', timer: 'clock-timer', status: 'clock-status',
    clockIn: 'clock-in', again: 'clock-again', breakStart: 'clock-break-start', resume: 'clock-resume', clockOut: 'clock-out', refusal: 'clock-refusal',
    forgotten: 'clock-forgotten', finish: 'clock-finish', close: 'clock-close', closeRefusal: 'clock-close-refusal',
    late: 'clock-late', closedLate: 'clock-closed-late',
    queueLate: (id: string) => k('clock-queue-late', id), queueClosedLate: (id: string) => k('clock-queue-closed-late', id),
    notBuilt: (code: string) => k('clock-not-built', code),
  },
} as const;
