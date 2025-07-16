/**
 * RespawnQueue.js - Logische, risikobewusste Wiederherstellungsmission
 * "Analyse vor Aktion"
 * Entscheidet rational zwischen Item-Recovery, Base-Return oder Fresh-Start.
 */

import statemachine from 'mineflayer-statemachine';
const { createMachine, interpret } = statemachine;
import winston from 'winston';
import ErrorRecovery from '../Utils/ErrorRecovery.js';
import { Vec3 } from 'vec3';

class RespawnQueue {
  constructor(bot, botStateManager, ollamaInterface, aiResponseParser, botActions, learningManager, deathContext) {
    this.bot = bot;
    this.botStateManager = botStateManager;
    this.ollamaInterface = ollamaInterface;
    this.aiResponseParser = aiResponseParser;
    this.botActions = botActions;
    this.learningManager = learningManager;
    
    // Gebot 1: Todeskontext
    this.deathContext = deathContext; // { deathLocation: Vec3, deathReason: string }
    this.respawnLocation = bot.entity.position.clone();
    
    // Mission state
    this.missionType = null; // 'item_recovery' | 'base_return' | 'fresh_start'
    this.missionStrategy = null;
    this.currentActionQueue = [];
    this.currentActionIndex = 0;
    
    // Execution state
    this.isExecuting = false;
    this.missionStartTime = null;
    this.stateMachine = null;
    this.stateMachineService = null;
    
    // Known locations
    this.knownBase = null;
    this.lastSafeLocation = null;
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [RespawnQueue] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });

    // Initialize error recovery helper
    this.errorRecovery = new ErrorRecovery(this.bot, this.learningManager, this.logger);
  }
  
  /**
   * Start respawn analysis and mission
   */
  async start() {
    this.logger.info(`Starting respawn analysis - Death at ${this.deathContext.deathLocation}, Reason: ${this.deathContext.deathReason}`);
    this.isExecuting = true;
    this.missionStartTime = Date.now();
    
    // Update bot state
    this.botStateManager.setCurrentQueue('respawn', 2);
    
    // Gebot 3: Load known locations
    await this.loadKnownLocations();
    
    // Gebot 2: First action is LLM analysis
    await this.requestRespawnStrategy();
    
    // Execute chosen mission
    if (this.currentActionQueue.length > 0) {
      await this.executeMission();
    } else {
      this.logger.error('No mission plan generated');
      this.complete(false);
    }
  }
  
  /**
   * Gebot 3: Load known safe locations
   */
  async loadKnownLocations() {
    try {
      // Get base location from learnings
      const baseLocationLearning = await this.learningManager.getSpecificLearning(
        'standard',
        'blockinteraktion',
        'base_location'
      );
      
      if (baseLocationLearning && baseLocationLearning.context && baseLocationLearning.context.position) {
        this.knownBase = new Vec3(
          baseLocationLearning.context.position.x,
          baseLocationLearning.context.position.y,
          baseLocationLearning.context.position.z
        );
        this.logger.info(`Known base location: ${this.knownBase}`);
      }
      
      // Get last safe location
      const safeLearning = await this.learningManager.getSpecificLearning(
        'standard',
        'survival',
        'last_safe_location'
      );
      
      if (safeLearning && safeLearning.context && safeLearning.context.position) {
        this.lastSafeLocation = new Vec3(
          safeLearning.context.position.x,
          safeLearning.context.position.y,
          safeLearning.context.position.z
        );
      }
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.warn(`Failed to load known locations: ${error.message}`);
    }
  }
  
  /**
   * Gebot 2: Request strategy from LLM
   */
  async requestRespawnStrategy() {
    try {
      this.logger.info('Requesting respawn strategy from LLM');
      
      // Calculate distances
      const distanceToDeathPoint = this.respawnLocation.distanceTo(this.deathContext.deathLocation);
      const distanceToBase = this.knownBase ? this.respawnLocation.distanceTo(this.knownBase) : null;
      
      // Get previous respawn failures
      const respawnFailures = await this.learningManager.getRelevantLearnings(
        'respawn',
        'survival',
        3
      );
      
      // Build context
      const context = {
        deathLocation: {
          x: Math.floor(this.deathContext.deathLocation.x),
          y: Math.floor(this.deathContext.deathLocation.y),
          z: Math.floor(this.deathContext.deathLocation.z)
        },
        deathReason: this.deathContext.deathReason,
        lostInventory: this.deathContext.lostInventory || 'Unknown items',
        distanceToDeathPoint: Math.round(distanceToDeathPoint),
        timeSinceDeath: 0, // Just respawned
        currentInventory: this.getCurrentInventory(),
        knownBase: this.knownBase ? {
          position: this.knownBase,
          distance: Math.round(distanceToBase)
        } : null,
        previousFailures: respawnFailures
      };
      
      // Request strategy
      const llmResponse = await this.ollamaInterface.planRespawn(context);
      
      // Parse response
      const parsedResponse = this.aiResponseParser.parseRespawnResponse(
        llmResponse,
        this.bot,
        this.botStateManager
      );
      
      // Set mission based on strategy
      this.setMissionFromStrategy(parsedResponse);
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Failed to get respawn strategy: ${error.message}`);
      
      // Default to fresh start on error
      this.setDefaultMission();
    }
  }
  
  /**
   * Set mission from LLM strategy
   */
  setMissionFromStrategy(parsedResponse) {
    this.missionType = parsedResponse.strategy;
    this.missionStrategy = parsedResponse.riskAssessment;
    this.currentActionQueue = parsedResponse.validatedActions;
    
    this.logger.info(`Mission selected: ${this.missionType}`);
    this.logger.info(`Risk assessment: ${JSON.stringify(this.missionStrategy)}`);
    
    // Record the decision as learning
    if (parsedResponse.learnings && parsedResponse.learnings.length > 0) {
      parsedResponse.learnings.forEach(learning => {
        this.learningManager.addLearning('respawn', learning);
      });
    }
    
    // Update bot state with mission
    this.botStateManager.setCurrentGoal(`Respawn mission: ${this.missionType}`);
  }
  
  /**
   * Set default fresh start mission
   */
  setDefaultMission() {
    this.missionType = 'fresh_start';
    this.missionStrategy = {
      itemValue: 'unknown',
      retrievalRisk: 'high',
      recommendation: 'fresh_start'
    };
    
    // Basic fresh start actions
    this.currentActionQueue = [
      {
        actionName: 'findBlock',
        parameters: {
          blockName: 'oak_log',
          maxDistance: 32
        },
        successCriteria: 'Found wood',
        timeoutMs: 10000,
        fallbackAction: 'explore'
      },
      {
        actionName: 'collectBlock',
        parameters: {
          blockName: 'oak_log',
          count: 10
        },
        successCriteria: 'Collected wood',
        timeoutMs: 60000,
        fallbackAction: null
      }
    ];
    
    this.logger.info('Defaulting to fresh start mission');
  }
  
  /**
   * Gebot 5: Execute mission using state machine
   */
  async executeMission() {
    this.logger.info(`Executing ${this.missionType} mission with ${this.currentActionQueue.length} actions`);
    
    // Create state machine
    this.createMissionStateMachine();
    
    // Start execution
    this.stateMachineService = interpret(this.stateMachine);
    
    this.stateMachineService.onTransition((state) => {
      this.logger.debug(`Mission state: ${state.value}`);
    });
    
    this.stateMachineService.start();
  }
  
  /**
   * Create mission state machine
   */
  createMissionStateMachine() {
    const states = {
      idle: {
        on: {
          START: 'checkMission'
        }
      },
      checkMission: {
        onEntry: () => this.checkMissionStatus(),
        on: {
          CONTINUE: 'executeAction',
          COMPLETE: 'complete',
          ABORT: 'abort'
        }
      },
      executeAction: {
        onEntry: () => this.executeCurrentAction(),
        on: {
          SUCCESS: 'checkMission',
          FAILURE: 'handleFailure'
        }
      },
      handleFailure: {
        onEntry: () => this.handleActionFailure(),
        on: {
          RETRY: 'executeAction',
          NEXT: 'checkMission',
          ABORT: 'abort'
        }
      },
      abort: {
        onEntry: () => this.handleMissionAbort()
      },
      complete: {
        onEntry: () => this.complete(true)
      }
    };
    
    this.stateMachine = createMachine({
      id: 'respawnMission',
      initial: 'idle',
      states: states
    });
  }
  
  /**
   * Check mission progress
   */
  checkMissionStatus() {
    // Check if mission should be aborted
    if (this.shouldAbortMission()) {
      this.stateMachineService.send('ABORT');
      return;
    }
    
    // Check if more actions
    if (this.currentActionIndex >= this.currentActionQueue.length) {
      this.stateMachineService.send('COMPLETE');
      return;
    }
    
    this.stateMachineService.send('CONTINUE');
  }
  
  /**
   * Gebot 4: Check if mission should be aborted
   */
  shouldAbortMission() {
    // Item recovery specific checks
    if (this.missionType === 'item_recovery') {
      // Check time limit (5 minutes for item despawn)
      const elapsed = (Date.now() - this.missionStartTime) / 1000;
      if (elapsed > 300) {
        this.logger.warn('Item recovery timeout - items likely despawned');
        return true;
      }
      
      // Check if we're taking damage
      if (this.bot.health < 15) {
        this.logger.warn('Taking damage during recovery - aborting');
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Execute current mission action
   */
  async executeCurrentAction() {
    const action = this.currentActionQueue[this.currentActionIndex];
    
    this.logger.info(`Mission action ${this.currentActionIndex + 1}/${this.currentActionQueue.length}: ${action.actionName}`);
    this.botStateManager.setExecutingAction(true, `RESPAWN:${action.actionName}`);
    
    try {
      const actionFunction = this.botActions[action.actionName];
      if (!actionFunction) {
        throw new Error(`Unknown action: ${action.actionName}`);
      }
      
      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Action timeout')), action.timeoutMs);
      });
      
      const result = await Promise.race([
        actionFunction(this.bot, action.parameters),
        timeoutPromise
      ]);
      
      this.logger.info(`Action succeeded: ${action.actionName}`);
      this.botStateManager.setExecutingAction(false);
      this.botStateManager.incrementActionCount(true);
      
      this.currentActionIndex++;
      this.stateMachineService.send('SUCCESS');
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Action failed: ${error.message}`);
      this.botStateManager.setExecutingAction(false);
      this.botStateManager.incrementActionCount(false);
      
      this.lastError = error;
      this.stateMachineService.send('FAILURE');
    }
  }
  
  /**
   * Handle action failure
   */
  async handleActionFailure() {
    const failedAction = this.currentActionQueue[this.currentActionIndex];
    
    // Try fallback if available
    if (failedAction.fallbackAction) {
      this.logger.info(`Trying fallback: ${failedAction.fallbackAction}`);
      
      // Replace with fallback
      this.currentActionQueue[this.currentActionIndex] = {
        actionName: failedAction.fallbackAction,
        parameters: {},
        successCriteria: 'Fallback completed',
        timeoutMs: 30000,
        fallbackAction: null
      };
      
      this.stateMachineService.send('RETRY');
    } else {
      // Skip to next action
      this.currentActionIndex++;
      this.stateMachineService.send('NEXT');
    }
  }
  
  /**
   * Gebot 7: Handle mission abort
   */
  async handleMissionAbort() {
    this.logger.warn('Mission aborted');
    
    // Record failure learning
    const learning = {
      category: 'survival',
      learningType: 'antiAction',
      content: `Failed ${this.missionType} mission: ${this.lastError ? this.lastError.message : 'Unknown reason'}`,
      confidence: 0.8,
      context: {
        missionType: this.missionType,
        deathLocation: this.deathContext.deathLocation,
        deathReason: this.deathContext.deathReason,
        failurePoint: this.currentActionIndex
      }
    };
    
    await this.learningManager.addLearning('respawn', learning);
    
    // Complete with failure
    this.complete(false);
  }
  
  /**
   * Gebot 6: Complete mission and signal new beginning
   */
  complete(success) {
    const duration = Date.now() - this.missionStartTime;
    this.logger.info(`Respawn mission complete - Success: ${success}, Duration: ${duration}ms`);
    
    this.isExecuting = false;
    
    if (this.stateMachineService) {
      this.stateMachineService.stop();
    }
    
    // Record successful recovery
    if (success && this.missionType === 'item_recovery') {
      const learning = {
        category: 'survival',
        learningType: 'actionLearning',
        content: `Successfully recovered items from death location`,
        confidence: 0.9,
        context: {
          deathLocation: this.deathContext.deathLocation,
          strategy: this.missionStrategy,
          duration: duration
        }
      };
      
      this.learningManager.addLearning('respawn', learning);
    }
    
    // Update current position as safe if successful
    if (success && this.bot.entity) {
      const safeLearning = {
        category: 'survival',
        learningType: 'handlungsLearning',
        content: 'last_safe_location',
        confidence: 0.7,
        context: {
          position: this.bot.entity.position
        }
      };
      
      this.learningManager.addLearning('standard', safeLearning);
    }
    
    // Signal completion
    this.onComplete(success);
  }
  
  /**
   * Callback for completion (set by QueueManager)
   */
  onComplete(success) {
    // This will be set by QueueManager to transition to StandardQueue
    this.logger.info('Respawn mission ended, ready for standard operations');
  }
  
  /**
   * Stop respawn queue
   */
  stop() {
    this.logger.info('Respawn queue stopped');
    this.isExecuting = false;
    
    if (this.stateMachineService) {
      this.stateMachineService.stop();
    }
  }
  
  /**
   * Get current inventory summary
   */
  getCurrentInventory() {
    const items = this.bot.inventory.items();
    return items.map(item => ({
      name: item.name,
      count: item.count
    }));
  }
  
  /**
   * Get mission status
   */
  getStatus() {
    return {
      isExecuting: this.isExecuting,
      missionType: this.missionType,
      currentActionIndex: this.currentActionIndex,
      totalActions: this.currentActionQueue.length,
      duration: this.missionStartTime ? Date.now() - this.missionStartTime : 0,
      deathLocation: this.deathContext.deathLocation,
      strategy: this.missionStrategy
    };
  }
  getAverageProcessingTime() {
    if (this.actionResults.length === 0) return 0;
    const totalTime = this.actionResults.reduce((sum, result) => sum + (result.duration || 0), 0);
    return Math.round(totalTime / this.actionResults.length);
  }

  getSuccessRate() {
    if (this.actionResults.length === 0) return 0;
    const successful = this.actionResults.filter(r => r.success).length;
    return successful / this.actionResults.length;
  }
}

export default RespawnQueue;