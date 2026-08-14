PERA TRACKER V7

NEW
- Photo scanner again has a clear Send to Daily Expense action.
- Detected financial details now include Merchant, Total Amount, Transaction Date, Description, Category and Reference.
- Dedicated Credit tab for Credit Cards, Billease, Salmon and other credit/BNPL lines.
- Credit purchases increase outstanding and count as expenses without reducing available cash immediately.
- Credit payments reduce outstanding and reduce cash without double-counting the expense.
- Credit due dates appear in Calendar, Dashboard dues and notification checks.
- CSV/Excel exports now include credit accounts and credit-linked transactions.

UPDATE GITHUB
Upload and replace all extracted files in your existing pera-tracker repository, commit to main, wait for Pages deployment, then use Menu > Refresh / Update App.


V8 DEBT FIX
- Debt progress bar now uses actual linked payments plus inferred earlier payments instead of Original Amount minus Current Balance only.
- Paying the full current Amount Due marks the debt as MINIMUM DUE PAID.
- Minimum due payments are no longer counted in Dashboard Due Within 7 Days once satisfied.
- Upcoming Dues excludes already-satisfied current-cycle debt dues.
- Editing the due date starts a new payment cycle and resets the minimum-due-paid tracker.
- Due notifications stop for a debt once the current minimum due has been satisfied.
