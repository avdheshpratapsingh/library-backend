const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB (replace with your URI if hosted online)
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Student schema
const studentSchema = new mongoose.Schema({
  seat: String,
  name: String,
  mobile: String,
  attendance: { type: Boolean, default: false },
  feePaid: { type: Boolean, default: false },
  joinDate: Date,
  fee: { type: Number, default: 500 },
  shift: { type: String, default: "" },

    paymentHistory: [
    {
      month: String, // e.g. "November 2025"
      paid: { type: Boolean, default: false },
      date: { type: Date, default: Date.now }
    }
  ]

});

const Student = mongoose.model('Student', studentSchema);

// Routes

// Get all students
// Get all students
app.get('/students', async (req, res) => {
  try {
    const students = await Student.find();

    // Automatically add current month record if missing
    const currentMonth = new Date().toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });

    for (const student of students) {
      if (!student.paymentHistory) student.paymentHistory = [];

      const alreadyHas = student.paymentHistory.some(
        (h) => h.month === currentMonth
      );
      if (!alreadyHas) {
        student.paymentHistory.push({ month: currentMonth, paid: false });
        await student.save();
      }
    }

    res.json(students);
  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ error: 'Server error' });
  }
});



app.get('/students/:seat/history', async (req, res) => {
  const { seat } = req.params;
  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  res.json(student.paymentHistory || []);
});


// Add or edit student
app.post('/students', async (req, res) => {
  const { seat, name, mobile, joinDate, fee, attendance, feePaid, shift } = req.body;
  let student = await Student.findOne({ seat });
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  
  if (student) {
    student.name = name;
    student.mobile = mobile;
    student.joinDate = joinDate;
    student.fee = fee ?? 500;
    student.attendance = attendance ?? false;
    student.feePaid = feePaid ?? false;
    student.shift = shift ?? "";
    
 if (!student.paymentHistory.some(h => h.month === currentMonth)) {
      student.paymentHistory.push({ month: currentMonth, paid: feePaid ?? false });
    }

    await student.save();
  } 
  
  
  
  else {
    student = new Student({ seat, name, mobile, joinDate, fee, shift, attendance,feePaid, 
     paymentHistory: [{ month: currentMonth, paid: feePaid ?? false  }]
    });
    await student.save();
  }
  res.json(student);
});

// Toggle attendance
app.patch('/students/:seat/attendance', async (req, res) => {
  const { seat } = req.params;
  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  student.attendance = !student.attendance;
  await student.save();
  res.json(student);
});

// Toggle feePaid
// Toggle payment for a specific month
app.patch('/students/:seat/payment/:month', async (req, res) => {
  const { seat, month } = req.params;
  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const record = student.paymentHistory.find(h => h.month === month);
  if (record) {
    record.paid = !record.paid;
    record.date = new Date();
  } else {
    student.paymentHistory.push({ month, paid: true });
  }

  await student.save();
  res.json(student);
});

// Add or update fee history for a specific month
app.patch('/students/:seat/fee-history', async (req, res) => {
  const { seat } = req.params;
  const { month, paid } = req.body;

  if (!month) return res.status(400).json({ error: 'Month is required' });

  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // Initialize if not present
  if (!student.feeHistory) student.feeHistory = [];

  const idx = student.feeHistory.findIndex(entry => entry.month === month);
  if (idx >= 0) {
    student.feeHistory[idx].paid = paid;
  } else {
    student.feeHistory.push({ month, paid });
  }

  await student.save();
  res.json(student);
});


app.post('/students/:seat/send-alert', async (req, res) => {
  const { seat } = req.params;
  const { customMessage } = req.body; // optional custom message

  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const messageBody =
    customMessage ||
    `Hello ${student.name}, this is a reminder that your library fee of ₹${student.fee} is pending. Please pay it soon.`;

  try {
    const message = await client.messages.create({
      from: 'whatsapp:+14155238886', // Twilio sandbox WhatsApp number
      to: `whatsapp:+91${student.mobile}`,
      body: messageBody,
    });

    console.log(`📩 WhatsApp sent to ${student.name}: ${message.sid}`);
    res.json({ success: true, message: 'WhatsApp alert sent successfully!' });
  } catch (err) {
    console.error('⚠️ WhatsApp Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete student
app.delete('/students/:seat', async (req, res) => {
  const { seat } = req.params;
  await Student.findOneAndDelete({ seat });
  res.json({ message: 'Deleted successfully' });
});


// Record payment for a specific month
app.post("/students/:seat/pay", async (req, res) => {
  const { seat } = req.params;
  const { month, amount } = req.body;

  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: "Student not found" });

  // Update or add payment entry
  const existing = student.paymentHistory.find((p) => p.month === month);
  if (existing) {
    existing.paid = true;
    existing.amount = amount;
    existing.datePaid = new Date();
  } else {
    student.paymentHistory.push({
      month,
      paid: true,
      amount,
      datePaid: new Date(),
    });
  }

  await student.save();
  res.json({ success: true, student });
});
// Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));