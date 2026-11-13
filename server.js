
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tjpqqztfuvrxwgvjofoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_mSIIekVNqGrEIyN3fRPllQ_BqE-LDD4';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ADMIN_ACCOUNTS = {
  admin1: { password: 'root', name: 'Admin 1 (Movitec)' },
  admin2: { password: 'root 2', name: 'Admin 2 (Movitec)' }
};

app.get('/', (req, res) => {
  res.json({ status: 'online', school: 'Movitec Driving School - Cravers, Thika', powered_by: 'StackcraftsStudio' });
});

// Admin Auth
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const account = ADMIN_ACCOUNTS[(username || '').trim().toLowerCase()];
  if (!account || account.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid Admin credentials.' });
  }
  res.json({ success: true, admin: { username, name: account.name } });
});

app.get('/api/meta', async (req, res) => {
  try {
    const [courses, vehicles, instructors] = await Promise.all([
      supabase.from('courses').select('*'),
      supabase.from('vehicles').select('*'),
      supabase.from('profiles').select('*').eq('role', 'instructor')
    ]);
    res.json({ courses: courses.data || [], vehicles: vehicles.data || [], instructors: instructors.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Student Auth & Activation
app.post('/api/students/verify-identity', async (req, res) => {
  try {
    const { id_number, phone } = req.body;
    const { data: student } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student')
      .eq('id_number', id_number.trim())
      .ilike('phone', `%${phone.trim()}%`)
      .maybeSingle();

    if (!student) return res.status(404).json({ success: false, error: 'Student not found matching ID and Phone.' });
    res.json({ success: true, student_id: student.id, full_name: student.full_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/students/set-password', async (req, res) => {
  try {
    const { student_id, password } = req.body;
    await supabase.from('profiles').update({ password_hash: password }).eq('id', student_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/students/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const { data: student } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'student')
      .ilike('phone', `%${phone.trim()}%`)
      .maybeSingle();

    if (!student) return res.status(404).json({ success: false, error: 'Student not found.' });
    if (!student.password_hash) return res.status(403).json({ success: false, needs_activation: true, error: 'Account not activated.' });
    if (student.password_hash !== password) return res.status(401).json({ success: false, error: 'Incorrect password.' });

    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Enrollments & Student Editing
app.post('/api/students', async (req, res) => {
  try {
    const { full_name, email, phone, id_number, pdl_number, course_id, agreed_fee, total_lessons } = req.body;
    const { data: student, error: stErr } = await supabase
      .from('profiles')
      .insert([{ role: 'student', full_name, email, phone, id_number, pdl_number }])
      .select().single();
    if (stErr) throw stErr;

    const lessonsCount = Number(total_lessons) || 24;
    const { data: enrollment, error: enrErr } = await supabase
      .from('enrollments')
      .insert([{ student_id: student.id, course_id, agreed_fee, total_lessons: lessonsCount, remaining_lessons: lessonsCount }])
      .select().single();
    if (enrErr) throw enrErr;

    await supabase.from('notifications').insert([{
      recipient_id: student.id,
      category: 'system',
      title: 'Welcome to Movitec Driving School!',
      message: `Hello ${full_name}, welcome to Movitec (Cravers, Thika). You have ${lessonsCount} classes.`
    }]);

    res.status(201).json({ success: true, student, enrollment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/enrollments', async (req, res) => {
  try {
    const { data, error } = await supabase.from('enrollments').select('*, profiles(id, full_name, phone, email, id_number, pdl_number), courses(name)').order('enrolled_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/enrollments/:id', async (req, res) => {
  try {
    const { full_name, email, phone, id_number, pdl_number, agreed_fee, total_lessons, remaining_lessons } = req.body;
    const enrollmentId = req.params.id;

    const { data: enr, error: enrErr } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('id', enrollmentId)
      .single();

    if (enrErr || !enr) return res.status(404).json({ success: false, error: 'Enrollment not found.' });

    const { error: profErr } = await supabase.from('profiles').update({
      full_name, email, phone, id_number, pdl_number
    }).eq('id', enr.student_id);
    if (profErr) throw profErr;

    const { error: updErr } = await supabase.from('enrollments').update({
      agreed_fee: Number(agreed_fee),
      total_lessons: Number(total_lessons),
      remaining_lessons: Number(remaining_lessons)
    }).eq('id', enrollmentId);
    if (updErr) throw updErr;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mark Finished (Enforces 0 remaining classes AND 0 fee balance)
app.patch('/api/enrollments/:id/complete', async (req, res) => {
  try {
    const { data: currentEnr, error: fetchErr } = await supabase
      .from('enrollments')
      .select('agreed_fee, amount_paid, remaining_lessons')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !currentEnr) {
      return res.status(404).json({ success: false, error: 'Enrollment record not found.' });
    }

    const balance = Number(currentEnr.agreed_fee) - Number(currentEnr.amount_paid);
    if (Number(currentEnr.remaining_lessons) > 0 || balance > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot mark finished. Remaining classes: ${currentEnr.remaining_lessons}, Fee balance: KES ${Math.max(0, balance)}.`
      });
    }

    const { data: enrollment, error } = await supabase
      .from('enrollments')
      .update({ status: 'completed', remaining_lessons: 0 })
      .eq('id', req.params.id)
      .select('*, profiles(id, full_name)').single();
    if (error) throw error;

    await supabase.from('notifications').insert([{
      recipient_id: enrollment.student_id,
      category: 'system',
      title: 'Finished All Classes & Cleared Fees!',
      message: `Congratulations! Your account is marked as FINISHED. You can now book your upcoming exam from your portal.`
    }]);

    res.json({ success: true, enrollment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Payments
app.get('/api/payments', async (req, res) => {
  try {
    let query = supabase.from('payments').select('*, student:profiles!payments_student_id_fkey(full_name, phone)').order('paid_at', { ascending: false });
    if (req.query.student_id) query = query.eq('student_id', req.query.student_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const { data, error } = await supabase.from('payments').insert([req.body]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, payment: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/payments/:id/approve', async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;
    const updates = { status };
    if (status === 'rejected') updates.rejection_reason = rejection_reason || 'No reason provided';

    const { data, error } = await supabase.from('payments').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, payment: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/students/:student_id/fees', async (req, res) => {
  try {
    const { student_id } = req.params;
    const { data: enrollment } = await supabase.from('enrollments').select('*, courses(name, total_lessons)').eq('student_id', student_id).maybeSingle();
    const { data: payments } = await supabase.from('payments').select('*').eq('student_id', student_id).order('paid_at', { ascending: false });
    res.json({ enrollment, payments: payments || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lessons
app.get('/api/lessons', async (req, res) => {
  try {
    let query = supabase.from('lessons').select(`*, student:profiles!lessons_student_id_fkey(full_name, phone), vehicles(plate_number)`).order('scheduled_at', { ascending: false });
    if (req.query.student_id) query = query.eq('student_id', req.query.student_id);
    if (req.query.date) query = query.eq('scheduled_date', req.query.date);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/lessons', async (req, res) => {
  try {
    const { student_id, lesson_type, scheduled_at } = req.body;
    const dateOnly = new Date(scheduled_at).toISOString().split('T')[0];

    const { data: enr } = await supabase.from('enrollments').select('status').eq('student_id', student_id).maybeSingle();
    if (enr && enr.status === 'completed') {
      return res.status(400).json({ success: false, error: 'You have finished classes. Please book your exam instead.' });
    }

    const { data, error } = await supabase.from('lessons').insert([{ student_id, lesson_type, scheduled_date: dateOnly, scheduled_at, status: 'pending' }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, lesson: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/lessons/:id', async (req, res) => {
  try {
    const { status, rejection_reason, instructor_remarks } = req.body;
    const updates = { status };
    if (status === 'rejected') updates.rejection_reason = rejection_reason || 'No reason provided';
    if (instructor_remarks !== undefined) updates.instructor_remarks = instructor_remarks;

    const { data, error } = await supabase.from('lessons').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, lesson: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Exam Requests
app.get('/api/exams', async (req, res) => {
  try {
    let query = supabase.from('exam_requests').select('*').order('created_at', { ascending: false });
    if (req.query.student_id) query = query.eq('student_id', req.query.student_id);
    const { data: exams, error } = await query;
    if (error) throw error;

    const { data: students } = await supabase.from('profiles').select('id, full_name, phone').eq('role', 'student');
    const studentMap = new Map((students || []).map(s => [s.id, s]));

    const enriched = (exams || []).map(ex => ({
      ...ex,
      student: studentMap.get(ex.student_id) || { full_name: 'Student', phone: '' }
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/exams', async (req, res) => {
  try {
    const { data, error } = await supabase.from('exam_requests').insert([req.body]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, exam: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/exams/:id', async (req, res) => {
  try {
    const { status, exam_datetime, rejection_reason } = req.body;
    const updates = { status };
    if (exam_datetime) updates.exam_datetime = exam_datetime;
    if (status === 'rejected') updates.rejection_reason = rejection_reason || 'No reason provided';

    const { data, error } = await supabase.from('exam_requests').update(updates).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, exam: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Announcements & Chat
app.post('/api/announcements', async (req, res) => {
  try {
    const { target, student_ids, title, message, admin_name } = req.body;
    let recipientIds = target === 'ALL' 
      ? (await supabase.from('profiles').select('id').eq('role', 'student')).data.map(s => s.id)
      : student_ids;

    const notifRows = recipientIds.map(id => ({ recipient_id: id, category: 'announcement', title, message }));
    const chatRows = recipientIds.map(id => ({ student_id: id, sender_role: 'admin', sender_name: admin_name || 'Admin', message: `📢 [${title}] ${message}` }));

    await supabase.from('notifications').insert(notifRows);
    await supabase.from('messages').insert(chatRows);

    res.status(201).json({ success: true, sent_count: recipientIds.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    let query = supabase.from('messages').select('*').order('created_at', { ascending: true });
    if (req.query.student_id) query = query.eq('student_id', req.query.student_id);
    const { data: msgs } = await query;

    const { data: students } = await supabase.from('profiles').select('id, full_name, phone').eq('role', 'student');
    const studentMap = new Map((students || []).map(s => [s.id, s]));

    const enriched = (msgs || []).map(m => ({
      ...m,
      student: studentMap.get(m.student_id) || { full_name: m.sender_name, phone: '' }
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { data } = await supabase.from('messages').insert([req.body]).select().single();
    res.status(201).json({ success: true, message: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Notifications
app.get('/api/notifications/:user_id', async (req, res) => {
  try {
    const { data } = await supabase.from('notifications').select('*').eq('recipient_id', req.params.user_id).order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Movitec Driving School API running on port ${PORT}`));
