const dict = {
  en: {
    app: 'Soul Inbox', signIn: 'Sign in', email: 'Email', password: 'Password', logout: 'Sign out', changePassword: 'Change password',
    inbox: 'Inbox', comments: 'Comments', leads: 'Leads', followUps: 'Follow-ups', dashboard: 'Dashboard', team: 'Team', settings: 'Settings',
    online: 'Online', away: 'Away', offline: 'Offline', notifications: 'Notifications', markAllRead: 'Mark all read', noNotifications: 'No notifications',
    search: 'Search name, phone, message…', mine: 'Mine', unassigned: 'Unassigned', needs_reply: 'Needs reply', overdue: 'Overdue',
    waiting: 'Waiting customer', snoozed: 'Snoozed', closed: 'Closed', all: 'All open', hot: 'Hot',
    allChannels: 'All channels', allAgents: 'All agents', messenger: 'Messenger', instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook',
    noConversations: 'No conversations here', selectConversation: 'Select a conversation',
    assignTo: 'Assign to', assignToMe: 'Take this chat', unassignedLabel: 'Unassigned', reassign: 'Reassign',
    markWaiting: 'Waiting for customer', snooze: 'Snooze', close: 'Close', reopen: 'Reopen', needsReplyAction: 'Mark needs reply',
    snooze1h: '1 hour', snooze3h: '3 hours', snoozeTomorrow: 'Tomorrow 10:00',
    typeLabel: 'Type', priority: 'Priority', normal: 'Normal', high: 'High', urgent: 'Urgent',
    type_unknown: 'Not classified', type_sales_lead: 'Sales lead', type_existing_guest: 'Existing guest', type_owner: 'Owner', type_broker: 'Broker',
    type_complaint: 'Complaint', type_supplier: 'Supplier', type_spam: 'Spam', type_other: 'Other',
    replyPlaceholder: 'Write a reply… (Enter to send, Shift+Enter new line, / for saved replies)', notePlaceholder: 'Internal note - the customer will not see this',
    send: 'Send', addNote: 'Add note', reply: 'Reply', note: 'Note', templates: 'Saved replies', attach: 'Attach', aiSuggest: 'AI suggest',
    windowClosed: '24-hour window closed', windowClosedMeta: 'Meta does not allow messaging this customer until they write again.',
    windowClosedWa: 'Only an approved WhatsApp template can be sent now.', windowCloses: 'Reply window closes', sendTemplate: 'Send template',
    templateName: 'Template name', language: 'Language', viewing: 'is viewing', viewingPlural: 'are viewing',
    sla_ok: 'left', sla_warn: 'left', sla_over: 'overdue', sla_night: 'Clock starts', waitingSince: 'Waiting',
    lead: 'Lead', customer: 'Customer', cycle: 'Cycle', ai: 'AI', createLead: 'Create lead', noLead: 'No lead yet for this chat.',
    stage: 'Stage', project: 'Project', unitType: 'Unit type', checkIn: 'Check-in', checkOut: 'Check-out', guests: 'Guests', budget: 'Budget',
    temperature: 'Temperature', source: 'Source', campaign: 'Campaign / Ad', owner: 'Owner', save: 'Save', saved: 'Saved', cancel: 'Cancel',
    hot_t: 'Hot', warm_t: 'Warm', cold_t: 'Cold', none: '-', nights: 'nights',
    won: 'Booked', lost: 'Lost', invalid: 'Invalid', lostReason: 'Lost reason', lostNote: 'Details (optional)', bookingRef: 'Booking reference',
    bookingValue: 'Booking value (EGP)', followUpAt: 'Follow-up date & time', followUpNote: 'What to do', addFollowUp: 'Add follow-up',
    done: 'Done', openFollowUps: 'Follow-ups', noFollowUps: 'No open follow-ups', due: 'Due', overdueLabel: 'Overdue', today: 'Today', upcoming: 'Upcoming',
    name: 'Name', phone: 'Phone', notes: 'Notes', identities: 'Profiles', otherChats: 'Other chats', previousLeads: 'Leads',
    firstMessage: 'First message', firstAssigned: 'First assigned', firstReply: 'First reply', replies: 'Replies', avgReply: 'Average reply',
    breaches: 'SLA breaches', reassignments: 'Reassignments', stageHistory: 'Stage history', fullLog: 'Full activity log', by: 'by', after: 'after',
    summary: 'Summary', generate: 'Generate', classify: 'Classify', requirements: 'Requirements', lastRequest: 'Last request', nextAction: 'Next action',
    status: 'Status', intent: 'Intent', sentiment: 'Sentiment', urgency: 'Urgency', aiOff: 'AI is not configured.', useExtracted: 'Use AI details',
    leadsTitle: 'Leads', openLeads: 'Open', allLeads: 'All', customerCol: 'Customer', dates: 'Dates', nextFollowUp: 'Next follow-up', updated: 'Updated',
    openChat: 'Open chat', noLeads: 'No leads', allProjects: 'All projects',
    commentsNew: 'New', commentsReplied: 'Replied', commentsHandled: 'Handled', publicReply: 'Reply publicly', privateReply: 'Send private message',
    toLead: 'Create lead', markHandled: 'Mark handled', takeIt: 'Take it', post: 'Post', privateSent: 'Private message sent', leadCreated: 'Lead created',
    noComments: 'No comments here', onlyOnePrivate: 'Meta allows one private message per comment.',
    period: 'Period', p_today: 'Today', p_yesterday: 'Yesterday', p_7: 'Last 7 days', p_30: 'Last 30 days', p_month: 'This month',
    liveNow: 'Right now', atRisk: 'About to breach', unclassified: 'Not classified', commentsOpen: 'Comments waiting',
    conversations: 'Conversations', qualified: 'Qualified', bookings: 'Bookings', conversion: 'Conversion', firstResponse: 'First response (median)',
    slaCompliance: 'SLA compliance', bookingValueTotal: 'Booking value', avgResponse: 'Avg reply', medianResponse: 'Median reply',
    agentPerformance: 'Team performance', agent: 'Agent', chats: 'Chats', sent: 'Messages', movedAway: 'Moved (late)', followUpsDone: 'Follow-ups done',
    waitingNow: 'Waiting now', channelPerformance: 'Channels', funnel: 'Lead funnel', lostReasons: 'Why we lose', bySource: 'By source', byProject: 'By project',
    hourly: 'Customer messages by hour (Cairo)', daily: 'New conversations per day', responseDist: 'Reply time distribution', noData: 'No data for this period',
    conversionHelp: 'Booked ÷ qualified leads created in the period', ofFirst: 'of first stage',
    users: 'Users', addUser: 'Add user', role: 'Role', active: 'Active', inRotation: 'Gets chats', maxOpen: 'Max waiting chats', edit: 'Edit', newPassword: 'New password (optional)',
    role_admin: 'Admin', role_manager: 'Manager', role_supervisor: 'Supervisor', role_agent: 'Agent', lastSeen: 'Last seen', load: 'Load',
    s_general: 'Hours & SLA', s_channels: 'Channels', s_stages: 'Lead stages', s_reasons: 'Lost reasons', s_templates: 'Saved replies', s_ai: 'AI', s_sim: 'Test simulator', s_audit: 'Audit log',
    businessStart: 'Team starts', businessEnd: 'Team ends', businessHelp: 'Use 00:00 → 24:00 for a 24/7 clock.', nightMode: 'Outside working hours',
    night_ai: 'AI replies (guarded, no prices)', night_message: 'Send fixed message once', night_off: 'Do nothing', nightMessage: 'Fixed night message',
    slaTarget: 'Reply within (minutes)', slaWarning: 'Warn after (minutes)', reassignOnBreach: 'Move chat to next agent when late', reassignWindow: 'Next agent gets (minutes)',
    maxAutoReassign: 'Max automatic moves per wait', escSupervisor: 'Alert supervisor after (minutes)', escManager: 'Alert manager after (minutes)',
    commentSla: 'Comment target (minutes)', followUpEscalate: 'Escalate overdue follow-up after (minutes)', allowClaim: 'Agents can take unassigned chats',
    presenceTimeout: 'Mark offline after inactivity (minutes)', humanAgentTag: 'Use Human Agent tag (needs Meta approval)', projects: 'Projects (one per line)',
    webhookUrl: 'Webhook callback URL', verifyToken: 'Verify token', configured: 'configured', notConfigured: 'NOT configured',
    addChannel: 'Add channel', channelType: 'Channel type', externalId: 'ID', pageId: 'Linked Facebook Page ID', wabaId: 'WhatsApp Business Account ID',
    accessToken: 'Access token (System User)', test: 'Test', subscribe: 'Subscribe webhooks', tokenSaved: 'Token saved', disable: 'Disable', enable: 'Enable',
    idHelp_messenger: 'Facebook Page ID', idHelp_instagram: 'Instagram professional account ID', idHelp_whatsapp: 'WhatsApp Phone number ID',
    key: 'Key', nameEn: 'Name (EN)', nameAr: 'Name (AR)', kind: 'Kind', needsPhone: 'Needs phone', needsFollowUp: 'Needs follow-up', countsQualified: 'Counts as qualified',
    addStage: 'Add stage', addReason: 'Add reason', addTemplate: 'Add saved reply', title: 'Title', shortcut: 'Shortcut', body: 'Text',
    templateVars: 'Variables: {{customer_name}}, {{agent_name}}', knowledgeBase: 'Company facts the AI may use', aiEnabled: 'AI enabled', aiAutoClassify: 'Classify new chats automatically',
    aiModel: 'Model', simIntro: 'Send a fake customer message to try routing, SLA and stages. Simulated customers never reach Meta.',
    simCustomer: 'Customer name', simText: 'Message', simAd: 'Ad ID (optional)', simSend: 'Send as customer', simComment: 'Post as comment', sentOk: 'Sent',
    event: 'Event', when: 'When', who: 'Who', details: 'Details', loadMore: 'Load more', system: 'System',
    confirm: 'Confirm', required: 'Required', errorGeneric: 'Something went wrong', currentPassword: 'Current password', passwordChanged: 'Password changed. Sign in again.',
    enableNotifications: 'Enable desktop alerts', you: 'you', customerSays: 'Customer', aiSender: 'AI (auto)', autoSender: 'Automatic', externalSender: 'Replied in Meta app',
    failed: 'Not delivered', pending: 'Sending…', delivered: 'Delivered', read: 'Read', sentStatus: 'Sent',
    ev_conversation_created: 'Conversation started', ev_assigned: 'Assigned', ev_stage_changed: 'Stage changed', ev_lead_created: 'Lead created',
    ev_sla_warning: 'SLA warning', ev_sla_breach: 'SLA breached', ev_sla_escalation_supervisor: 'Escalated to supervisor', ev_sla_escalation_manager: 'Escalated to manager',
    ev_status_changed: 'Status changed', ev_note_added: 'Note added', ev_follow_up_created: 'Follow-up scheduled', ev_follow_up_done: 'Follow-up done',
    ev_follow_up_overdue: 'Follow-up overdue', ev_follow_up_cancelled: 'Follow-up cancelled', ev_reopened: 'Reopened by customer', ev_classified: 'Classified',
    ev_ai_classified: 'AI classified', ev_lead_updated: 'Lead details updated', ev_customer_updated: 'Customer updated', ev_ad_referral: 'Came from ad',
    ev_replied_outside_system: 'Replied from Meta app', ev_lead_owner_changed: 'Lead owner changed', ev_snooze_ended: 'Snooze ended',
    reason_auto: 'auto', reason_sticky: 'returning customer', reason_sla_breach: 'late reply', reason_agent_offline: 'agent went offline', reason_manual: 'manual',
    reason_claim: 'taken', reason_takeover: 'taken over',
  },
  ar: {
    app: 'Soul Inbox', signIn: 'تسجيل الدخول', email: 'البريد الإلكتروني', password: 'كلمة المرور', logout: 'تسجيل الخروج', changePassword: 'تغيير كلمة المرور',
    inbox: 'المحادثات', comments: 'التعليقات', leads: 'العملاء المحتملين', followUps: 'المتابعات', dashboard: 'لوحة الأداء', team: 'الفريق', settings: 'الإعدادات',
    online: 'متاح', away: 'مشغول', offline: 'غير متاح', notifications: 'الإشعارات', markAllRead: 'تعليم الكل كمقروء', noNotifications: 'لا توجد إشعارات',
    search: 'ابحث بالاسم أو الرقم أو نص الرسالة…', mine: 'محادثاتي', unassigned: 'غير موزعة', needs_reply: 'محتاجة رد', overdue: 'متأخرة',
    waiting: 'في انتظار العميل', snoozed: 'مؤجلة', closed: 'مغلقة', all: 'كل المفتوح', hot: 'ساخنة',
    allChannels: 'كل القنوات', allAgents: 'كل الموظفين', messenger: 'ماسنجر', instagram: 'إنستجرام', whatsapp: 'واتساب', facebook: 'فيسبوك',
    noConversations: 'لا توجد محادثات هنا', selectConversation: 'اختر محادثة',
    assignTo: 'تحويل إلى', assignToMe: 'استلم المحادثة', unassignedLabel: 'غير موزعة', reassign: 'إعادة توزيع',
    markWaiting: 'في انتظار العميل', snooze: 'تأجيل', close: 'إغلاق', reopen: 'إعادة فتح', needsReplyAction: 'محتاجة رد',
    snooze1h: 'ساعة', snooze3h: '3 ساعات', snoozeTomorrow: 'بكرة 10 الصبح',
    typeLabel: 'النوع', priority: 'الأولوية', normal: 'عادية', high: 'عالية', urgent: 'عاجلة',
    type_unknown: 'غير مصنفة', type_sales_lead: 'عميل حجز', type_existing_guest: 'ضيف حالي', type_owner: 'مالك', type_broker: 'بروكر',
    type_complaint: 'شكوى', type_supplier: 'مورد', type_spam: 'سبام', type_other: 'أخرى',
    replyPlaceholder: 'اكتب ردك… (Enter للإرسال، Shift+Enter سطر جديد، / للردود المحفوظة)', notePlaceholder: 'ملاحظة داخلية - العميل مش هيشوفها',
    send: 'إرسال', addNote: 'إضافة ملاحظة', reply: 'رد', note: 'ملاحظة', templates: 'ردود محفوظة', attach: 'إرفاق', aiSuggest: 'اقتراح AI',
    windowClosed: 'نافذة الـ24 ساعة مقفولة', windowClosedMeta: 'Meta مش بتسمح بمراسلة العميل ده لحد ما يبعت تاني.',
    windowClosedWa: 'مسموح بس بإرسال Template واتساب معتمد.', windowCloses: 'نافذة الرد تقفل', sendTemplate: 'إرسال Template',
    templateName: 'اسم الـTemplate', language: 'اللغة', viewing: 'فاتح المحادثة', viewingPlural: 'فاتحين المحادثة',
    sla_ok: 'متبقي', sla_warn: 'متبقي', sla_over: 'متأخر', sla_night: 'العداد يبدأ', waitingSince: 'منتظر',
    lead: 'الـLead', customer: 'العميل', cycle: 'الدورة', ai: 'AI', createLead: 'إنشاء Lead', noLead: 'لا يوجد Lead لهذه المحادثة.',
    stage: 'المرحلة', project: 'المشروع', unitType: 'نوع الوحدة', checkIn: 'الوصول', checkOut: 'المغادرة', guests: 'عدد الأفراد', budget: 'الميزانية',
    temperature: 'الحرارة', source: 'المصدر', campaign: 'الحملة / الإعلان', owner: 'المسؤول', save: 'حفظ', saved: 'تم الحفظ', cancel: 'إلغاء',
    hot_t: 'ساخن', warm_t: 'دافئ', cold_t: 'بارد', none: '-', nights: 'ليالي',
    won: 'تم الحجز', lost: 'مفقود', invalid: 'غير صالح', lostReason: 'سبب الخسارة', lostNote: 'تفاصيل (اختياري)', bookingRef: 'رقم الحجز',
    bookingValue: 'قيمة الحجز (جنيه)', followUpAt: 'ميعاد المتابعة', followUpNote: 'المطلوب', addFollowUp: 'إضافة متابعة',
    done: 'تم', openFollowUps: 'المتابعات', noFollowUps: 'لا توجد متابعات مفتوحة', due: 'الميعاد', overdueLabel: 'متأخرة', today: 'النهارده', upcoming: 'قادمة',
    name: 'الاسم', phone: 'الموبايل', notes: 'ملاحظات', identities: 'الحسابات', otherChats: 'محادثات أخرى', previousLeads: 'الـLeads',
    firstMessage: 'أول رسالة', firstAssigned: 'أول توزيع', firstReply: 'أول رد', replies: 'عدد الردود', avgReply: 'متوسط الرد',
    breaches: 'تجاوزات الـSLA', reassignments: 'مرات التحويل', stageHistory: 'تاريخ المراحل', fullLog: 'سجل النشاط الكامل', by: 'بواسطة', after: 'بعد',
    summary: 'ملخص', generate: 'إنشاء', classify: 'تصنيف', requirements: 'المطلوب', lastRequest: 'آخر طلب', nextAction: 'الخطوة التالية',
    status: 'الحالة', intent: 'الغرض', sentiment: 'الانطباع', urgency: 'الاستعجال', aiOff: 'الـAI غير مفعل.', useExtracted: 'استخدم بيانات AI',
    leadsTitle: 'العملاء المحتملين', openLeads: 'المفتوحة', allLeads: 'الكل', customerCol: 'العميل', dates: 'التواريخ', nextFollowUp: 'المتابعة القادمة', updated: 'آخر تحديث',
    openChat: 'فتح المحادثة', noLeads: 'لا توجد Leads', allProjects: 'كل المشاريع',
    commentsNew: 'جديدة', commentsReplied: 'تم الرد', commentsHandled: 'منتهية', publicReply: 'رد علني', privateReply: 'رسالة خاصة',
    toLead: 'إنشاء Lead', markHandled: 'تعليم كمنتهي', takeIt: 'استلام', post: 'البوست', privateSent: 'تم إرسال رسالة خاصة', leadCreated: 'تم إنشاء Lead',
    noComments: 'لا توجد تعليقات هنا', onlyOnePrivate: 'Meta بتسمح برسالة خاصة واحدة لكل تعليق.',
    period: 'الفترة', p_today: 'النهارده', p_yesterday: 'امبارح', p_7: 'آخر 7 أيام', p_30: 'آخر 30 يوم', p_month: 'الشهر ده',
    liveNow: 'الآن', atRisk: 'قربت تتأخر', unclassified: 'غير مصنفة', commentsOpen: 'تعليقات منتظرة',
    conversations: 'المحادثات', qualified: 'مؤهلين', bookings: 'الحجوزات', conversion: 'نسبة التحويل', firstResponse: 'أول رد (الوسيط)',
    slaCompliance: 'الالتزام بالـSLA', bookingValueTotal: 'قيمة الحجوزات', avgResponse: 'متوسط الرد', medianResponse: 'وسيط الرد',
    agentPerformance: 'أداء الفريق', agent: 'الموظف', chats: 'محادثات', sent: 'رسائل', movedAway: 'اتنقلت (تأخير)', followUpsDone: 'متابعات تمت',
    waitingNow: 'منتظرين الآن', channelPerformance: 'القنوات', funnel: 'مسار الـLeads', lostReasons: 'ليه بنخسر', bySource: 'حسب المصدر', byProject: 'حسب المشروع',
    hourly: 'رسائل العملاء حسب الساعة (القاهرة)', daily: 'محادثات جديدة يوميًا', responseDist: 'توزيع وقت الرد', noData: 'لا توجد بيانات لهذه الفترة',
    conversionHelp: 'المحجوز ÷ الـLeads المؤهلة اللي اتعملت في الفترة', ofFirst: 'من أول مرحلة',
    users: 'المستخدمين', addUser: 'إضافة مستخدم', role: 'الدور', active: 'نشط', inRotation: 'يستلم محادثات', maxOpen: 'أقصى محادثات منتظرة', edit: 'تعديل', newPassword: 'كلمة مرور جديدة (اختياري)',
    role_admin: 'أدمن', role_manager: 'مدير', role_supervisor: 'مشرف', role_agent: 'موظف حجوزات', lastSeen: 'آخر ظهور', load: 'الحمل',
    s_general: 'المواعيد والـSLA', s_channels: 'القنوات', s_stages: 'مراحل الـLead', s_reasons: 'أسباب الخسارة', s_templates: 'الردود المحفوظة', s_ai: 'الذكاء الاصطناعي', s_sim: 'محاكي الاختبار', s_audit: 'سجل التدقيق',
    businessStart: 'بداية الشغل', businessEnd: 'نهاية الشغل', businessHelp: 'استخدم 00:00 ← 24:00 لتشغيل العداد 24 ساعة.', nightMode: 'خارج مواعيد الشغل',
    night_ai: 'رد AI (محمي، بدون أسعار)', night_message: 'رسالة ثابتة مرة واحدة', night_off: 'لا شيء', nightMessage: 'رسالة الليل الثابتة',
    slaTarget: 'الرد خلال (دقيقة)', slaWarning: 'تنبيه بعد (دقيقة)', reassignOnBreach: 'انقل المحادثة للموظف التالي عند التأخير', reassignWindow: 'مهلة الموظف التالي (دقيقة)',
    maxAutoReassign: 'أقصى عدد تحويلات تلقائية', escSupervisor: 'تنبيه المشرف بعد (دقيقة)', escManager: 'تنبيه المدير بعد (دقيقة)',
    commentSla: 'هدف الرد على التعليقات (دقيقة)', followUpEscalate: 'تصعيد المتابعة المتأخرة بعد (دقيقة)', allowClaim: 'الموظف يقدر يستلم محادثات غير موزعة',
    presenceTimeout: 'اعتباره غير متاح بعد عدم نشاط (دقيقة)', humanAgentTag: 'استخدام Human Agent tag (يحتاج موافقة Meta)', projects: 'المشاريع (سطر لكل مشروع)',
    webhookUrl: 'رابط الـWebhook', verifyToken: 'Verify token', configured: 'مضبوط', notConfigured: 'غير مضبوط',
    addChannel: 'إضافة قناة', channelType: 'نوع القناة', externalId: 'الـID', pageId: 'ID صفحة الفيسبوك المرتبطة', wabaId: 'WhatsApp Business Account ID',
    accessToken: 'Access token (System User)', test: 'اختبار', subscribe: 'تفعيل الـWebhooks', tokenSaved: 'تم حفظ التوكن', disable: 'إيقاف', enable: 'تفعيل',
    idHelp_messenger: 'Facebook Page ID', idHelp_instagram: 'Instagram account ID', idHelp_whatsapp: 'WhatsApp Phone number ID',
    key: 'المفتاح', nameEn: 'الاسم (EN)', nameAr: 'الاسم (AR)', kind: 'النوع', needsPhone: 'يحتاج موبايل', needsFollowUp: 'يحتاج متابعة', countsQualified: 'يعتبر مؤهل',
    addStage: 'إضافة مرحلة', addReason: 'إضافة سبب', addTemplate: 'إضافة رد محفوظ', title: 'العنوان', shortcut: 'اختصار', body: 'النص',
    templateVars: 'متغيرات: {{customer_name}}، {{agent_name}}', knowledgeBase: 'معلومات الشركة اللي الـAI يستخدمها', aiEnabled: 'تفعيل الـAI', aiAutoClassify: 'تصنيف المحادثات الجديدة تلقائيًا',
    aiModel: 'الموديل', simIntro: 'ابعت رسالة عميل تجريبية لتجربة التوزيع والـSLA والمراحل. العملاء التجريبيين مش بيوصلوا لـMeta.',
    simCustomer: 'اسم العميل', simText: 'الرسالة', simAd: 'ID الإعلان (اختياري)', simSend: 'إرسال كعميل', simComment: 'نشر كتعليق', sentOk: 'تم الإرسال',
    event: 'الحدث', when: 'الوقت', who: 'بواسطة', details: 'التفاصيل', loadMore: 'المزيد', system: 'السيستم',
    confirm: 'تأكيد', required: 'مطلوب', errorGeneric: 'حصل خطأ', currentPassword: 'كلمة المرور الحالية', passwordChanged: 'تم تغيير كلمة المرور. سجل دخول تاني.',
    enableNotifications: 'تفعيل تنبيهات سطح المكتب', you: 'أنت', customerSays: 'العميل', aiSender: 'AI (تلقائي)', autoSender: 'رسالة تلقائية', externalSender: 'رد من تطبيق Meta',
    failed: 'لم تصل', pending: 'جاري الإرسال…', delivered: 'وصلت', read: 'اتقرت', sentStatus: 'اتبعتت',
    ev_conversation_created: 'بداية المحادثة', ev_assigned: 'توزيع', ev_stage_changed: 'تغيير المرحلة', ev_lead_created: 'إنشاء Lead',
    ev_sla_warning: 'تنبيه SLA', ev_sla_breach: 'تجاوز SLA', ev_sla_escalation_supervisor: 'تصعيد للمشرف', ev_sla_escalation_manager: 'تصعيد للمدير',
    ev_status_changed: 'تغيير الحالة', ev_note_added: 'ملاحظة', ev_follow_up_created: 'جدولة متابعة', ev_follow_up_done: 'تمت المتابعة',
    ev_follow_up_overdue: 'متابعة متأخرة', ev_follow_up_cancelled: 'إلغاء متابعة', ev_reopened: 'العميل رجع', ev_classified: 'تصنيف',
    ev_ai_classified: 'تصنيف AI', ev_lead_updated: 'تعديل بيانات الـLead', ev_customer_updated: 'تعديل بيانات العميل', ev_ad_referral: 'جاي من إعلان',
    ev_replied_outside_system: 'رد من تطبيق Meta', ev_lead_owner_changed: 'تغيير مسؤول الـLead', ev_snooze_ended: 'انتهاء التأجيل',
    reason_auto: 'تلقائي', reason_sticky: 'عميل سابق', reason_sla_breach: 'تأخير في الرد', reason_agent_offline: 'الموظف خرج', reason_manual: 'يدوي',
    reason_claim: 'استلام', reason_takeover: 'استلام من زميل',
  },
};

let lang = 'ar';
try {
  lang = localStorage.getItem('soul.lang') || 'ar';
} catch {
  // storage unavailable
}

export function getLang() {
  return lang;
}

export function setLang(next) {
  lang = next;
  try {
    localStorage.setItem('soul.lang', next);
  } catch {
    // storage unavailable
  }
  applyDir();
}

export function applyDir() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function t(key) {
  return dict[lang][key] ?? dict.en[key] ?? key;
}

/** Localised name of a stage / lost reason row ({name_en, name_ar}). */
export function nameOf(row) {
  if (!row) return '';
  return lang === 'ar' ? row.name_ar : row.name_en;
}
