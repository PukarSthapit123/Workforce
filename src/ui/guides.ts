/* The page guides behind `?`: the prototype's GUIDES (qnipay-workforce-v15.html:
   9930-10060). What belongs here is how a page fits together, what it will
   and will not do. Anything about current state or the consequence of an
   action stays on the page, where it can be seen. Copy is the prototype's,
   with each em-dash aside rewritten as its own sentence. A page whose view
   has no entry shows no `?`. */
export interface Guide { label: string; title: string; sections: readonly (readonly [string, string])[] }

export const GUIDES: Readonly<Record<string, Guide>> = {
  ts: { label: 'How time capture works', title: 'How time capture works', sections: [
    ['Clocking',
      'Clock in when you start and out when you finish. Your times fill in and lock while the shift runs, and breaks are recorded as you take them.'],
    ['Manual entry',
      'The day form and the weekly grid capture the same fields. The grid pivots them across the week for people who record a whole week at once. Fields marked required are required for your employee type.'],
    ['Breaks and allowances',
      'Add breaks only if you took them. They come off your net hours. Tick any allowances that applied to the shift. Rates are held in Business Central; nothing here sets a monetary value.'],
    ['What is checked',
      'Overlapping breaks, a break outside the shift, breaks longer than the shift and a day above the daily maximum are refused. Long days, short rest and hours away from your rota line are flagged for your approver but still submit.'],
    ['After you submit',
      'It goes to your manager. If it comes back, correct it and submit again. That is recorded as a resubmission rather than a new entry.'],
    ['The full key',
      'Status: approved, submitted, resubmitted, draft, sent back, and nothing recorded on a day you were rota’d. Leave and sickness show with a padlock, because they block capture while leave blocks the timesheet.'],
  ] },
  tteam: { label: 'How to read this queue', title: 'How to read this queue', sections: [
    ['What is waiting',
      'The queue holds first submissions and resubmissions together, so a corrected entry cannot fall out of sight. A resubmission carries the reason it was sent back.'],
    ['Why a row is flagged',
      'A day over the review threshold, a large variance against the rota line, short rest, or an entry made by a manager on somebody else’s behalf.'],
    ['The posting dot',
      'Hollow means not sent yet. Amber means queued for Business Central. Filled means the dispatcher posted it. In this build that posting is simulated, not a Business Central confirmation.'],
    ['Approving in bulk',
      'Approve all is scoped to your location and asks you to confirm the record count, the hours and any exceptions first. Each approval queues its own posting.'],
  ] },
  mts: { label: 'What the capture rules do', title: 'What the capture rules do', sections: [
    ['Errors block, thresholds warn',
      'The settings on this page decide what is refused outright and what is merely flagged for the approver.'],
    ['Always refused, whatever these are set to',
      'Overlapping breaks, a break outside the shift, breaks longer than the shift, a break with only one end, and a net total below the minimum. These are integrity rules, not policy.'],
    ['Where they apply',
      'Every path that writes time: the day form, the weekly grid, proxy entry on behalf of somebody else, and week submission.'],
  ] },
};
