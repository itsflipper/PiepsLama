/**
 * QueueManager.js - Ruthloser, zustandsbewusster Fluglotse
 * "Fabrik, nicht Lager"
 * Verwaltet Lebenszyklus aller Queues und orchestriert Context Switches.
 */

import winston from 'winston';
import StandardQueue from './StandardQueue.js';
import EmergencyQueue from './EmergencyQueue.js';
import RespawnQueue from './RespawnQueue.js';

class QueueManager {
  constructor(bot, botStateManager, ollamaInterface, aiResponseParser, botActions, learningManager, logger) {
    // Gebot 7: Zentraler Knotenpunkt der Abhängigkeiten
    this.bot = bot;
    this.botStateManager = botStateManager;
    this.ollamaInterface = ollamaInterface;
    this.aiResponseParser = aiResponseParser;
    this.botActions = botActions;
    this.learningManager = learningManager;
    
    // Queue state
    this.activeQueue = null;
    this.pausedQueue = null;
    
    // Persistent standard queue and currently active temporary queues
    this.standardQueue = null;
    this.emergencyQueue = null;
    this.respawnQueue = null;
    
    // Queue completion handlers
    this.queueCompletionHandlers = new Map();
    
    // Setup logger
    this.logger = logger || winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [QueueManager] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
    
    this.logger.info('QueueManager initialized');
  }
  
  /**
   * Initialize the queue system
   */
  initialize() {
    // Create persistent standard queue
    this.standardQueue = new StandardQueue(
      this.bot,
      this.botStateManager,
      this.ollamaInterface,
      this.aiResponseParser,
      this.botActions,
      this.learningManager,
      this.logger
    );
    
    this.logger.info('Queue system initialized with StandardQueue');
  }
  
  /**
   * Gebot 2: Process event from EventDispatcher
   */
  async processEvent(eventMessage) {
    this.logger.debug(`Processing event: ${eventMessage.eventType} (Priority: ${eventMessage.priority})`);
    
    // Determine action based on event
    const action = eventMessage.response.actionRequired;
    
    switch (action) {
      case 'interrupt':
        await this.handleInterrupt(eventMessage);
        break;
        
      case 'pause':
        await this.handlePause();
        break;
        
      case 'resume':
        await this.handleResume();
        break;
        
      case 'reset':
        await this.handleReset();
        break;
        
      case 'none':
      default:
        await this.handleStatusUpdate(eventMessage);
        break;
    }
  }
  
  /**
   * Gebot 3: Handle interrupt for high-priority events
   */
  async handleInterrupt(eventMessage) {
    this.logger.warn(`Interrupt received for ${eventMessage.response.targetQueue} queue`);
    
    // Pause current queue if active
    if (this.activeQueue && this.activeQueue !== this.standardQueue) {
      // If emergency is active and we get another emergency, don't pause
      if (this.activeQueue instanceof EmergencyQueue && eventMessage.response.targetQueue === 'emergency') {
        this.logger.warn('Emergency already active, ignoring interrupt');
        return;
      }
    }
    
    // Pause current queue
    if (this.activeQueue) {
      this.logger.info(`Pausing current queue: ${this.getQueueType(this.activeQueue)}`);
      this.activeQueue.pause();
      this.pausedQueue = this.activeQueue;
    }
    
    // Create and start appropriate queue
    switch (eventMessage.response.targetQueue) {
      case 'emergency':
        await this.startEmergencyQueue(eventMessage);
        break;
        
      case 'respawn':
        await this.startRespawnQueue(eventMessage);
        break;
        
      default:
        this.logger.error(`Unknown target queue: ${eventMessage.response.targetQueue}`);
    }
  }
  
  /**
   * Gebot 1: Create and start emergency queue
   */
  async startEmergencyQueue(eventMessage) {
    this.logger.error('Creating Emergency Queue');
    
    // Extract emergency context
    const emergencyContext = {
      type: eventMessage.eventType === 'damage_received' ? 'damage' : 'hunger',
      source: eventMessage.data.details.source || 'unknown',
      severity: eventMessage.data.details.isCritical ? 'critical' : 'high'
    };
    
    // Create emergency queue
    this.emergencyQueue = new EmergencyQueue(
      this.bot,
      this.botStateManager,
      this.ollamaInterface,
      this.aiResponseParser,
      this.botActions,
      this.learningManager,
      this.logger,
      emergencyContext
    );

    // Set completion handler
    this.emergencyQueue.onComplete = () => this.handleQueueComplete('emergency');

    // Set as active and start
    this.activeQueue = this.emergencyQueue;
    await this.emergencyQueue.start();
  }
  
  /**
   * Gebot 1: Create and start respawn queue
   */
  async startRespawnQueue(eventMessage) {
    this.logger.info('Creating Respawn Queue');
    
    // Extract death context
    const deathInfo = this.botStateManager.getDeathInfo();
    const deathContext = {
      deathLocation: deathInfo.position || this.bot.entity.position,
      deathReason: deathInfo.reason || 'unknown',
      lostInventory: eventMessage.data.details.lostInventory || []
    };
    
    // Create respawn queue
    this.respawnQueue = new RespawnQueue(
      this.bot,
      this.botStateManager,
      this.ollamaInterface,
      this.aiResponseParser,
      this.botActions,
      this.learningManager,
      this.logger,
      deathContext
    );
    
    // Set completion handler
    this.respawnQueue.onComplete = (success) => this.handleQueueComplete('respawn', success);
    
    // Set as active and start
    this.activeQueue = this.respawnQueue;
    await this.respawnQueue.start();
  }
  
  /**
   * Handle pause request
   */
  async handlePause() {
    if (this.activeQueue) {
      this.logger.info(`Pausing active queue: ${this.getQueueType(this.activeQueue)}`);
      this.activeQueue.pause();
    }
  }
  
  /**
   * Handle resume request
   */
  async handleResume() {
    if (this.activeQueue) {
      this.logger.info(`Resuming active queue: ${this.getQueueType(this.activeQueue)}`);
      await this.activeQueue.resume();
    } else if (this.pausedQueue) {
      this.logger.info(`Resuming paused queue: ${this.getQueueType(this.pausedQueue)}`);
      this.activeQueue = this.pausedQueue;
      this.pausedQueue = null;
      await this.activeQueue.resume();
    }
  }
  
  /**
   * Handle reset request
   */
  async handleReset() {
    this.logger.warn('Resetting all queues');
    
    // Stop all queues
    if (this.activeQueue) {
      this.activeQueue.stop();
    }
    if (this.pausedQueue) {
      this.pausedQueue.stop();
    }
    
    // Clear state
    this.activeQueue = null;
    this.pausedQueue = null;
    this.emergencyQueue = null;
    this.respawnQueue = null;
    
    // Reset bot state
    this.botStateManager.resetGoals();
    this.botStateManager.setCurrentQueue(null, 0);
    
    this.logger.info('All queues reset');
  }
  
  /**
   * Gebot 5: Handle status update when idle
   */
  async handleStatusUpdate(eventMessage) {
    // If no queue is active, start standard queue
    if (!this.activeQueue) {
      this.logger.info('No active queue, starting StandardQueue');
      this.activeQueue = this.standardQueue;
      await this.standardQueue.start();
    }
    
    // Pass status update to active queue if it's the standard queue
    if (this.activeQueue === this.standardQueue && eventMessage.eventType === 'status_update') {
      // StandardQueue will request new plan on its own schedule
      this.logger.debug('Status update received, StandardQueue active');
    }
  }
  
  /**
   * Gebot 4: Handle queue completion
   */
  handleQueueComplete(queueType, success = true) {
    this.logger.info(`${queueType} queue completed (success: ${success})`);

    // Destroy completed temporary queue
    if (this.activeQueue && queueType !== 'standard') {
      this.activeQueue.stop();
      this.activeQueue = null;
      if (queueType === 'emergency') {
        this.emergencyQueue = null;
      } else if (queueType === 'respawn') {
        this.respawnQueue = null;
      }
    }
    
    // Check for paused queue to resume
    if (this.pausedQueue) {
      this.logger.info(`Resuming paused queue: ${this.getQueueType(this.pausedQueue)}`);
      this.activeQueue = this.pausedQueue;
      this.pausedQueue = null;
      this.activeQueue.resume();
    } else {
      // No paused queue, start standard queue
      this.logger.info('No paused queue, starting StandardQueue');
      this.activeQueue = this.standardQueue;
      this.standardQueue.start();
    }
    
    // Update bot state
    const newQueueType = this.getQueueType(this.activeQueue);
    this.botStateManager.setCurrentQueue(newQueueType, this.getQueuePriority(newQueueType));
  }
  
  /**
   * Get queue type name
   */
  getQueueType(queue) {
    if (queue instanceof StandardQueue) return 'standard';
    if (queue instanceof EmergencyQueue) return 'emergency';
    if (queue instanceof RespawnQueue) return 'respawn';
    return 'unknown';
  }
  
  /**
   * Get queue priority
   */
  getQueuePriority(queueType) {
    const priorities = {
      'emergency': 1,
      'respawn': 2,
      'standard': 3
    };
    return priorities[queueType] || 0;
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const status = {
      activeQueue: this.activeQueue ? this.getQueueType(this.activeQueue) : null,
      pausedQueue: this.pausedQueue ? this.getQueueType(this.pausedQueue) : null,
      queueStates: {}
    };
    
    // Get individual queue states
    if (this.standardQueue) {
      status.queueStates.standard = this.standardQueue.getStatus();
    }
    if (this.activeQueue instanceof EmergencyQueue) {
      status.queueStates.emergency = this.activeQueue.getStatus();
    }
    if (this.activeQueue instanceof RespawnQueue) {
      status.queueStates.respawn = this.activeQueue.getStatus();
    }
    
    return status;
    
  }
  
  /**
   * Save queue state (for persistence)
   */
  async saveState() {
    const state = {
      activeQueueType: this.activeQueue ? this.getQueueType(this.activeQueue) : null,
      pausedQueueType: this.pausedQueue ? this.getQueueType(this.pausedQueue) : null,
      timestamp: new Date().toISOString()
    };
    
    // Additional queue-specific state could be saved here
    this.logger.info('Queue state saved');
    return state;
  }
  
  /**
   * Restore queue state (after restart)
   */
  async restoreState(state) {
    if (!state) return;
    
    this.logger.info(`Restoring queue state from ${state.timestamp}`);
    
    // For now, just start standard queue
    // Complex state restoration could be implemented here
    this.activeQueue = this.standardQueue;
    await this.standardQueue.start();
  }
  
  /**
   * Shutdown all queues
   */
  async shutdown() {
    this.logger.info('Shutting down QueueManager');

    // Stop all active queues
    if (this.activeQueue) {
      this.activeQueue.stop();
    }
    if (this.pausedQueue) {
      this.pausedQueue.stop();
    }

    this.emergencyQueue = null;
    this.respawnQueue = null;
    
    // Save final state
    await this.saveState();
    
    this.logger.info('QueueManager shutdown complete');
  }

  getQueueStatistics() {
    const emergencyStats = this.emergencyQueue
      ? {
          size: this.emergencyQueue.currentActionQueue.length,
          avgProcessingTime: this.emergencyQueue.getAverageProcessingTime(),
          successRate: this.emergencyQueue.getSuccessRate()
        }
      : { size: 0, avgProcessingTime: 0, successRate: 0 };

    const respawnStats = this.respawnQueue
      ? {
          size: this.respawnQueue.currentActionQueue.length,
          avgProcessingTime: this.respawnQueue.getAverageProcessingTime(),
          successRate: this.respawnQueue.getSuccessRate()
        }
      : { size: 0, avgProcessingTime: 0, successRate: 0 };

    return {
      standardQueue: {
        size: this.standardQueue ? this.standardQueue.currentActionQueue.length : 0,
        avgProcessingTime: this.standardQueue ? this.standardQueue.getAverageProcessingTime() : 0,
        successRate: this.standardQueue ? this.standardQueue.getSuccessRate() : 0
      },
      emergencyQueue: emergencyStats,
      respawnQueue: respawnStats
    };
  }
}

export default QueueManager;