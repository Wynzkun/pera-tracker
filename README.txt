MONEY TRACKER PWA

IMPORTANT:
Do not open index.html directly with file:// if you want the Install App / Add to Home Screen feature.
A PWA must be served from a web server. For Android installation, HTTPS hosting is the easiest route.

FASTEST TEST ON A COMPUTER
1. Extract this ZIP.
2. Open a terminal inside the folder.
3. If Python is installed, run:
   python -m http.server 8080
4. Open:
   http://localhost:8080

For installation on an Android phone:
- Host this folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages, etc.)
- Open the HTTPS URL in Chrome on Android.
- You should see the in-app Install button when Chrome considers it installable.
- Otherwise use Chrome menu > Install app / Add to Home screen.

Files:
- index.html
- manifest.webmanifest
- service-worker.js
- icons/icon-192.png
- icons/icon-512.png

Data:
The sample currently stores your tracker data locally in the browser/app using localStorage.
