require('dotenv').config();
const amqp = require('amqplib');
const { v4: uuidv4 } = require('uuid');

async function testTransferNotification() {
  const RABBITMQ_URL = process.env.RABBITMQ_URL;
  const EXCHANGE = 'domain.events';
  const ROUTING_KEY = 'transfer.completed';

  console.log('Connecting to RabbitMQ...');
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  const txId = 'tx_' + uuidv4().substring(0, 8);
  const event = {
    eventName: 'transfer.completed',
    occurredOn: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    payload: {
      transactionId: txId,
      amount: '150000.00',
      currency: 'COP',
      sourceAccountId: 'acc_source_001',
      destinationAccountId: 'acc_dest_002',
      name: 'Leidi Books',
      email: 'leidi13.books@gmail.com'
    }
  };

  console.log('Publishing transfer.completed event:');
  console.log(JSON.stringify(event, null, 2));

  ch.publish(
    EXCHANGE,
    ROUTING_KEY,
    Buffer.from(JSON.stringify(event)),
    {
      contentType: 'application/json',
      persistent: true,
      correlationId: txId,
      type: 'transfer.completed'
    }
  );

  console.log('Published successfully to domain.events with routing key transfer.completed');
  await new Promise(r => setTimeout(r, 2000));
  await ch.close();
  await conn.close();
}

testTransferNotification().catch(console.error);
