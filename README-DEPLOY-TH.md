# สำรวจสายสื่อสารบนเสา — OpenStreetMap + Supabase

ไฟล์ชุดนี้สำหรับเผยแพร่หน้าเว็บผ่าน GitHub Pages เท่านั้น ฐานข้อมูลและ API ยังคงอยู่บน Supabase โปรเจกต์ `pole-survey-app-copy` (`pejjgshrhimywsuaxjjm`)

## ไฟล์หลัก
- `index.html` — หน้าเว็บ
- `config.js` — URL ของ Supabase Edge Function และ publishable key (เป็น public key สำหรับ client ไม่ใช่ secret key)
- `offline-bridge.js` — เชื่อมคำสั่งเดิมของหน้าเว็บกับ Supabase API และรองรับคิวงานออฟไลน์
- `leaflet-compat.js` — ปรับการเรียก API แผนที่เดิมให้ใช้ Leaflet/OpenStreetMap
- `service-worker.js`, `manifest.webmanifest`, `icons/` — PWA
- `Deploy-PoleSurvey-GitHub-Pages.ps1` — สคริปต์ส่งไฟล์จาก Windows ไปยัง repository ที่กำหนด

## เผยแพร่
1. แตก ZIP ลงในโฟลเดอร์ใหม่
2. ติดตั้ง Git for Windows หากยังไม่มี
3. เปิด PowerShell ในโฟลเดอร์นี้ แล้วรัน:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Deploy-PoleSurvey-GitHub-Pages.ps1
   ```
4. หาก Git ขอให้ลงชื่อเข้าใช้ ให้เลือกบัญชี GitHub `aekpubg1` ซึ่งเป็นเจ้าของ repository ปลายทาง
5. ใน GitHub เปิด **Settings → Pages → Build and deployment** แล้วตั้ง **Deploy from a branch**, Branch `main`, Folder `/ (root)` แล้ว Save
6. URL ที่คาดไว้: `https://aekpubg1.github.io/pole-survey-app-copy-pages/` (ใช้ได้หลัง GitHub Pages เผยแพร่สำเร็จ)

## ความปลอดภัยและข้อจำกัด
- ห้ามใส่ Supabase `service_role` หรือ secret key ในไฟล์หน้าเว็บ
- Publishable key ที่อยู่ใน `config.js` ตั้งใจให้ใช้จากเบราว์เซอร์ แต่ API ยังต้องบังคับตรวจรหัสแอปฝั่ง Edge Function
- Repository นี้เป็น public จึงเปิดเผยซอร์สหน้าเว็บและค่าตั้งค่าฝั่ง client ได้
- ยังต้องทดสอบหน้าเว็บจริงหลังเผยแพร่ ทั้งการโหลดเสา การบันทึกผลสำรวจ รูปถ่าย และการบันทึก KML ก่อนใช้ภาคสนาม
