/**
 * Events.js - Event-Handler-Router
 * "Übersetzer, nicht Kommentator"
 * Übersetzt Mineflayer-Events in kontextreiche EventMessages.
 */

import { v4 as uuidv4 } from 'uuid';

class Events {
  constructor(bot, botStateManager) {
    this.bot = bot;
    this.botStateManager = botStateManager;
    this.eventDispatcher = null; // Will be set by EventDispatcher
    
    // Gebot 7: Internal state for contextualization
    this.lastHealth = 20;
    this.lastFood = 20;
    this.lastPosition = null;
    this.combatStartTime = null;
    this.containerOpenTime = null;
    
    // Critical thresholds
    this.HUNGER_CRITICAL_THRESHOLD = 10;
    this.HEALTH_CRITICAL_THRESHOLD = 6;
    this.DAMAGE_THRESHOLD = 0.5; // Minimum damage to trigger event
  }
  
  /**
   * Set the EventDispatcher reference
   */
  setEventDispatcher(dispatcher) {
    this.eventDispatcher = dispatcher;
  }
  
  /**
   * Gebot 6: Start listening to all relevant events
   */
  startListening() {
    // Connection events
    this.bot.on('spawn', () => this.handleSpawn());
    this.bot.on('respawn', () => this.handleRespawn());
    this.bot.on('death', () => this.handleDeath());
    this.bot.on('kicked', (reason) => this.handleKicked(reason));
    this.bot.on('end', (reason) => this.handleEnd(reason));
    
    // Health & survival events
    this.bot.on('health', () => this.handleHealth());
    
    // Combat events
    this.bot.on('entityHurt', (entity) => this.handleEntityHurt(entity));
    this.bot.on('entityAttack', (entity) => this.handleEntityAttack(entity));
    this.bot.on('entityGone', (entity) => this.handleEntityGone(entity));
    
    // Chat events
    this.bot.on('chat', (username, message) => this.handleChat(username, message));
    this.bot.on('whisper', (username, message) => this.handleWhisper(username, message));
    
    // Container events
    this.bot.on('windowOpen', (window) => this.handleWindowOpen(window));
    this.bot.on('windowClose', (window) => this.handleWindowClose(window));
    
    // Sleep events
    this.bot.on('sleep', () => this.handleSleep());
    this.bot.on('wake', () => this.handleWake());
    
    // Time events
    this.bot.on('time', () => this.handleTime());
    
    // Weather events
    this.bot.on('rain', () => this.handleWeather());
    
    // Initial status update after spawn
    this.bot.once('spawn', () => {
      setTimeout(() => this.triggerStatusUpdate(), 1000);
    });
  }
  
  /**
   * Stop listening to events
   */
  stopListening() {
    this.bot.removeAllListeners();
  }
  
  /**
   * Gebot 2: Create EventMessage in exact format
   */
  createEventMessage(eventType, priority, data, response = {}) {
    return {
      eventId: uuidv4(),
      eventType: eventType,
      priority: priority,
      timestamp: new Date().toISOString(),
      data: data,
      response: {
        actionRequired: response.actionRequired || 'none',
        targetQueue: response.targetQueue || null,
        newQueueState: response.newQueueState || null
      }
    };
  }
  
  /**
   * Gebot 1: Dispatch event without commanding
   */
  dispatch(eventMessage) {
    if (this.eventDispatcher) {
      this.eventDispatcher.dispatch(eventMessage);
    }
  }
  
  // Event Handlers
  
  handleSpawn() {
    this.botStateManager.setConnected(true);
    this.botStateManager.updateHealth(this.bot.health, this.bot.food);
    
    const event = this.createEventMessage(
      'status_update',
      3,
      {
        sourceEvent: 'spawn',
        details: {
          position: this.bot.entity.position,
          dimension: this.bot.game.dimension,
          gameMode: this.bot.game.gameMode
        },
        affectedQueues: ['standard'],
        requiresImmediateAction: false
      },
      {
        actionRequired: 'resume',
        targetQueue: 'standard'
      }
    );
    
    this.dispatch(event);
  }
  
  handleRespawn() {
    this.botStateManager.setDead(false);
    this.botStateManager.resetCombatState();
    
    const event = this.createEventMessage(
      'status_update',
      2,
      {
        sourceEvent: 'respawn',
        details: {
          position: this.bot.entity.position
        },
        affectedQueues: ['respawn'],
        requiresImmediateAction: true
      },
      {
        actionRequired: 'interrupt',
        targetQueue: 'respawn'
      }
    );
    
    this.dispatch(event);
  }
  
  handleDeath() {
    const deathPosition = this.bot.entity ? this.bot.entity.position : null;
    this.botStateManager.setDead(true, deathPosition, 'unknown');
    
    const event = this.createEventMessage(
      'death',
      1,
      {
        sourceEvent: 'death',
        details: {
          position: deathPosition,
          lastHealth: this.lastHealth,
          combatActive: this.botStateManager.isInCombat()
        },
        affectedQueues: ['standard', 'emergency'],
        requiresImmediateAction: true
      },
      {
        actionRequired: 'pause',
        targetQueue: null
      }
    );
    
    this.dispatch(event);
  }
  
  handleHealth() {
    const currentHealth = this.bot.health;
    const currentFood = this.bot.food;
    
    // Gebot 3: Filter noise
    if (currentHealth === this.lastHealth && currentFood === this.lastFood) {
      return;
    }
    
    this.botStateManager.updateHealth(currentHealth, currentFood);
    
    // Gebot 4: Contextualize health changes
    if (currentHealth < this.lastHealth && (this.lastHealth - currentHealth) >= this.DAMAGE_THRESHOLD) {
      // Damage received
      const damageAmount = this.lastHealth - currentHealth;
      const isCritical = currentHealth <= this.HEALTH_CRITICAL_THRESHOLD;
      
      const event = this.createEventMessage(
        'damage_received',
        isCritical ? 1 : 2,
        {
          sourceEvent: 'health_decrease',
          details: {
            previousHealth: this.lastHealth,
            currentHealth: currentHealth,
            damage: damageAmount,
            isCritical: isCritical
          },
          affectedQueues: isCritical ? ['emergency'] : [],
          requiresImmediateAction: isCritical
        },
        isCritical ? {
          actionRequired: 'interrupt',
          targetQueue: 'emergency'
        } : {}
      );
      
      this.dispatch(event);
    }
    
    // Check for critical hunger
    if (currentFood < this.HUNGER_CRITICAL_THRESHOLD && this.lastFood >= this.HUNGER_CRITICAL_THRESHOLD) {
      const event = this.createEventMessage(
        'hunger_critical',
        2,
        {
          sourceEvent: 'food_critical',
          details: {
            currentFood: currentFood,
            threshold: this.HUNGER_CRITICAL_THRESHOLD
          },
          affectedQueues: ['emergency'],
          requiresImmediateAction: true
        },
        {
          actionRequired: 'interrupt',
          targetQueue: 'emergency'
        }
      );
      
      this.dispatch(event);
    }
    
    this.lastHealth = currentHealth;
    this.lastFood = currentFood;
  }
  
  handleEntityHurt(entity) {
    if (!entity) return;
    
    // Check if bot was hurt
    if (entity.id === this.bot.entity.id) {
      if (!this.botStateManager.isInCombat()) {
        this.botStateManager.setInCombat(true, 'unknown');
        this.combatStartTime = Date.now();
      }
    }
  }
  
  handleEntityAttack(entity) {
    if (!entity || entity.id === this.bot.entity.id) return;
    
    // Bot is attacking something
    if (!this.botStateManager.isInCombat()) {
      this.botStateManager.setInCombat(true, entity.name || entity.type);
    }
  }
  
  handleEntityGone(entity) {
    if (!entity || !this.botStateManager.isInCombat()) return;
    
    // Check if combat target disappeared
    const combatTarget = this.botStateManager.state.combatTarget;
    if (combatTarget && entity.name === combatTarget) {
      this.botStateManager.resetCombatState();
      
      const event = this.createEventMessage(
        'status_update',
        3,
        {
          sourceEvent: 'combat_ended',
          details: {
            target: combatTarget,
            duration: Date.now() - this.combatStartTime
          },
          affectedQueues: ['standard'],
          requiresImmediateAction: false
        }
      );
      
      this.dispatch(event);
    }
  }
  
  handleChat(username, message) {
    // Gebot 3: Filter bot's own messages
    if (username === this.bot.username) return;
    
    // Check for special commands
    const isCommand = message.startsWith('WatchME') || 
                     message.startsWith('StopWatching') || 
                     message.startsWith('ResetGoals');
    
    const event = this.createEventMessage(
      'chat_received',
      isCommand ? 2 : 5,
      {
        sourceEvent: 'chat',
        details: {
          username: username,
          message: message,
          isCommand: isCommand
        },
        affectedQueues: isCommand ? ['standard', 'emergency', 'respawn'] : [],
        requiresImmediateAction: isCommand
      },
      isCommand ? {
        actionRequired: message.startsWith('WatchME') ? 'pause' : 
                       message.startsWith('StopWatching') ? 'resume' : 
                       message.startsWith('ResetGoals') ? 'reset' : 'none'
      } : {}
    );
    
    this.dispatch(event);
  }
  
  handleWhisper(username, message) {
    const event = this.createEventMessage(
      'chat_received',
      4,
      {
        sourceEvent: 'whisper',
        details: {
          username: username,
          message: message,
          isPrivate: true
        },
        affectedQueues: [],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
  }
  
  handleWindowOpen(window) {
    this.containerOpenTime = Date.now();
    this.botStateManager.setInteractingWithContainer(
      true, 
      window.type,
      null // Position unknown from window object
    );
    
    const event = this.createEventMessage(
      'status_update',
      4,
      {
        sourceEvent: 'window_open',
        details: {
          windowType: window.type,
          windowTitle: window.title,
          slots: window.slots.length
        },
        affectedQueues: [],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
  }
  
  handleWindowClose(window) {
    this.botStateManager.setInteractingWithContainer(false);
    
    const event = this.createEventMessage(
      'status_update',
      4,
      {
        sourceEvent: 'window_close',
        details: {
          windowType: window.type,
          interactionDuration: Date.now() - this.containerOpenTime
        },
        affectedQueues: [],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
  }
  
  handleSleep() {
    const event = this.createEventMessage(
      'status_update',
      3,
      {
        sourceEvent: 'sleep',
        details: {
          position: this.bot.entity.position,
          time: this.bot.time.timeOfDay
        },
        affectedQueues: ['standard'],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
  }
  
  handleWake() {
    const event = this.createEventMessage(
      'wakeup',
      2,
      {
        sourceEvent: 'wake',
        details: {
          position: this.bot.entity.position,
          time: this.bot.time.timeOfDay
        },
        affectedQueues: ['standard'],
        requiresImmediateAction: true
      },
      {
        actionRequired: 'reset',
        targetQueue: 'standard'
      }
    );
    
    this.dispatch(event);
  }
  
  handleTime() {
    // Only trigger on significant time changes (every Minecraft hour)
    const currentHour = Math.floor(this.bot.time.timeOfDay / 1000);
    if (!this.lastHour || currentHour !== this.lastHour) {
      this.lastHour = currentHour;
      
      // Check for dangerous night time
      const isNight = !this.bot.time.isDay;
      if (isNight && currentHour === 13) { // Just became night
        const event = this.createEventMessage(
          'status_update',
          4,
          {
            sourceEvent: 'night_time',
            details: {
              timeOfDay: this.bot.time.timeOfDay,
              isDay: false
            },
            affectedQueues: [],
            requiresImmediateAction: false
          }
        );
        
        this.dispatch(event);
      }
    }
  }
  
  handleWeather() {
    const event = this.createEventMessage(
      'status_update',
      5,
      {
        sourceEvent: 'weather_change',
        details: {
          isRaining: this.bot.isRaining,
          thunderState: this.bot.thunderState
        },
        affectedQueues: [],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
  }
  
  handleKicked(reason) {
    this.botStateManager.setConnected(false);
    
    const event = this.createEventMessage(
      'connection_lost',
      1,
      {
        sourceEvent: 'kicked',
        details: {
          reason: reason
        },
        affectedQueues: ['standard', 'emergency', 'respawn'],
        requiresImmediateAction: true
      },
      {
        actionRequired: 'pause',
        targetQueue: null
      }
    );
    
    this.dispatch(event);
  }
  
  handleEnd(reason) {
    this.botStateManager.setConnected(false);
    
    const event = this.createEventMessage(
      'connection_lost',
      1,
      {
        sourceEvent: 'disconnected',
        details: {
          reason: reason
        },
        affectedQueues: ['standard', 'emergency', 'respawn'],
        requiresImmediateAction: true
      },
      {
        actionRequired: 'pause',
        targetQueue: null
      }
    );
    
    this.dispatch(event);
  }
  
  /**
   * Trigger manual status update
   */
  triggerStatusUpdate() {
    const event = this.createEventMessage(
      'status_update',
      3,
      {
        sourceEvent: 'periodic_update',
        details: {
          health: this.bot.health,
          food: this.bot.food,
          position: this.bot.entity.position,
          time: this.bot.time.timeOfDay,
          weather: this.bot.isRaining
        },
        affectedQueues: [],
        requiresImmediateAction: false
      }
    );
    
    this.dispatch(event);
    this.botStateManager.recordStatusUpdate();
  }
}

export default Events;