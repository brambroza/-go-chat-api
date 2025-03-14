require('dotenv').config();
const amqp = require('amqplib');

let connection = null;
let channel = null;

async function initRabbitMQ() {
  if (!connection) {
    try {
      connection = await amqp.connect(process.env.RABBITMQ_URL);
      channel = await connection.createChannel();
      console.log('RabbitMQ connected');
    } catch (error) {
      console.error('RabbitMQ connection error:', error);
    }
  }
  return channel;
}

async function publishToQueue(queueName, message) {
  if (!channel) {
    await initRabbitMQ();
  }
  await channel.assertQueue(queueName, { durable: true });
  channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
    persistent: true
  });
  console.log(`Message sent to queue ${queueName}`);
}

module.exports = {
  initRabbitMQ,
  publishToQueue
};
