PERA TRACKER V2 — GITHUB PAGES UPDATE

NEW:
- Calendar page with due dates and transaction activity
- Phone notification permission + test notification
- Due-date / reminder / one-day-overdue notifications
- Android Chrome Periodic Background Sync when supported
- Income Breakdown donut chart
- Allocation Summary pie chart
- Top Spending Categories bar chart
- Automatic migration from the previous localStorage version
- PWA offline cache and update handling

HOW TO UPDATE YOUR EXISTING GITHUB REPOSITORY:
1. Extract this ZIP.
2. Open your existing GitHub repository: pera-tracker
3. Upload/replace these root files:
   index.html
   styles.css
   app.js
   manifest.webmanifest
   service-worker.js
4. Upload/replace the icons folder.
5. Commit changes to main.
6. Wait for GitHub Pages to deploy.
7. Open the live app and refresh it once.
8. In the app, tap "Enable Notifications", allow notifications, then tap "Test Notification".

IMPORTANT ABOUT PWA REMINDERS:
- When supported, Android/Chrome can run periodic background checks, but Chrome controls when those checks run.
- If periodic background sync is unavailable, the app checks dues whenever the app is opened/foregrounded.
- For guaranteed exact-time local notifications while the app is fully closed, the next step is packaging this same web app as an Android APK with Capacitor Local Notifications.
