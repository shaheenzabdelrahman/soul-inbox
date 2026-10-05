# Soul Inbox

صندوق محادثات موحد لفريق حجوزات Soul Hospitality. بيجمع **Messenger** و**Instagram DM** و**WhatsApp** و**تعليقات Facebook/Instagram** في مكان واحد. فيه حساب لكل موظف، وتوزيع تلقائي للمحادثات، وعداد SLA بينقل المحادثة للموظف اللي بعده لو حصل تأخير، ومراحل Lead، ودورة كاملة لكل محادثة، ولوحة أداء.

## اللي موجود في النسخة دي

| الجزء | التفاصيل |
|---|---|
| **القنوات** | Messenger وInstagram DM وWhatsApp Cloud API (رقم واحد)، وتعليقات FB/IG في شاشة منفصلة (رد علني، ورسالة خاصة واحدة، وتحويل لـLead). |
| **الموظفين** | حساب لكل موظف. الأدوار: Admin وManager وSupervisor وAgent. الموظف يقدر يحدد حالته (متاح / مشغول / غير متاح)، ولو قفل الصفحة 3 دقايق بيتحسب غير متاح تلقائيًا. |
| **التوزيع** | أي محادثة جديدة بتروح للموظف المتاح الأقل حملًا (Round robin). العميل الراجع بيرجع لنفس الموظف لو متاح. المدير يقدر يحوّل أي محادثة يدويًا. |
| **الـSLA** | 15 دقيقة على كل رسالة محتاجة رد، والتنبيه بعد 10 دقايق. **لو حصل تأخير، المحادثة بتتنقل للموظف التالي** (حتى مرتين)، والمشرف بيتنبه بعد 30 دقيقة والمدير بعد 60. كل الأرقام دي بتتغير من الإعدادات. |
| **الليل** | من 12 بالليل لـ10 الصبح الـAI بيرد رد محمي (من غير أسعار ولا تأكيدات) وبيسأل عن التفاصيل. عداد الـSLA بيبدأ 10 الصبح، والمحادثات بتتوزع على الموظفين أول ما يبقوا متاحين. |
| **مراحل الـLead** | جديد ← جاري التأهيل ← مؤهل ← تم إرسال السعر ← تفاوض ← طلب حجز ← تم الحجز / مفقود / غير صالح. المراحل بتتعدل من الإعدادات من غير كود. |
| **قواعد إلزامية** | "مؤهل" وما بعدها محتاجة رقم موبايل. "تم إرسال السعر" و"تفاوض" محتاجين ميعاد متابعة. "مفقود" محتاج سبب. إعادة فتح Lead مقفول للمدير بس. ومينفعش تقفل محادثة قبل ما تحدد نوعها. |
| **المتابعات** | تنبيه في ميعاد المتابعة، وتصعيد للمشرف لو اتأخرت. وفيه شاشة متابعات فيها: متأخرة / النهارده / قادمة. |
| **الدورة الكاملة** | تبويب "الدورة" في كل محادثة: أول رسالة، أول توزيع، أول رد ومين رد وفي قد إيه، عدد التحويلات، تجاوزات الـSLA، وتاريخ المراحل والمدة في كل مرحلة، وسجل كامل. |
| **التحليلات** | الوضع الحالي (محتاجة رد، متأخرة، قربت تتأخر، غير موزعة، متابعات، تعليقات)، وأداء كل موظف، والقنوات، ومسار الـLeads، وأسباب الخسارة، والمصدر، والمشروع، والرسائل حسب الساعة. |
| **الـAI** (اختياري) | تصنيف المحادثة واستخراج التواريخ والمشروع وعدد الأفراد، وملخص، واقتراح رد (الموظف هو اللي بيبعت). الـAI بيشتغل عن طريق Claude API. |
| **الأمان** | كلمات مرور مشفرة (scrypt)، وتوكنات Meta مشفرة (AES-256-GCM)، والتحقق من توقيع الـWebhook، وحماية من تخمين كلمة المرور، وسجل تدقيق مينفعش يتعدل أو يتمسح. |
| **محاكي** | تقدر تبعت رسائل وتعليقات تجريبية علشان تدرّب الفريق قبل ما Meta توافق على التطبيق. |

## التشغيل محليًا

```bash
npm install
```

```bash
npm run dev
```

افتح `http://localhost:3000`. أول حساب بيتعمل تلقائيًا: `admin@soul.local` / `ChangeMe!2026`، **غيّر كلمة المرور فورًا** من زرار اسمك فوق.

جرّب من **الإعدادات ← محاكي الاختبار**. ضيف موظفين من **الفريق**، واعمل لكل واحد دخول وخلّيه "متاح"، وبعدها ابعت رسالة تجريبية وشوف التوزيع والعداد.

الاختبارات:

```bash
npm test
```

## الربط بـMeta (Facebook / Instagram / WhatsApp)

> كل ده بيتعمل عن طريق APIs رسمية من Meta. مفيش أي scraping.

### 1) تجهيز Meta Business
1. [business.facebook.com](https://business.facebook.com): اتأكد إن الصفحة وحساب Instagram ورقم WhatsApp كلهم تحت **نفس الـBusiness Portfolio**.
2. **Business verification** (Settings ← Security Center). لازمة لـAdvanced Access ولرفع حدود WhatsApp. **ابدأها النهارده لأنها بتاخد أيام.**
3. اربط حساب Instagram (لازم يكون Professional) بالصفحة.

### 2) تطبيق Meta
1. من [developers.facebook.com](https://developers.facebook.com) اعمل App نوعه **Business**، وضيف المنتجات دي: **Messenger** و**Instagram** و**WhatsApp** و**Webhooks**.
2. الصلاحيات المطلوبة (بتتطلب في App Review علشان تستقبل رسايل من أي عميل):
   - Messenger: `pages_messaging`، `pages_manage_metadata`، `pages_show_list`، `pages_read_engagement`
   - التعليقات: `pages_read_user_content`، `pages_manage_engagement`
   - Instagram: `instagram_basic`، `instagram_manage_messages`، `instagram_manage_comments`
   - WhatsApp: `whatsapp_business_messaging`، `whatsapp_business_management`
3. **Webhooks**:
   - Callback URL: `https://YOUR-DOMAIN/webhooks/meta`، وVerify token: نفس قيمة `META_VERIFY_TOKEN`.
   - Page: `messages`، `message_echoes`، `messaging_postbacks`، `messaging_referrals`، `feed`
   - Instagram: `messages`، `comments`
   - WhatsApp Business Account: `messages`
4. اعمل **System User** في Business Settings، واديله صلاحية على الصفحة وحساب الإنستجرام والـWABA، واعمل منه **توكن ما بينتهيش**. التوكن ده بيتحط في السيستم.

### 3) جوه Soul Inbox (الإعدادات ← القنوات، للأدمن بس)
- **Messenger**: Page ID + التوكن، بعدها اضغط **تفعيل الـWebhooks**.
- **Instagram**: Instagram account ID + Page ID المرتبطة + التوكن، بعدها **تفعيل الـWebhooks**.
- **WhatsApp**: Phone number ID + WABA ID + التوكن، بعدها **تفعيل الـWebhooks**.
- زرار **اختبار** بيتأكد إن التوكن شغال.

### قيود Meta اللي السيستم ملتزم بيها
- **نافذة الـ24 ساعة**: الرد الحر مسموح بس خلال 24 ساعة من آخر رسالة من العميل. بعدها:
  - **WhatsApp**: لازم Template معتمد (ومدفوع).
  - **Messenger/Instagram**: ممنوع إلا لو Meta وافقت على Human Agent tag (بيدي 7 أيام).
  - علشان كده السيستم بيطلب رقم الموبايل قبل مرحلة "مؤهل"، وبيبيّن إمتى النافذة هتقفل.
- **التعليقات**: رسالة خاصة واحدة لكل تعليق، خلال حوالي 7 أيام.
- **ردود Meta Business Suite**: لو حد رد من تطبيق Meta مباشرة، الرد بيتسجل في السيستم على إنه "رد من تطبيق Meta" وبيوقف العداد، بس مش بيتنسب لموظف. **الأفضل إن الفريق كله يرد من Soul Inbox بس.**
- **رقم WhatsApp**: لو الرقم شغال على تطبيق WhatsApp Business على الموبايل، لازم يتنقل لـCloud API أو يتفعل عليه coexistence.

## النشر (Production)

**المطلوب:** سيرفر Linux صغير (2 vCPU / 2–4GB) عليه Node 24 أو Docker، ودومين بـHTTPS (Meta بترفض HTTP).

```bash
cp .env.example .env
```

املا `.env` (`SESSION_SECRET` لازم يكون 32 حرف عشوائي على الأقل)، وبعدها:

```bash
docker build -t soul-inbox .
```

```bash
docker run -d --name soul-inbox --restart unless-stopped -p 3000:3000 --env-file .env -v /srv/soul-inbox:/app/data soul-inbox
```

حط قدامه **nginx** أو **Caddy** للـHTTPS، واقفل الـbuffering على `/api/stream` لأن التحديثات اللحظية بتعدّي منه.

**النسخ الاحتياطي:** كل البيانات في `data/` (`soul-inbox.db` والملفات المرفوعة). خد نسخة يومية برة السيرفر، مثلًا:

```bash
sqlite3 /srv/soul-inbox/soul-inbox.db ".backup /backups/soul-$(date +%F).db"
```

**الحجم:** SQLite بـWAL بيستحمل حجمكم بسهولة (250 محادثة يوميًا في الموسم، و20–50 موظف). لو وصلتوا لعشرات الآلاف من المحادثات يوميًا، أو احتجتوا أكتر من سيرفر، الجداول متصممة إنها تتنقل لـPostgreSQL.

## هيكل الكود

```
server/
  index.js            Express app + security headers + static UI
  schema.sql          قاعدة البيانات
  routes/             API: account, conversations, leads, comments, admin, analytics, webhooks, simulator
  services/
    ingest.js         توحيد رسايل كل القنوات + منع التكرار + ربط العميل
    assignment.js     التوزيع (متاح / أقل حمل / sticky)
    sla.js            العداد، التنبيه، النقل عند التأخير، التصعيد، المتابعات
    hours.js          مواعيد الشغل بتوقيت القاهرة
    leads.js          المراحل وقواعدها
    outbound.js       الإرسال + نافذة الـ24 ساعة
    meta.js           Graph API (Messenger / Instagram / WhatsApp)
    ai.js             Claude: تصنيف، ملخص، اقتراح رد، رد الليل المحمي
public/               الواجهة (JavaScript بدون build step) - عربي/إنجليزي، فاتح/داكن
test/                 اختبارات الـSLA ومواعيد الشغل
```
