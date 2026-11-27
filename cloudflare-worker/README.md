# Cloudflare Worker — דיווח תקלות אוטומטי ל-GitHub Issues

Worker קל וחינמי (עד 100,000 בקשות ביום) שמאפשר לאפליקציית ה-IPTV לפתוח GitHub Issue אמיתי עם לוגים מסוננים, **בלי שמשתמש הטלוויזיה יצטרך חשבון GitHub**.

## פריסה ב-3 שלבים

1. צור ב-GitHub **Fine-grained Personal Access Token** המוגבל אך ורק לריפו `maorisraelii/iptv-webos` עם הרשאה אחת בלבד:
   - **Repository permissions -> Issues -> Read and write**
2. מתוך התיקייה `cloudflare-worker/`, פרוס עם Wrangler:
   ```bash
   npx wrangler init -y
   npx wrangler deploy issue-reporter-worker.js --name iptv-issue-reporter
   npx wrangler secret put GITHUB_TOKEN
   ```
3. הדבק את כתובת ה-Worker שהתקבלה (`https://iptv-issue-reporter.<subdomain>.workers.dev`) במשתנה `DEFAULT_ISSUE_ENDPOINT` בקובץ `js/diagnostics.js` (או הגדר זמנית ב-`localStorage.setItem('zenplay_issue_endpoint_url', '...')`).

> כל עוד לא הוגדר Worker Endpoint, האפליקציה פותחת אוטומטית Fallback חכם: קוד QR לסריקה מהטלפון עם קישור GitHub Issue ממולא מראש בפרטי המערכת ובלוגים המסוננים + כפתור העתקת דוח.
