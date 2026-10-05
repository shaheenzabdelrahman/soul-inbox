import { config } from './config.js';
import { q, tx } from './db.js';
import { hashPassword } from './security.js';

const STAGES = [
  // key, en, ar, kind, requires_phone, requires_follow_up, is_qualified
  ['new', 'New', 'جديد', 'open', 0, 0, 0],
  ['qualifying', 'Qualifying', 'جاري التأهيل', 'open', 0, 0, 0],
  ['qualified', 'Qualified', 'مؤهل', 'open', 1, 0, 1],
  ['quoted', 'Price sent', 'تم إرسال السعر', 'open', 1, 1, 1],
  ['negotiating', 'Negotiating', 'تفاوض', 'open', 1, 1, 1],
  ['booking_requested', 'Booking requested', 'طلب حجز', 'open', 1, 0, 1],
  ['won', 'Booked', 'تم الحجز', 'won', 1, 0, 1],
  ['lost', 'Lost', 'مفقود', 'lost', 0, 0, 0],
  ['invalid', 'Invalid', 'غير صالح', 'invalid', 0, 0, 0],
];

const LOST_REASONS = [
  ['price', 'Price', 'السعر'],
  ['no_availability', 'No availability', 'لا يوجد متاح'],
  ['no_response', 'Customer stopped responding', 'العميل توقف عن الرد'],
  ['booked_elsewhere', 'Booked elsewhere', 'حجز في مكان آخر'],
  ['dates_changed', 'Dates changed', 'تغيرت التواريخ'],
  ['unit_mismatch', 'Unit did not match', 'الوحدة غير مناسبة'],
  ['customer_cancelled', 'Customer cancelled', 'العميل ألغى'],
  ['competitor', 'Went to competitor', 'ذهب لمنافس'],
  ['wrong_lead', 'Wrong lead', 'عميل غير مناسب'],
  ['other', 'Other', 'أخرى'],
];

const TEMPLATES = [
  ['Welcome', 'ترحيب', 'أهلاً بيك في Soul Hospitality 🌊 معاك {{agent_name}}. ممكن تقولي المشروع اللي حابب تحجز فيه، تاريخ الوصول والمغادرة، وعدد الأفراد؟'],
  ['Ask details', 'تفاصيل', 'عشان أبعتلك المتاح والأسعار محتاج: المشروع، تاريخ الوصول، تاريخ المغادرة، عدد الأفراد، وعدد الغرف.'],
  ['Ask phone', 'رقم', 'ممكن رقم الموبايل/واتساب عشان أبعتلك صور الوحدات والتفاصيل كاملة؟'],
  ['Deposit', 'عربون', 'لتأكيد الحجز مطلوب عربون، وهبعتلك طرق الدفع حالاً. بعد التحويل ابعت صورة الإيصال وفريق الحسابات هيأكد الحجز.'],
  ['Follow-up', 'متابعة', 'أهلاً {{customer_name}} 👋 حبيت أطمن لو لسه مهتم بالحجز؟ الوحدات في الفترة دي بتخلص بسرعة.'],
  ['No availability', 'غير متاح', 'للأسف التواريخ دي مش متاحة حالياً. تحب أشوفلك تواريخ قريبة أو مشروع تاني؟'],
];

export function bootstrap() {
  tx(() => {
    if (!q.get('SELECT 1 FROM lead_stages LIMIT 1')) {
      STAGES.forEach(([key, en, ar, kind, phone, fu, qual], i) => q.run(
        'INSERT INTO lead_stages (key, name_en, name_ar, position, kind, requires_phone, requires_follow_up, is_qualified) VALUES (?,?,?,?,?,?,?,?)',
        key, en, ar, i + 1, kind, phone, fu, qual,
      ));
    }
    if (!q.get('SELECT 1 FROM lost_reasons LIMIT 1')) {
      LOST_REASONS.forEach(([key, en, ar], i) => q.run('INSERT INTO lost_reasons (key, name_en, name_ar, position) VALUES (?,?,?,?)', key, en, ar, i + 1));
    }
    if (!q.get('SELECT 1 FROM templates LIMIT 1')) {
      for (const [title, shortcut, body] of TEMPLATES) {
        q.run('INSERT INTO templates (title, body, shortcut, created_at) VALUES (?,?,?,?)', title, body, shortcut, Date.now());
      }
    }
    if (!q.get('SELECT 1 FROM users LIMIT 1')) {
      const a = config.bootstrapAdmin;
      q.run(
        "INSERT INTO users (name, email, password_hash, role, in_rotation, created_at) VALUES (?,?,?,'admin',0,?)",
        a.name, a.email, hashPassword(a.password), Date.now(),
      );
      console.log(`[bootstrap] created admin ${a.email} - change the password after first login`);
    }
  });
  // Audit/webhook payloads can hold personal data; keep the raw webhook log for 14 days only.
  q.run('DELETE FROM webhook_log WHERE received_at < ?', Date.now() - 14 * 86400000);
  q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}
