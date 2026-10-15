BANTAYKO MUNIDAD - SQL DATABASE (SQLite)
========================================

WHAT YOU NEED (one time only)
  Node.js version 22.13 or newer. Download the "LTS" version here:
  https://nodejs.org
  (No "npm install". No other program. SQLite is already inside Node.js.)

HOW TO USE EVERY DAY
  1. Keep these files together in ONE folder:
        BantayKoMunidad.html
        server.js
        start.bat
        nopfp.jpeg   (and your other pictures)
  2. Double-click  start.bat
     A black window opens and Chrome opens the page by itself.
     KEEP THE BLACK WINDOW OPEN. It is your database server.
  3. Use the dashboard. Everything you do is saved in the file  bantayko.db
  4. Close everything. Open start.bat again. All your records are still there.

HOW TO KNOW IT IS WORKING
  Look at the small box at the bottom-right of the page:
     green dot  = connected to SQL, records are being saved
     red dot    = server is not running. Start start.bat and reload the page.

WHAT IS SAVED (SQL tables inside bantayko.db)
  audit_logs         every login, logout, verify, alert, post, Arduino signal
  serial_logs        certificates and serial numbers
  vetting_requests   resident verification and its status
  emergencies        every SOS from the Arduino (ACTIVE / CLEARED)
  community_alerts   alerts, their status, and if they were escalated
  feed_posts         Brgy. feed posts and event status
  aid_listings       mutual aid offers/requests and if they were fulfilled
  meta               internal flag (first-time setup done)

SEE OR CHECK THE DATA WITH SQL
  Install the free program "DB Browser for SQLite" (sqlitebrowser.org),
  open bantayko.db, and run queries, for example:
     SELECT * FROM emergencies ORDER BY id DESC;
     SELECT action, COUNT(*) FROM audit_logs GROUP BY action;
     SELECT * FROM community_alerts WHERE status = 'active';

BACKUP
  Use the "Backup" button in the box at the bottom-right. It downloads a .json file.
  "Restore" loads that file back. The trash button erases everything.
  You can also just copy the file bantayko.db.

ARDUINO
  Nothing changes. Click the Arduino connect button in the page as before.
  Open the page with http://localhost:3000 (start.bat does this for you).
  Every SOS (H1_SOS, H2_SOS, H3_SOS) is saved in the emergencies table.

PROBLEMS
  An error about node:sqlite
        -> your Node.js is too old. Install the newest LTS version.
  "Address already in use"
        -> the server is already open in another black window. Use that one.
  Red dot in the page
        -> start.bat is not running. Start it and press F5.
