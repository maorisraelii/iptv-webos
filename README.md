<p align="center">
  <img src="largeIcon.png" alt="Live TV Logo" width="110" height="110" style="border-radius: 24px;" />
</p>

<h1 align="center">📺 Live TV for LG webOS</h1>

<p align="center">
  נגן <strong>IPTV Live TV</strong> קל-משקל, מהיר במיוחד ומותאם שלט עבור <strong>LG Smart TV</strong>.<br />
  נבנה בהשראת העיצוב של <strong>ZenPlay</strong>, מותאם בלעדית ל-<strong>Live TV ו-M3U</strong>, ותומך ב-<strong>webOS 4.64 ו-webOS 5.0 ומעלה</strong> עם מנגנון <strong>עדכונים מהירים מהענן (OTA)</strong> ללא צורך בהתקנה מחדש של האפליקציה!
</p>

<p align="center">
  <a href="https://github.com/maorisraelii/iptv-webos/actions/workflows/build_ipk.yml"><img src="https://img.shields.io/github/actions/workflow/status/maorisraelii/iptv-webos/build_ipk.yml?branch=main&style=for-the-badge&label=Build%20%26%20Release&logo=githubactions" alt="Build Status" /></a>
  <img src="https://img.shields.io/badge/Platform-LG%20webOS%204.64%20|%205.0%2B-a50034?style=for-the-badge&logo=lg" alt="LG webOS 4.64+" />
  <img src="https://img.shields.io/badge/Updates-Over--The--Air%20(OTA)-blue?style=for-the-badge&logo=cloudflared" alt="OTA Updates" />
  <img src="https://img.shields.io/badge/Resolution-1080p%20FHD-green?style=for-the-badge" alt="1080p FHD" />
  <img src="https://img.shields.io/badge/Content-Live%20TV%20Only-orange?style=for-the-badge" alt="Live TV Only" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## ✨ תכונות מרכזיות

- ⚡ **עדכונים חיים מהענן (Over-The-Air Auto Updates)**:
  - לא צריך לחבר את המחשב ולהתקין קובץ IPK מחדש בכל פעם שיש עדכון!
  - האפליקציה מכילה מנגנון **Smart Bootstrapper** הבודק את השרת המקוון בהפעלה, וטוען את הגרסה העדכנית ביותר ישירות מהאינטרנט.
  - במידה ואין אינטרנט או שהשרת לא זמין, האפליקציה מפעילה מיידית את העותק המקומי השמור בטלוויזיה.

- 🎯 **100% Live TV נקי ללא עומס**:
  - מיועד נטו לשידורים חיים (ללא סרטים, סדרות או עומסי VOD מיותרים).
  - טעינה וניתוח מהירים של קובצי וכתובות **M3U / M3U8**.
  - חלוקה אוטומטית לקטגוריות לפי `group-title` ושמירת ערוצים מועדפים (★).

- 🎮 **חוויית שלט מלאה (Remote-First UX)**:
  - **D-Pad 5-Way**: תנועה חלקה באמצעות חיצי השלט בכל חלקי הממשק.
  - **אישור (OK)**: לחיצה על ערוץ מעבירה אותו מיד למסך מלא (Full Screen) **ללא השהייה וללא טעינה מחדש של הזרם**!
  - **חזרה (LG Back - קוד 461 / ESC)**: יציאה מיידית ממסך מלא חזרה למדריך הערוצים.
  - **כפתורי צבעים בשלט LG**:
    - 🔴 **אדום**: הגדרות פלייליסט M3U ומקלדת וירטואלית מובנית לשלט.
    - 🟢 **ירוק**: חיפוש ערוצים בזמן אמת.
    - 🟡 **צהוב**: הוספה / הסרה של ערוץ ממועדפים (★).
    - 🔵 **כחול**: מעבר בין מסך מלא לתצוגת עיון (Preview).
  - **ספרות 0-9**: הקלדת מספר ערוץ למעבר ישיר (Direct Channel Jump).
  - **ערוץ למעלה / למטה (CH+ / CH-)**: זפינג מהיר בין ערוצים במסך מלא.
  - תמיכה מלאה בסמן שלט האוויר (LG Magic Remote Cursor).

- 📺 **תאימות מוחלטת ל-webOS 4.64, 5.0 ו-6.0+**:
  - צריכת זיכרון מזערית (פחות מ-15MB RAM לעומת 150MB+ בנגנים מבוססי React כבדים).
  - נגן היברידי (HTML5 Native + `Hls.js` מקומי) עם מנגנון שחזור וחיבור מחדש אוטומטי בעת נפילת שידור.

---

## 📸 מבנה הממשק (ZenPlay Style)

```
┌──────────────┬────────────────────────────┬────────────────────────────────────────────┐
│   קטגוריות   │       רשימת ערוצים         │             תצוגה מקדימה חיה               │
│ (מתקפל ימינה)│                            │                                            │
│              │ 1. כאן 11 HD            ★  │  ┌──────────────────────────────────────┐  │
│  ★ מועדפים   │ 2. קשת 12 HD            ★  │  │                                      │  │
│  כל הערוצים  │ 3. רשת 13 HD               │  │             [ שידור חי ]             │  │
│  ספורט       │ 4. עכשיו 14 HD             │  │                                      │  │
│  חדשות       │ 5. ספורט 5 HD              │  └──────────────────────────────────────┘  │
│  ילדים       │ 6. ספורט 5 פלוס            │   1 | כאן 11 HD    [★ במועדפים]        │
│  סרטים       │ 7. ערוץ הסרטים             │   לחץ אישור (OK) למסך מלא                   │
└──────────────┴────────────────────────────┴────────────────────────────────────────────┘
 🔴 הגדרות M3U     🟢 חיפוש ערוץ     🟡 הוסף/הסר מועדף     🔵 מסך מלא
```

---

## 📦 הורדה והתקנה על טלוויזיית LG

### אפשרות 1: הורדת ה-IPK ישירות מ-GitHub Releases (הכי פשוט!)
1. היכנס לדף ה-Releases:
   👉 **[IPTV Live WebOS GitHub Releases](https://github.com/maorisraelii/iptv-webos/releases)**
2. הורד את הקובץ: **`IPTV-Live-webOS.ipk`**.
3. פתח את תוכנת [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) במחשב כשהטלוויזיה מחוברת.
4. לחץ על **Install App** ובחר בקובץ ה-`IPTV-Live-webOS.ipk`.
5. האפליקציה תותקן מיד במסך הבית של הטלוויזיה!

---

### אפשרות 2: אריזה והתקנה מהירה מקומית עם PowerShell

בתיקיית הפרויקט הרץ:
```powershell
.\package_ipk.ps1
```
הסקריפט יוצר את קובץ ה-IPK העדכני. במידה והטלוויזיה שלך מוגדרת ב-`ares-cli`, תוכל להתקין ישירות:
```powershell
.\package_ipk.ps1 -Device <TV_NAME>
```

---

## 🔄 איך עובדים העדכונים האוטומטיים (OTA)?

בכל פעם שאתה מעדכן את הקוד ודוחף אותו ל-GitHub (`git push origin main`):
1. **GitHub Actions רץ אוטומטית:**
   - מעדכן את האתר החי ב-**GitHub Pages** (`https://maorisraelii.github.io/iptv-webos/`).
   - יוצר קובץ `.ipk` מעודכן ומפרסם אותו ב-Releases.
2. **בטלוויזיה:**
   - ברגע שתפתח את האפליקציה בטלוויזיה, היא תטען מיד את הגרסה החדשה מהענן – **ללא צורך בהתקנה מחדש לעולם!**

---

## 💻 הרצה ובדיקה במחשב

לפני התקנה בטלוויזיה, תוכל לבדוק את האפליקציה ישירות בדפדפן המחשב:

```bash
npm start
```
ופתח בדפדפן את הכתובת:
```
http://localhost:3000/
```

*(מקשי החצים, Enter, Esc, ומקשי המספרים במקלדת מדמים במדויק את שלט ה-LG).*

---

## 📜 רישיון

פרויקט זה מופץ תחת רישיון **MIT**.
האפליקציה היא נגן מדיה בלבד ואינה כוללת או מאחסנת שידורים או זכויות יוצרים.
