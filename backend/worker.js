const amqp = require("amqplib");

const QUEUE_NAME = "user_queue";
const RABBIT_URL = "amqp://localhost";

async function startWorker() {
  try {
    console.log("🔄 Starting RabbitMQ worker...");

    const connection = await amqp.connect(RABBIT_URL);
    const channel = await connection.createChannel();

    await channel.assertQueue(QUEUE_NAME, { durable: true });

    console.log(`👷 Worker waiting for messages in queue: ${QUEUE_NAME}`);

    channel.consume(
      QUEUE_NAME,
      async (msg) => {
        if (!msg) return;

        try {
          const data = JSON.parse(msg.content.toString());

          console.log("📩 Received message:", data);

          /* PROCESS MESSAGE */

          if (data.type === "USER_CREATED") {
            console.log(`📧 Sending welcome email to ${data.email}`);

            // simulate background work
            await new Promise((resolve) => setTimeout(resolve, 1000));

            console.log(`✅ Welcome email sent to ${data.email}`);
          }

          channel.ack(msg);

        } catch (err) {
          console.error("❌ Worker processing error:", err.message);
          channel.nack(msg, false, false);
        }
      },
      { noAck: false }
    );

  } catch (err) {
    console.error("❌ RabbitMQ worker error:", err.message);

    console.log("Retrying worker connection in 5 seconds...");
    setTimeout(startWorker, 5000);
  }
}

startWorker();
