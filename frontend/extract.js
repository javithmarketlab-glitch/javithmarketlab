const fs = require('fs');
const c = fs.readFileSync('Index.html', 'utf8');
const m = c.match(/base64,([A-Za-z0-9+/=]+)/);
if (m) {
  fs.writeFileSync('luffy.png', Buffer.from(m[1], 'base64'));
  console.log('Saved luffy.png, size:', m[1].length);
} else {
  console.log('Not found');
}