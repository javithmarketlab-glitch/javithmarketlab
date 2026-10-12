require('dotenv').config();
const db = require('./db');

const email = 'dharmik.mahulkar19@gmail.com';

db.query(
  "INSERT INTO subscriptions (email, plan_name, status) VALUES (?, 'Lifetime', 'ACTIVE') ON DUPLICATE KEY UPDATE status='ACTIVE'",
  [email],
  (err) => {
    if (err) {
      console.log('Error:', err);
    } else {
      console.log('Activated for:', email);
    }
    process.exit();
  }
);