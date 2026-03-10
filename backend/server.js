const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const amqp = require('amqplib');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

/* =====================================================
   USER SCHEMA
===================================================== */

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: 'User' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);

/* =====================================================
   DATABASE STATE
===================================================== */

let dbState = {
  status: 'disconnected',
  error: null,
  latency: null,
  host: null,
  dbName: null,
};

/* =====================================================
   CONNECT MONGODB
===================================================== */

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/userapp';

  dbState.status = 'connecting';
  const start = Date.now();

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

    dbState = {
      status: 'connected',
      error: null,
      latency: Date.now() - start,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      dbName: mongoose.connection.name,
    };

    console.log('✅ MongoDB connected:', mongoose.connection.host);

    await seedUsers();
  } catch (err) {
    dbState = {
      status: 'error',
      error: err.message,
      latency: Date.now() - start,
    };

    console.error('❌ MongoDB connection error:', err.message);
  }
}

mongoose.connection.on('disconnected', () => {
  dbState.status = 'disconnected';
});

mongoose.connection.on('reconnected', () => {
  dbState.status = 'connected';
});

/* =====================================================
   SEED SAMPLE USERS
===================================================== */

async function seedUsers() {
  if (await User.countDocuments() > 0) return;

  await User.insertMany([
    { name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin', status: 'active' },
    { name: 'Bob Smith', email: 'bob@example.com', role: 'Developer', status: 'active' },
    { name: 'Carol White', email: 'carol@example.com', role: 'Designer', status: 'inactive' },
    { name: 'David Lee', email: 'david@example.com', role: 'Developer', status: 'active' },
    { name: 'Eva Martinez', email: 'eva@example.com', role: 'Manager', status: 'active' },
  ]);

  console.log('🌱 Seeded 5 sample users');
}

/* =====================================================
   RABBITMQ
===================================================== */

let rabbitChannel;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect("amqp://localhost");
    rabbitChannel = await connection.createChannel();

    await rabbitChannel.assertQueue("user_queue", { durable: true });

    console.log("🐰 RabbitMQ connected");
  } catch (err) {
    console.error("❌ RabbitMQ connection error:", err.message);

    console.log("Retrying RabbitMQ connection in 5 seconds...");
    setTimeout(connectRabbitMQ, 5000);
  }
}

/* =====================================================
   ROUTES
===================================================== */

app.get('/api/ping', async (req, res) => {
  const start = Date.now();

  try {
    await mongoose.connection.db.admin().ping();

    res.json({
      ...dbState,
      pingMs: Date.now() - start,
      serverTime: new Date(),
    });
  } catch (err) {
    res.status(503).json({
      ...dbState,
      error: err.message,
    });
  }
});

/* =====================================================
   GET USERS
===================================================== */

app.get('/api/users', async (req, res) => {
  if (dbState.status !== 'connected') {
    return res.status(503).json({ error: 'DB not connected' });
  }

  try {
    const users = await User.find().sort({ createdAt: -1 });

    res.json({
      count: users.length,
      users,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   CREATE USER
===================================================== */

app.post('/api/users', async (req, res) => {
  if (dbState.status !== 'connected') {
    return res.status(503).json({ error: 'DB not connected' });
  }

  try {
    const user = await User.create(req.body);

    /* Send RabbitMQ message */
    if (rabbitChannel) {
      const message = {
        type: "USER_CREATED",
        name: user.name,
        email: user.email,
        timestamp: new Date(),
      };

      rabbitChannel.sendToQueue(
        "user_queue",
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
      );

      console.log("📨 Message sent to RabbitMQ:", message);
    }

    res.status(201).json(user);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* =====================================================
   DELETE USER
===================================================== */

app.delete('/api/users/:id', async (req, res) => {
  if (dbState.status !== 'connected') {
    return res.status(503).json({ error: 'DB not connected' });
  }

  try {
    await User.findByIdAndDelete(req.params.id);

    res.json({ deleted: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =====================================================
   RECONNECT DB
===================================================== */

app.post('/api/reconnect', async (req, res) => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await connectDB();

  res.json(dbState);
});

/* =====================================================
   START SERVER
===================================================== */

const PORT = process.env.PORT || 3001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

/* =====================================================
   INITIAL CONNECTIONS
===================================================== */

connectDB();
connectRabbitMQ();
