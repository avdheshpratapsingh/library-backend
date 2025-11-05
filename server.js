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
});

const Student = mongoose.model('Student', studentSchema);

// Routes

// Get all students
app.get('/students', async (req, res) => {
  const students = await Student.find();
  res.json(students);
});

// Add or edit student
app.post('/students', async (req, res) => {
  const { seat, name, mobile, joinDate, fee, attendance, feePaid } = req.body;
  let student = await Student.findOne({ seat });
  if (student) {
    student.name = name;
    student.mobile = mobile;
    student.joinDate = joinDate;
    student.fee = fee ?? 500;
    student.attendance = attendance ?? false;
    student.feePaid = feePaid ?? false;
    await student.save();
  } else {
    student = new Student({ seat, name, mobile, joinDate, fee });
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
app.patch('/students/:seat/fee', async (req, res) => {
  const { seat } = req.params;
  const student = await Student.findOne({ seat });
  if (!student) return res.status(404).json({ error: 'Student not found' });
  student.feePaid = !student.feePaid;
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

// Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));