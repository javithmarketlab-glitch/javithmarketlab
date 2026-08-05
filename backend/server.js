require("dotenv").config();

const { Cashfree, CFEnvironment } = require("cashfree-pg");

Cashfree.XClientId     = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment  = CFEnvironment.PRODUCTION; // ✅ PRODUCTION
Cashfree.XApiVersion   = "2023-08-01";

console.log("SERVER LOADED 🚀");
console.log("CASHFREE APP ID:", process.env.CASHFREE_APP_ID);

const crypto      = require("crypto");
const nodemailer  = require("nodemailer");
const express     = require("express");
const cors        = require("cors");
const bcrypt      = require("bcryptjs");
const jwt         = require("jsonwebtoken");
const db          = require("./db");
const path        = require("path");

const app = express();

const otpStore    = {};
const resetTokens = {};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(cors());
app.use(express.json());

// ── STATIC FILES ──────────────────────────────────
const FRONTEND = path.join(__dirname, "../frontend");
app.use(express.static(FRONTEND));

// ── EXPLICIT ROUTE FOR success.html ──────────────
app.get("/success.html", (req, res) => {
  res.sendFile(path.join(FRONTEND, "success.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND, "Index.html"));
});

// ── REGISTER ──────────────────────────────────────
app.post("/register", async (req, res) => {
  const { fullname, email, password } = req.body;

  if (!fullname || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      "INSERT INTO users (fullname, email, password) VALUES (?, ?, ?)",
      [fullname, email, hashedPassword],
      (err, result) => {
        if (err) {
          console.log("REGISTER ERROR:", err);
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Email already registered" });
          }
          return res.status(500).json({ success: false, message: err.message });
        }
        res.json({ success: true, message: "User Registered Successfully" });
      }
    );
  } catch (err) {
    console.log("REGISTER CATCH:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── LOGIN ──────────────────────────────────────────
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  db.query(
    "SELECT * FROM users WHERE email=?",
    [email],
    async (err, result) => {
      if (err) {
        console.log("LOGIN ERROR:", err);
        return res.status(500).json({ success: false, message: err.message });
      }
      if (result.length === 0) {
        return res.status(400).json({ success: false, message: "No account found with this email" });
      }

      const user          = result[0];
      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        return res.status(400).json({ success: false, message: "Incorrect password" });
      }

      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || "javithmarketlab_secret",
        { expiresIn: "7d" }
      );

      res.json({ success: true, token, fullname: user.fullname });
    }
  );
});

// ── SEND OTP ───────────────────────────────────────
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({ success: false, message: "Email is required" });
  }

  if (otpStore[email] && Date.now() < otpStore[email].expires) {
    return res.json({ success: false, message: "OTP already sent. Please wait 5 minutes." });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[email] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Password Reset OTP</h2>
          <p>Your OTP is:</p>
          <h1>${otp}</h1>
          <p>This OTP expires in 5 minutes.</p>
        </div>
      `
    });

    console.log("OTP Mail Sent ✅");
    return res.json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.log("MAIL ERROR:", error.message);
    return res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// ── VERIFY OTP ────────────────────────────────────
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const data = otpStore[email];

  if (!data) return res.json({ success: false, message: "OTP not found" });

  if (Date.now() > data.expires) {
    delete otpStore[email];
    return res.json({ success: false, message: "OTP expired" });
  }

  if (data.otp !== otp) return res.json({ success: false, message: "Invalid OTP" });

  const resetToken = crypto.randomBytes(32).toString("hex");
  resetTokens[email] = { token: resetToken, expires: Date.now() + 10 * 60 * 1000 };
  delete otpStore[email];

  res.json({ success: true, resetToken });
});

// ── RESET PASSWORD ────────────────────────────────
app.post("/reset-password", async (req, res) => {
  const { email, newPassword, resetToken } = req.body;
  const tokenData = resetTokens[email];

  if (!tokenData) return res.json({ success: false, message: "Invalid reset token" });

  if (Date.now() > tokenData.expires) {
    delete resetTokens[email];
    return res.json({ success: false, message: "Reset token expired" });
  }

  if (tokenData.token !== resetToken) return res.json({ success: false, message: "Invalid reset token" });

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.query(
      "UPDATE users SET password=? WHERE email=?",
      [hashedPassword, email],
      (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        delete resetTokens[email];
        res.json({ success: true, message: "Password updated successfully" });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── CREATE ORDER (CASHFREE) ───────────────────────
app.post("/create-order", async (req, res) => {
  try {
    const { amount, email, name, phone } = req.body;

    console.log("Creating order for amount:", amount);

    const request = {
      order_amount:   Number(amount),
      order_currency: "INR",
      order_id:       "ORDER_" + Date.now(),

      customer_details: {
        customer_id:    "CUS_" + Date.now(),
        customer_name:  name  || "Customer",
        customer_email: email || "customer@example.com",
        customer_phone: phone || "9999999999"
      },

      order_meta: {
        // ✅ PRODUCTION URL
        return_url: "https://javithmarketlab.online/success.html?order_id={order_id}"
      }
    };

    const response = await Cashfree.PGCreateOrder("2023-08-01", request);

    console.log("Order Created ✅:", response.data.order_id);

    res.json({
      success:            true,
      payment_session_id: response.data.payment_session_id,
      order_id:           response.data.order_id
    });

  } catch (err) {
    console.log("CASHFREE ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error:   err.response?.data || err.message
    });
  }
});

// ── VERIFY ORDER STATUS ───────────────────────────
app.get("/verify-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log("Verifying order:", orderId);

    const response = await Cashfree.PGFetchOrder("2023-08-01", orderId);
    const order    = response.data;

    console.log("Order Status from Cashfree:", order.order_status);

    res.json({
      success: true,
      status:  order.order_status,
      order
    });

  } catch (err) {
    console.log("VERIFY ORDER ERROR:", err.response?.data || err.message);
    res.status(500).json({
      success: false,
      status:  "ERROR",
      error:   err.response?.data || err.message
    });
  }
});

// ── GET USER ──────────────────────────────────────
app.post("/get-user", (req, res) => {
  const { email } = req.body;

  db.query(
    "SELECT fullname, email, plan FROM users WHERE email=?",
    [email],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (result.length === 0) return res.json({ success: false, message: "Email not found" });
      return res.json({ success: true, user: result[0] });
    }
  );
});

// ── UPDATE PLAN ───────────────────────────────────
app.post("/update-plan", (req, res) => {
  const { email, plan } = req.body;

  if (!email || !plan) {
    return res.status(400).json({ success: false, message: "Email and plan required" });
  }

  db.query(
    "UPDATE users SET plan=? WHERE email=?",
    [plan, email],
    (err) => {
      if (err) {
        console.log("UPDATE PLAN ERROR:", err);
        return res.status(500).json({ success: false, message: err.message });
      }

      db.query(
        "INSERT INTO subscriptions (email, plan_name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE plan_name=?, status='ACTIVE'",
        [email, plan, plan],
        (err2) => {
          if (err2) console.log("SUBSCRIPTION INSERT ERROR:", err2);
          res.json({ success: true, message: "Plan Activated ✅" });
        }
      );
    }
  );
});

// ── CHECK SUBSCRIPTION ────────────────────────────
app.post("/check-subscription", (req, res) => {
  const { email } = req.body;

  db.query(
    "SELECT id FROM subscriptions WHERE email=? AND status='ACTIVE'",
    [email],
    (err, result) => {
      if (err) return res.json({ access: false });
      return res.json({ access: result.length > 0 });
    }
  );
});

// ── START SERVER ──────────────────────────────────
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000 ✅");
  console.log("Make sure success.html is in the SAME folder as server.js");
});