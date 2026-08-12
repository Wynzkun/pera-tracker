PERA TRACKER V3 — UPDATE FILES

WHAT CHANGED
1. Hamburger menu at upper-left with:
   - Refresh / Update App
   - Enable Notifications
   - Test Notification
2. Notification controls removed from the Dashboard.
3. Debt-payment consistency fix:
   - Debt Payment removed from Daily Tracker.
   - Record debt payments only from My Debts > Record Payment.
   - That action reduces the debt balance and creates a linked payment history record.
   - Linked debt-payment history cannot be deleted from Daily Tracker, preventing balance mismatches.
   - Debt payments are kept separate from Actual Expenses and Top Spending Categories.
4. Receipt Scanner added to Daily Tracker:
   - Camera or photo upload.
   - Client-side OCR using Tesseract.js.
   - Extracts merchant, date, total, suggested category, and likely item lines.
   - You review the detected information before it fills the expense form.

HOW TO UPDATE GITHUB
- Extract this ZIP.
- Upload/replace ALL files and the icons folder in the root of your existing pera-tracker repository.
- Commit to main.
- Wait for GitHub Pages to deploy.
- Open the app, tap the upper-left menu, then Refresh / Update App.

RECEIPT SCANNER NOTE
- OCR runs in the browser; no receipt image is intentionally uploaded by Pera Tracker to your own server.
- The Tesseract.js OCR engine is loaded from its CDN, so internet access is needed when the OCR library/language data is first loaded.
- OCR is not perfect. Always review the detected total/date/category before saving.
