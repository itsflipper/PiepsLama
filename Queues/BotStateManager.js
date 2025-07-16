/**
 * BotStateManager.js - Single Source of Truth für Bot-Zustand
 * "Die eine, dumme, synchrone Wahrheit"
 * Keine Logik, keine Entscheidungen, nur Zustandsverwaltung.
 */

import winston from 'winston';

class BotStateManager {
  constructor() {
    // Gebot 7: Vollständige Initialisierung aller Zustandsvariablen
    this.state = {
      // Execution states
      isExecutingAction: false,
      currentAction: null,
      actionStartTime: null,
      
      // Combat states
      isInCombat: false,
      combatTarget: null,
      lastDamageTime: null,
      
      // Interaction states
      isInteractingWithContainer: false,
      containerType: null,
      containerPosition: null,
      
      // System states
      isSystemPaused: false,
      pauseReason: null,
      
      // Queue states
      currentQueue: null, // 'standard' | 'emergency' | 'respawn' | null
      queuePriority: 0,
      
      // Bot mode states
      botMode: 'idle', // 'idle' | 'executing' | 'paused' | 'watching' | 'combat'
      isWatchingPlayer: false,
      watchingPlayerName: null,
      
      // Health & survival states
      lastHealth: 20,
      lastFood: 20,
      isDead: false,
      deathPosition: null,
      deathReason: null,
      
      // Connection states
      isConnected: false,
      connectionStability: 1.0,
      lastHeartbeat: null,
      
      // Goal states
      currentGoal: null,
      currentHandlung: null,
      handlungProgress: 0,
      
      // Learning states
      lastLearningTrigger: null,
      learningsPendingCount: 0,
      
      // Performance metrics
      actionsExecutedCount: 0,
      failedActionsCount: 0,
      lastActionDuration: 0,
      
      // Timestamps
      botStartTime: Date.now(),
      lastStatusUpdate: null,
      lastEmergencyTrigger: null,
      lastRespawn: null
    };
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [BotStateManager] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
    this.networkMetrics = {
      lastLatency: 0,
      connectionStability: 1.0,
      lastPingTime: Date.now()
    };
    this.logger.debug('BotStateManager initialized with clean state');
  }
  
  // Gebot 2: Granular execution state setters
  setExecutingAction(isExecuting, actionName = null) {
    // Gebot 3: Check if value actually changes
    if (this.state.isExecutingAction === isExecuting && this.state.currentAction === actionName) {
      return;
    }
    
    this.state.isExecutingAction = isExecuting;
    this.state.currentAction = actionName;
    this.state.actionStartTime = isExecuting ? Date.now() : null;
    
    if (isExecuting) {
      this.state.botMode = 'executing';
      this.logger.debug(`Started executing action: ${actionName}`);
    } else {
      this.state.lastActionDuration = this.state.actionStartTime ? Date.now() - this.state.actionStartTime : 0;
      this.state.botMode = 'idle';
      this.logger.debug(`Finished executing action: ${actionName} (duration: ${this.state.lastActionDuration}ms)`);
    }
  }
  
  setInCombat(inCombat, target = null) {
    if (this.state.isInCombat === inCombat && this.state.combatTarget === target) {
      return;
    }
    
    this.state.isInCombat = inCombat;
    this.state.combatTarget = target;
    
    if (inCombat) {
      this.state.botMode = 'combat';
      this.logger.debug(`Entered combat with: ${target}`);
    } else {
      if (this.state.botMode === 'combat') {
        this.state.botMode = 'idle';
      }
      this.logger.debug('Exited combat');
    }
  }
  
  setInteractingWithContainer(interacting, containerType = null, position = null) {
    if (this.state.isInteractingWithContainer === interacting) {
      return;
    }
    
    this.state.isInteractingWithContainer = interacting;
    this.state.containerType = containerType;
    this.state.containerPosition = position;
    
    this.logger.debug(interacting ? 
      `Opened container: ${containerType} at ${position}` : 
      'Closed container');
  }
  
  setSystemPaused(paused, reason = null) {
    if (this.state.isSystemPaused === paused) {
      return;
    }
    
    this.state.isSystemPaused = paused;
    this.state.pauseReason = reason;
    
    if (paused) {
      this.state.botMode = 'paused';
      this.logger.debug(`System paused: ${reason}`);
    } else {
      this.state.botMode = 'idle';
      this.logger.debug('System resumed');
    }
  }
  
  // Queue state management
  setCurrentQueue(queueType, priority = 0) {
    if (this.state.currentQueue === queueType) {
      return;
    }
    
    const oldQueue = this.state.currentQueue;
    this.state.currentQueue = queueType;
    this.state.queuePriority = priority;
    
    this.logger.debug(`Queue switched from ${oldQueue} to ${queueType} (priority: ${priority})`);
  }
  
  // Watch mode management
  setWatchingPlayer(watching, playerName = null) {
    if (this.state.isWatchingPlayer === watching) {
      return;
    }
    
    this.state.isWatchingPlayer = watching;
    this.state.watchingPlayerName = playerName;
    
    if (watching) {
      this.state.botMode = 'watching';
      this.logger.debug(`Started watching player: ${playerName}`);
    } else {
      this.state.botMode = 'idle';
      this.logger.debug('Stopped watching player');
    }
  }
  
  // Health & survival state
  updateHealth(health, food) {
    const healthChanged = this.state.lastHealth !== health;
    const foodChanged = this.state.lastFood !== food;
    
    if (!healthChanged && !foodChanged) {
      return;
    }
    
    this.state.lastHealth = health;
    this.state.lastFood = food;
    
    if (healthChanged && health < this.state.lastHealth) {
      this.state.lastDamageTime = Date.now();
    }
    
    this.logger.debug(`Health: ${health}/20, Food: ${food}/20`);
  }
  
  setDead(dead, position = null, reason = null) {
    if (this.state.isDead === dead) {
      return;
    }
    
    this.state.isDead = dead;
    this.state.deathPosition = position;
    this.state.deathReason = reason;
    
    if (dead) {
      this.logger.debug(`Bot died at ${position} - Reason: ${reason}`);
    } else {
      this.state.lastRespawn = Date.now();
      this.logger.debug('Bot respawned');
    }
  }
  
  // Connection state
  setConnected(connected) {
    if (this.state.isConnected === connected) {
      return;
    }
    
    this.state.isConnected = connected;
    this.state.lastHeartbeat = connected ? Date.now() : null;
    
    this.logger.debug(connected ? 'Bot connected' : 'Bot disconnected');
  }
  
  updateConnectionStability(stability) {
    this.state.connectionStability = Math.max(0, Math.min(1, stability));
    this.state.lastHeartbeat = Date.now();
  }
  
  // Goal management
  setCurrentGoal(goal) {
    if (this.state.currentGoal === goal) {
      return;
    }
    
    this.state.currentGoal = goal;
    this.logger.debug(`Goal set: ${goal}`);
  }
  
  setCurrentHandlung(handlung, progress = 0) {
    this.state.currentHandlung = handlung;
    this.state.handlungProgress = progress;
    this.logger.debug(`Handlung: ${handlung} (${progress}% complete)`);
  }
  
  // Learning state
  updateLearningState(trigger, pendingCount) {
    this.state.lastLearningTrigger = trigger;
    this.state.learningsPendingCount = pendingCount;
  }
  
  // Performance tracking
  incrementActionCount(success = true) {
    this.state.actionsExecutedCount++;
    if (!success) {
      this.state.failedActionsCount++;
    }
  }
  
  // Status update tracking
  recordStatusUpdate() {
    this.state.lastStatusUpdate = Date.now();
  }
  
  recordEmergencyTrigger() {
    this.state.lastEmergencyTrigger = Date.now();
  }
  
  // Gebot 4: Pure getter functions
  getState() {
    return this.state.botMode;
  }
  
  getCurrentQueue() {
    return this.state.currentQueue;
  }
  
  getCurrentAction() {
    return this.state.currentAction;
  }
  
  isExecuting() {
    return this.state.isExecutingAction;
  }
  
  isInCombat() {
    return this.state.isInCombat;
  }
  
  isPaused() {
    return this.state.isSystemPaused;
  }
  
  isWatching() {
    return this.state.isWatchingPlayer;
  }
  
  isDead() {
    return this.state.isDead;
  }
  
  isConnected() {
    return this.state.isConnected;
  }
  
  getHealth() {
    return this.state.lastHealth;
  }
  
  getFood() {
    return this.state.lastFood;
  }
  
  getCurrentGoal() {
    return this.state.currentGoal;
  }
  
  getCurrentHandlung() {
    return {
      handlung: this.state.currentHandlung,
      progress: this.state.handlungProgress
    };
  }
  
  getDeathInfo() {
    return {
      position: this.state.deathPosition,
      reason: this.state.deathReason
    };
  }
  
  getPerformanceMetrics() {
    return {
      actionsExecuted: this.state.actionsExecutedCount,
      actionsFailed: this.state.failedActionsCount,
      successRate: this.state.actionsExecutedCount > 0 ? 
        (this.state.actionsExecutedCount - this.state.failedActionsCount) / this.state.actionsExecutedCount : 0,
      lastActionDuration: this.state.lastActionDuration,
      uptime: Date.now() - this.state.botStartTime
    };
  }
  
  getTimestamps() {
    return {
      botStart: this.state.botStartTime,
      lastStatusUpdate: this.state.lastStatusUpdate,
      lastEmergency: this.state.lastEmergencyTrigger,
      lastRespawn: this.state.lastRespawn,
      lastDamage: this.state.lastDamageTime,
      lastHeartbeat: this.state.lastHeartbeat
    };
  }
  
  // Full state snapshot (for debugging/logging)
  getFullState() {
    // Return a copy to prevent external mutation
    return JSON.parse(JSON.stringify(this.state));
  }
  
  // Reset specific states
  resetCombatState() {
    this.setInCombat(false);
    this.state.combatTarget = null;
    this.state.lastDamageTime = null;
  }
  
  resetExecutionState() {
    this.setExecutingAction(false);
    this.state.currentAction = null;
    this.state.actionStartTime = null;
  }
  
  resetGoals() {
    this.state.currentGoal = null;
    this.state.currentHandlung = null;
    this.state.handlungProgress = 0;
    this.logger.debug('Goals reset');
  }
  updateNetworkMetrics(latency) {
    this.networkMetrics.lastLatency = latency;
    this.networkMetrics.lastPingTime = Date.now();
    this.networkMetrics.connectionStability = Math.min(1.0, Math.max(0, 1 - (latency / 1000)));
  }

  getNetworkMetrics() {
    return {
      latency: this.networkMetrics.lastLatency,
      stability: this.networkMetrics.connectionStability
    };
  }

  // Gebot 1: No persistence - this is runtime state only
  // Gebot 5: No dependencies except logger
  // Gebot 6: Simple atomic operations
}

export default BotStateManager;
