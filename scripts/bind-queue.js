const amqp = require('amqplib');
require('dotenv').config();

async function checkQueue() {
  const conn = await amqp.connect(process.env.RABBITMQ_URL);
  const ch = await conn.createChannel();
  
  console.log('Explicitly binding notification.events.queue to domain.events with transfer.# and #...');
  await ch.bindQueue('notification.events.queue', 'domain.events', '#');
  await ch.bindQueue('notification.events.queue', 'domain.events', 'transfer.#');
  await ch.bindQueue('notification.events.queue', 'domain.events', 'transfer.completed');

  const qInfo = await ch.checkQueue('notification.events.queue');
  console.log('Queue info:', qInfo);

  await ch.close();
  await conn.close();
}

checkQueue().catch(console.error);
