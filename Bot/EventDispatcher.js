/**
 * EventDispatcher.js - Unparteiischer, sequenzieller, puffernder Priorisierer
 * "Einer nach dem anderen"
 * Garantiert sequenzielle Event-Verarbeitung durch Priority-Queue.
 */

import PQueue from 'p-queue';
import winston from 'winston';

class EventDispatcher {
  constructor(bot, queueManager, botStateManager, events) {
    this.bot = bot;
    this.queueManager = queueManager;
    this.botStateManager = botStateManager;
    this.events = events;
    
    // Gebot 2: Priority-Queue mit p-queue
    // Gebot 3: Concurrency = 1
    this.priorityQueue = new PQueue({
      concurrency: 1,
      queueClass: PriorityQueue
    });
    
    // Status tracking
    this.isListening = false;
    this.processedCount = 0;
    this.statusUpdateInterval = null;
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [EventDispatcher] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
    
    // Set dispatcher reference in events
    this.events.setEventDispatcher(this);
  }
  
  /**
   * Start listening for events
   */
  startListening() {
    if (this.isListening) {
      this.logger.warn('EventDispatcher already listening');
      return;
    }
    
    this.logger.info('EventDispatcher starting - Sequential processing enabled');
    this.isListening = true;
    
    // Start event listeners
    this.events.startListening();
    
    // Start periodic status updates
    const updateInterval = parseInt(process.env.STATUS_UPDATE_INTERVAL) || 30000;
    this.statusUpdateInterval = setInterval(() => {
      this.events.triggerStatusUpdate();
    }, updateInterval);
    
    // Log queue status periodically
    setInterval(() => {
      if (this.priorityQueue.size > 0) {
        this.logger.debug(`Queue status - Size: ${this.priorityQueue.size}, Pending: ${this.priorityQueue.pending}`);
      }
    }, 10000);
    
    this.logger.info('Event system activated - Listening for all events');
  }
  
  /**
   * Stop listening for events
   */
  stopListening() {
    if (!this.isListening) {
      return;
    }
    
    this.logger.info('EventDispatcher stopping');
    this.isListening = false;
    
    // Stop event listeners
    this.events.stopListening();
    
    // Clear status update interval
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
    
    // Clear queue
    this.priorityQueue.clear();
    
    this.logger.info(`EventDispatcher stopped - Processed ${this.processedCount} events total`);
  }
  
  /**
   * Gebot 1 & 6: Single public method for event dispatch
   */
  dispatch(eventMessage) {
    if (!this.isListening) {
      this.logger.warn('EventDispatcher not listening, ignoring event');
      return;
    }
    
    // Gebot 7: Log event receipt
    this.logger.debug(`Event '${eventMessage.eventType}' received and added to queue. Queue size: ${this.priorityQueue.size + 1}`);
    
    // Add to priority queue with inverted priority (lower number = higher priority)
    const priority = this.invertPriority(eventMessage.priority);
    
    this.priorityQueue.add(
      () => this._processEvent(eventMessage),
      { priority: priority }
    );
  }
  
  /**
   * Gebot 4: Private method to process single event
   */
  async _processEvent(eventMessage) {
    const startTime = Date.now();
    
    // Gebot 7: Log dispatch
    this.logger.info(`Dispatching event '${eventMessage.eventType}' (Priority: ${eventMessage.priority}) to QueueManager`);
    
    try {
      // Gebot 4: Disponent role - just pass to QueueManager
      await this.queueManager.processEvent(eventMessage);
      
      this.processedCount++;
      const duration = Date.now() - startTime;
      
      // Gebot 7: Log completion
      this.logger.debug(`Event '${eventMessage.eventType}' processing finished in ${duration}ms`);
      
    } catch (error) {
      this.logger.error(`Error processing event '${eventMessage.eventType}': ${error.message}`);
      
      // Don't throw - continue processing other events
      // The system should be resilient to individual event failures
    }
  }
  
  /**
   * Invert priority for p-queue (lower number = higher priority)
   */
  invertPriority(priority) {
    // Priority 1 (highest) becomes 0 (first in queue)
    // Priority 5 (lowest) becomes 4 (last in queue)
    return priority - 1;
  }
  
  /**
   * Get dispatcher status
   */
  getStatus() {
    return {
      isListening: this.isListening,
      queueSize: this.priorityQueue.size,
      queuePending: this.priorityQueue.pending,
      processedTotal: this.processedCount,
      isPaused: this.priorityQueue.isPaused
    };
  }
  
  /**
   * Pause event processing (for debugging)
   */
  pause() {
    this.logger.warn('Pausing event processing');
    this.priorityQueue.pause();
  }
  
  /**
   * Resume event processing
   */
  resume() {
    this.logger.info('Resuming event processing');
    this.priorityQueue.start();
  }
  
  /**
   * Clear pending events (emergency use only)
   */
  clearQueue() {
    const size = this.priorityQueue.size;
    this.priorityQueue.clear();
    this.logger.warn(`Cleared ${size} pending events from queue`);
  }
}

/**
 * Custom priority queue implementation for p-queue
 * Lower priority value = higher priority (processed first)
 */
class PriorityQueue {
  constructor() {
    this._queue = [];
  }
  
  enqueue(run, options) {
    const element = { run, priority: options.priority };
    
    // Binary search to find insertion point
    let low = 0;
    let high = this._queue.length;
    
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this._queue[mid].priority > element.priority) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    
    this._queue.splice(low, 0, element);
  }
  
  dequeue() {
    const element = this._queue.shift();
    return element?.run;
  }
  
  filter(options) {
    return this._queue.filter(element => element.priority === options.priority)
      .map(element => element.run);
  }
  
  get size() {
    return this._queue.length;
  }
}

export default EventDispatcher;