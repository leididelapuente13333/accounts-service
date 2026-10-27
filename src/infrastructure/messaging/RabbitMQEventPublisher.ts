import amqp, { Channel, ChannelModel } from 'amqplib';
import {
  DomainEvent,
  EventPublisherPort,
  FundsDepositedEventPayload,
  TransferCompletedEventPayload,
  UserCreatedEventPayload,
} from '../../domain/ports/out/EventPublisherPort';
import { config } from '../config/environment';

export class RabbitMQEventPublisher implements EventPublisherPort {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnecting: boolean = false;
  private readonly url: string;
  private readonly exchange: string;

  constructor(url?: string, exchange?: string) {
    this.url = url || config.rabbitMq.url;
    this.exchange = exchange || config.rabbitMq.exchange;
  }

  public async init(): Promise<void> {
    if (this.channel) return;
    if (this.isConnecting) {
      await this.waitForConnection();
      return;
    }

    this.isConnecting = true;
    try {
      const conn = await amqp.connect(this.url);
      this.connection = conn;

      conn.on('error', (err) => {
        console.error('[RabbitMQ] Connection error:', err.message);
        this.channel = null;
        this.connection = null;
      });

      conn.on('close', () => {
        console.warn('[RabbitMQ] Connection closed. Will reconnect on next publish.');
        this.channel = null;
        this.connection = null;
      });

      const ch = await conn.createChannel();
      await ch.assertExchange(this.exchange, 'topic', { durable: true });
      this.channel = ch;

      console.log(`[RabbitMQ] Connected to broker and asserted exchange '${this.exchange}'`);
    } catch (error: any) {
      console.error('[RabbitMQ] Failed to connect to broker:', error.message);
      this.channel = null;
      this.connection = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private async getChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.init();
    }
    return this.channel!;
  }

  private async waitForConnection(retries: number = 20): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (this.channel) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!this.channel) {
      throw new Error('Timeout waiting for RabbitMQ channel establishment');
    }
  }

  public async publishUserCreated(event: DomainEvent<UserCreatedEventPayload>): Promise<void> {
    const channel = await this.getChannel();
    const content = Buffer.from(JSON.stringify(event));

    // Publish to user.created as required by notification-service
    channel.publish(this.exchange, 'user.created', content, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      type: event.eventName,
    });

    // Also publish to account.created for services listening specifically on account events
    channel.publish(this.exchange, 'account.created', content, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      type: 'account.created',
    });

    console.log(`[RabbitMQ] Published event '${event.eventName}' to exchange '${this.exchange}'`);
  }

  public async publishFundsDeposited(event: DomainEvent<FundsDepositedEventPayload>): Promise<void> {
    const channel = await this.getChannel();
    const content = Buffer.from(JSON.stringify(event));

    channel.publish(this.exchange, 'wallet.funds-deposited', content, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      type: event.eventName,
    });

    console.log(`[RabbitMQ] Published event '${event.eventName}' to exchange '${this.exchange}' [RoutingKey: wallet.funds-deposited]`);
  }

  public async publishTransferCompleted(event: DomainEvent<TransferCompletedEventPayload>): Promise<void> {
    const channel = await this.getChannel();
    const content = Buffer.from(JSON.stringify(event));

    channel.publish(this.exchange, 'transfer.completed', content, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      correlationId: event.payload.transactionId,
      type: event.eventName,
    });

    console.log(`[RabbitMQ] Published event '${event.eventName}' to exchange '${this.exchange}' [RoutingKey: transfer.completed]`);
  }

  public async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      console.log('[RabbitMQ] Connection closed gracefully.');
    } catch (err: any) {
      console.warn('[RabbitMQ] Error while closing connection:', err.message);
    }
  }
}
