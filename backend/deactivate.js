require('dotenv').config();
const db = require('./db');

const email = 'mohamedthowfeek419@gmail.com';

db.query(
  "DELETE FROM subscriptions WHERE email = ?",
  [email],
  (err, result) => {
    if (err) {
      console.log('Error:', err);
    } else {
      console.log('Deactivated for:', email, '- Rows affected:', result.affectedRows);
    }
    process.exit();
  }
);