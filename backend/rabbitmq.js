const amqp = require("amqplib");

async function sendToQueue(queue, message) {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  await channel.assertQueue(queue, { durable: true });

  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)));

  console.log("📨 Message sent to queue:", message);

  setTimeout(() => connection.close(), 500);
}

module.exports = { sendToQueue };
