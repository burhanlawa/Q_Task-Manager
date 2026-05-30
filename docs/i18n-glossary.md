# Q Task Manager — Translation Glossary

**Sprint 21.2 deliverable.** A canonical reference for the product's
key terms in English, Arabic, and Sorani Kurdish (ckb). When the same
concept appears across the UI (button labels, headers, notifications,
emails, invoice PDFs), it should be rendered with the same term — this
file is the source of truth.

When a professional translator engages, they revise this file FIRST,
then we apply the revisions across [messages/en.json](../apps/web/messages/en.json),
[messages/ar.json](../apps/web/messages/ar.json), [messages/ckb.json](../apps/web/messages/ckb.json), the email template
strings ([apps/api/src/emails/templates/](../apps/api/src/emails/templates/)), and the invoice PDF map
([apps/api/src/billing/invoice-pdf.service.ts](../apps/api/src/billing/invoice-pdf.service.ts)).

**Status:** AI-translated baseline. Awaiting native review (see
[project-followups](../.claude/projects/-Users-zhila-Q-Task-Manager-Q-Task-Manager/memory/project_followups.md)).

## Conventions

- **Register**: informal / conversational. Q Task Manager is a workplace
  tool used by people from frontline employees up. Avoid the most
  formal MSA register where Iraqi/Levantine usage would prefer a more
  natural form.
- **Sorani Kurdish (ckb)** uses the Arabic script with extended
  letters (ێ, ۆ, ڕ, ڵ, ێ, ە). Direction is RTL.
- **Verbs in button labels**: use the imperative form (do this), not
  the infinitive (to do this). Example: "Submit" → "أرسل" not "إرسال"
  in a button context.
- **Numbers and dates** stay LTR even in RTL paragraphs (browsers
  handle the bidi automatically).
- **Brand names** stay as-is: "Q Task Manager", "Quantum Tech Agency",
  "Paddle", "Stripe", "Clerk".

## Core entities

| Concept     | English         | Arabic            | Sorani Kurdish     | Notes                                                                          |
| ----------- | --------------- | ----------------- | ------------------ | ------------------------------------------------------------------------------ |
| Task        | Task            | مهمة              | ئەرک                | Singular. Plural: مهام / ئەرکەکان                                                  |
| User        | User / Person   | مستخدم / شخص       | بەکارهێنەر / کەس     | "People" page uses "Person" register, list views use "User"                    |
| Team        | Team            | فريق              | تیم                | Plural: فِرَق / تیمەکان                                                            |
| Department  | Department      | قسم               | بەش                | Plural: أقسام / بەشەکان                                                          |
| Branch      | Branch          | فرع               | لق                 | Plural: فروع / لقەکان                                                            |
| Role        | Role            | دور               | ڕۆڵ                | Plural: أدوار / ڕۆڵەکان                                                          |
| Comment     | Comment         | تعليق             | لێدوان              | Plural: تعليقات / لێدوانەکان                                                       |
| Tag         | Tag             | علامة             | تاگ                | Plural: علامات / تاگەکان. Sorani borrows the English term — more recognizable.    |
| Broadcast   | Broadcast       | إعلان             | ڕاگەیاندن            | Company-wide announcement. Not "إذاعة" (radio).                                 |
| Notification| Notification    | إشعار             | ئاگادارکردنەوە       | The bell icon's items.                                                         |
| File        | File            | ملف               | فایل                | Plural: ملفات / فایلەکان                                                          |
| Invoice     | Invoice         | فاتورة             | پسوولە              | Plural: فواتير / پسوولەکان                                                        |

## Task lifecycle verbs

The task state machine is one of the most-translated areas — these
words appear in buttons, status badges, notifications, and activity
log entries. Consistency matters most here.

| Concept              | English             | Arabic              | Sorani Kurdish        | Notes                                                                    |
| -------------------- | ------------------- | ------------------- | --------------------- | ------------------------------------------------------------------------ |
| Create (task)        | Create / New        | إنشاء / جديد         | دروستکردن / نوێ        | Button: "Create task" = "إنشاء مهمة"                                       |
| Assign (verb)        | Assign              | إسناد                | گواستنەوە               | The action of giving a task to someone                                   |
| Assignee             | Assignee            | المُسنَد إليه         | بەرپرسیار / گرنگ        | Both translations possible; pick one per language                        |
| Accept               | Accept              | قبول                | قبووڵکردن              | Assignee accepts a pending task                                          |
| Start                | Start               | بدء                 | دەستپێکردن              | Move to in_progress                                                      |
| Submit               | Submit              | إرسال                | ناردن                  | Assignee submits work for review                                         |
| Approve              | Approve             | موافقة               | پەسەندکردن             | Creator approves a submission                                            |
| Request revision     | Request revision    | طلب مراجعة            | داواکردنی پێداچوونەوە    | Send back for changes                                                    |
| Reassign             | Reassign            | إعادة إسناد           | گواستنەوەی دووبارە       | Move task to a different assignee                                        |
| Cancel               | Cancel              | إلغاء                | هەڵوەشاندنەوە            | Cancel the whole task                                                    |
| Complete / Completed | Complete / Completed| إكمال / مكتمل        | تەواوکردن / تەواوبووە   | The terminal "done" state                                                |

## Task statuses (badges)

| Status              | English          | Arabic          | Sorani Kurdish     |
| ------------------- | ---------------- | --------------- | ------------------ |
| draft               | Draft            | مسودة            | ڕەشنووس              |
| pending             | Pending          | قيد الانتظار      | چاوەڕوان              |
| assigned            | Assigned         | مُسنَدة           | گواستراوەتەوە          |
| accepted            | Accepted         | مقبولة            | قبووڵکراوە            |
| in_progress         | In progress      | قيد التنفيذ        | لە ئارادایە            |
| submitted           | Submitted        | مُرسَلة            | نێردراوە              |
| needs_revision      | Needs revision   | تحتاج مراجعة       | پێداچوونەوەی پێویستە   |
| approved            | Approved         | موافق عليها        | پەسەندکراوە           |
| completed           | Completed        | مكتملة            | تەواوبووە             |
| cancelled           | Cancelled        | ملغاة             | هەڵوەشێنراوەتەوە       |

## Priority levels

| Priority | English  | Arabic   | Sorani Kurdish |
| -------- | -------- | -------- | -------------- |
| low      | Low      | منخفضة    | نزم             |
| medium   | Medium   | متوسطة    | ناوەند           |
| high     | High     | عالية     | بەرز             |
| urgent   | Urgent   | عاجلة     | بەپەلە           |

## Org roles

The five org roles a user can hold within a tenant. These show up on
profile pages, sidebar role indicators, and the invite dropdown.

| Role        | English      | Arabic         | Sorani Kurdish        |
| ----------- | ------------ | -------------- | --------------------- |
| ceo         | CEO          | الرئيس التنفيذي  | بەڕێوەبەری گشتی          |
| admin       | Admin        | مشرف           | بەڕێوەبەر              |
| manager     | Manager      | مدير           | بەڕێوەبەری ناوبژی         |
| supervisor  | Supervisor   | مشرف فريق        | سەرپەرشتیار            |
| hr          | HR           | الموارد البشرية   | سەرچاوەی مرۆیی          |
| employee    | Employee     | موظف           | کارمەند              |

Note: "Admin" and "Supervisor" in Arabic both translate naturally as
"مشرف" — this is intentional ambiguity at the language level. The UI
distinguishes by context. Some products use "مدير النظام" for Admin to
avoid collision; we keep the shorter form.

## Billing terms

| Concept              | English              | Arabic            | Sorani Kurdish      | Notes                                  |
| -------------------- | -------------------- | ----------------- | ------------------- | -------------------------------------- |
| Plan                 | Plan                 | الخطة              | پلان                |                                        |
| Subscription         | Subscription         | الاشتراك           | بەشداری              |                                        |
| Trial                | Trial                | التجربة            | تاقیکردنەوە           | "Free trial" = "التجربة المجانية" / "تاقیکردنەوەی بێبەرامبەر" |
| Upgrade              | Upgrade              | الترقية            | بەرزکردنەوە           | Verb form used in buttons              |
| Downgrade            | Downgrade            | التخفيض            | داگرتنەوە             |                                        |
| Cancel (subscription)| Cancel               | إلغاء              | هەڵوەشاندنەوە         | Same word as task cancel; context separates |
| Bank transfer        | Bank transfer        | تحويل بنكي          | گواستنەوەی بانکی       |                                        |
| Invoice              | Invoice              | فاتورة             | پسوولە              | See entities table                     |
| Payment              | Payment              | الدفع              | پارەدان              |                                        |
| Past due             | Past due             | متأخر السداد        | بەسەرچوو            |                                        |
| Read-only            | Read-only            | للقراءة فقط         | تەنیا خوێندنەوە       | When subscription is read-only         |

## UI verbs (buttons / actions)

The two-or-three most common button labels appear on dozens of pages.
Get these right first.

| English      | Arabic    | Sorani Kurdish    |
| ------------ | --------- | ----------------- |
| Save         | حفظ        | پاشەکەوتکردن       |
| Cancel       | إلغاء       | هەڵوەشاندنەوە       |
| Delete       | حذف        | سڕینەوە            |
| Edit         | تعديل       | دەستکاری           |
| Confirm      | تأكيد       | پشتڕاستکردنەوە       |
| Yes          | نعم        | بەڵێ              |
| No           | لا         | نا                |
| Search       | بحث        | گەڕان              |
| Filter       | تصفية       | فلتەر              |
| Clear        | مسح        | پاککردنەوە          |
| Loading…     | جارٍ التحميل…| بارکردن…           |
| Open         | فتح        | کردنەوە            |
| Close        | إغلاق       | داخستن             |

## Tone examples

A couple of full-sentence patterns to anchor the translator's
register. These are illustrative — not exhaustive.

| English                                | Arabic                                            | Sorani Kurdish                                  |
| -------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Your trial ends in 3 days.             | تنتهي تجربتك خلال ٣ أيام.                          | تاقیکردنەوەکەت دوای ٣ ڕۆژ کۆتایی دێت.            |
| Task assigned to {name}.               | تم إسناد المهمة إلى {name}.                        | ئەرک گواسترایەوە بۆ {name}.                      |
| Payment failed. Please update your card.| فشل الدفع. يُرجى تحديث بطاقتك.                     | پارەدان شکستی هێنا. تکایە کارتەکەت نوێ بکەرەوە.   |
| Storage usage exceeds the starter plan.| استخدام التخزين يتجاوز خطة starter.                | بەکارهێنانی هەڵگرتن لە پلانی starter تێپەڕیوە.   |

## Reviewer sign-off

When a native reviewer completes a pass, record below.

| Locale | Reviewer name | Date       | Notes                                              |
| ------ | ------------- | ---------- | -------------------------------------------------- |
| ar     | _pending_     | YYYY-MM-DD | Sprint 21.2 deliverable; see followups.            |
| ckb    | _pending_     | YYYY-MM-DD | Sprint 21.2 deliverable; see followups.            |

## How translators apply this glossary

1. **Review** each term in the tables above. Edits in this file are
   the canonical decision.
2. **Apply** revised terms across the three sources, in this order:
   - [apps/web/messages/{locale}.json](../apps/web/messages/) — the main UI bundle.
   - [apps/api/src/emails/templates/](../apps/api/src/emails/templates/) — email subject/body templates.
   - [apps/api/src/billing/invoice-pdf.service.ts](../apps/api/src/billing/invoice-pdf.service.ts) — STRINGS map for invoice PDFs.
3. **Verify** with `cd apps/web && pnpm audit:i18n` — should remain
   825 / 825 / 825, no missing keys after the edit.
4. **Sign off** in the table above with name + date.
