/**
 * StandardQueue.js - Hierarchischer, LLM-gesteuerter Plan-Exekutor
 * "Orchestrator, nicht Denker"
 * Implementiert die Dreifaltigkeit: Ziel → Handlung → Aktion
 */

import { createMachine, interpret, State } from 'mineflayer-statemachine';
import winston from 'winston';
import ErrorRecovery from '../Utils/ErrorRecovery.js';

class StandardQueue {
  constructor(bot, botStateManager, ollamaInterface, aiResponseParser, botActions, learningManager) {
    this.bot = bot;
    this.botStateManager = botStateManager;
    this.ollamaInterface = ollamaInterface;
    this.aiResponseParser = aiResponseParser;
    this.botActions = botActions;
    this.learningManager = learningManager;
    
    // Gebot 1: Die Dreifaltigkeit
    this.currentGoal = null;
    this.currentPlan = []; // Array of Handlungen
    this.currentHandlung = null;
    this.currentActionQueue = [];
    this.currentActionIndex = 0;
    
    // Execution state
    this.isExecuting = false;
    this.isPaused = false;
    this.stateMachine = null;
    this.stateMachineService = null;
    
    // Performance tracking
    this.queueStartTime = null;
    this.actionResults = [];
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [StandardQueue] ${level}: ${message}`;
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
   * Start the queue processing
   */
  async start() {
    if (this.isExecuting) {
      this.logger.warn('StandardQueue already executing');
      return;
    }
    
    this.logger.info('Starting StandardQueue processing');
    this.isExecuting = true;
    this.isPaused = false;
    this.botStateManager.setCurrentQueue('standard', 3);
    
    // Begin the planning cycle
    await this.requestNewPlan();
  }
  
  /**
   * Gebot 5: Pause execution
   */
  pause() {
    if (!this.isExecuting || this.isPaused) {
      return;
    }
    
    this.logger.info('Pausing StandardQueue execution');
    this.isPaused = true;
    
    // Stop state machine if running
    if (this.stateMachineService) {
      this.stateMachineService.stop();
    }
  }
  
  /**
   * Gebot 5: Resume execution
   */
  async resume() {
    if (!this.isExecuting || !this.isPaused) {
      return;
    }
    
    this.logger.info('Resuming StandardQueue execution');
    this.isPaused = false;
    
    // Resume where we left off
    if (this.currentActionQueue.length > 0) {
      await this.executeActionQueue();
    } else {
      await this.requestNewPlan();
    }
  }
  
  /**
   * Stop the queue completely
   */
  stop() {
    this.logger.info('Stopping StandardQueue');
    this.isExecuting = false;
    this.isPaused = false;
    
    if (this.stateMachineService) {
      this.stateMachineService.stop();
    }
    
    // Clear state
    this.currentGoal = null;
    this.currentPlan = [];
    this.currentHandlung = null;
    this.currentActionQueue = [];
    this.currentActionIndex = 0;
    
    this.botStateManager.setCurrentQueue(null, 0);
  }
  
  /**
   * Gebot 2: Request new plan from LLM
   */
  async requestNewPlan() {
    try {
      this.logger.info('Requesting new plan from LLM');
      
      // Gebot 3: Gather relevant learnings
      const relevantLearnings = await this.gatherRelevantLearnings();
      
      // Build context for LLM
      const context = {
        botStatus: this.getBotStatus(),
        availableActions: this.getAvailableActions(),
        recentLearnings: relevantLearnings,
        gameTime: this.bot.time.timeOfDay,
        weather: {
          isRaining: this.bot.isRaining,
          thunderState: this.bot.thunderState
        },
        dimension: this.bot.game.dimension,
        previousGoals: this.currentGoal ? [this.currentGoal] : [],
        failedAttempts: this.getRecentFailures(),
        successPatterns: await this.learningManager.getTopLearnings('actionLearning', 3)
      };
      
      // Request plan from LLM
      const llmResponse = await this.ollamaInterface.askForStatusUpdate(context);
      
      // Validate and parse response
      const parsedResponse = this.aiResponseParser.parseAndValidate(
        llmResponse,
        this.bot,
        this.botStateManager
      );
      
      // Update state with new plan
      this.updatePlanFromLLM(parsedResponse);
      
      // Start execution if not paused
      if (!this.isPaused) {
        await this.executeActionQueue();
      }
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Failed to get plan from LLM: ${error.message}`);
      
      // Gebot 4: Learn from planning failure
      await this.recordPlanningFailure(error);
      
      // Retry after delay
      setTimeout(() => {
        if (this.isExecuting && !this.isPaused) {
          this.requestNewPlan();
        }
      }, 5000);
    }
  }
  
  /**
   * Gebot 3: Gather relevant learnings for context
   */
  async gatherRelevantLearnings() {
    const categories = this.determineRelevantCategories();
    const learnings = [];
    
    for (const category of categories) {
      const categoryLearnings = await this.learningManager.getRelevantLearnings(
        'standard',
        category,
        5
      );
      learnings.push(...categoryLearnings);
    }
    
    return learnings;
  }
  
  /**
   * Determine which learning categories are relevant
   */
  determineRelevantCategories() {
    const categories = new Set(['survival']); // Always relevant
    
    // Add categories based on current state
    if (this.bot.food < 15) {
      categories.add('inventar');
      categories.add('crafting');
    }
    
    if (this.bot.time.isDay) {
      categories.add('blockinteraktion');
      categories.add('moving');
    } else {
      categories.add('fight');
    }
    
    return Array.from(categories);
  }
  
  /**
   * Update internal state from LLM response
   */
  updatePlanFromLLM(parsedResponse) {
    // Update goals
    if (parsedResponse.goals.length > 0) {
      this.currentGoal = parsedResponse.goals[0]; // Highest priority goal
      this.botStateManager.setCurrentGoal(this.currentGoal.goalDescription);
    }
    
    // Set action queue
    this.currentActionQueue = parsedResponse.validatedActions;
    this.currentActionIndex = 0;
    
    // Record learnings
    if (parsedResponse.learnings.length > 0) {
      parsedResponse.learnings.forEach(learning => {
        this.learningManager.addLearning('standard', learning);
      });
    }
    
    this.logger.info(`New plan set: ${this.currentActionQueue.length} actions for goal: ${this.currentGoal?.goalDescription}`);
  }
  
  /**
   * Gebot 6: Execute action queue using state machine
   */
  async executeActionQueue() {
    if (this.currentActionQueue.length === 0) {
      this.logger.info('Action queue empty, requesting new plan');
      await this.requestNewPlan();
      return;
    }
    
    this.queueStartTime = Date.now();
    this.actionResults = [];
    
    // Create state machine for action execution
    this.createActionStateMachine();
    
    // Start execution
    this.stateMachineService = interpret(this.stateMachine);
    
    this.stateMachineService.onTransition((state) => {
      this.logger.debug(`State transition: ${state.value}`);
    });
    
    this.stateMachineService.start();
  }
  
  /**
   * Create state machine for action execution
   */
  createActionStateMachine() {
    const states = {
      idle: {
        on: {
          START: 'checkPause'
        }
      },
      checkPause: {
        onEntry: () => this.checkPauseState(),
        on: {
          CONTINUE: 'executeAction',
          PAUSED: 'paused',
          COMPLETE: 'complete'
        }
      },
      executeAction: {
        onEntry: () => this.executeCurrentAction(),
        on: {
          SUCCESS: 'checkPause',
          FAILURE: 'handleFailure'
        }
      },
      handleFailure: {
        onEntry: () => this.handleActionFailure(),
        on: {
          RETRY: 'checkPause',
          ABORT: 'complete'
        }
      },
      paused: {
        on: {
          RESUME: 'checkPause'
        }
      },
      complete: {
        onEntry: () => this.handleQueueComplete()
      }
    };
    
    this.stateMachine = createMachine({
      id: 'standardQueueExecution',
      initial: 'idle',
      states: states
    });
  }
  
  /**
   * Check if execution should be paused
   */
  checkPauseState() {
    if (this.isPaused || this.botStateManager.isPaused()) {
      this.stateMachineService.send('PAUSED');
      return;
    }
    
    if (this.currentActionIndex >= this.currentActionQueue.length) {
      this.stateMachineService.send('COMPLETE');
      return;
    }
    
    this.stateMachineService.send('CONTINUE');
  }
  
  /**
   * Execute the current action
   */
  async executeCurrentAction() {
    const action = this.currentActionQueue[this.currentActionIndex];
    
    this.logger.info(`Executing action ${this.currentActionIndex + 1}/${this.currentActionQueue.length}: ${action.actionName}`);
    this.botStateManager.setExecutingAction(true, action.actionName);
    
    try {
      // Gebot 4: Execute with error handling
      const actionFunction = this.botActions[action.actionName];
      if (!actionFunction) {
        throw new Error(`Unknown action: ${action.actionName}`);
      }
      
      // Set timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Action timeout')), action.timeoutMs);
      });
      
      // Execute action
      const result = await Promise.race([
        actionFunction(this.bot, action.parameters),
        timeoutPromise
      ]);
      
      // Record success
      this.actionResults.push({
        action: action.actionName,
        success: true,
        result: result,
        duration: Date.now() - this.queueStartTime
      });
      
      this.botStateManager.setExecutingAction(false);
      this.botStateManager.incrementActionCount(true);
      
      this.currentActionIndex++;
      this.stateMachineService.send('SUCCESS');
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Action failed: ${error.message}`);
      
      this.actionResults.push({
        action: action.actionName,
        success: false,
        error: error.message,
        duration: Date.now() - this.queueStartTime
      });
      
      this.botStateManager.setExecutingAction(false);
      this.botStateManager.incrementActionCount(false);
      
      this.lastError = {
        action: action,
        error: error,
        context: this.getBotStatus()
      };
      
      this.stateMachineService.send('FAILURE');
    }
  }
  
  /**
   * Gebot 4: Handle action failure
   */
  async handleActionFailure() {
    const failedAction = this.currentActionQueue[this.currentActionIndex];
    
    // Create anti-learning
    const antiLearning = {
      category: this.determineActionCategory(failedAction.actionName),
      learningType: 'antiAction',
      content: `Failed to ${failedAction.actionName}: ${this.lastError.error.message}`,
      confidence: 0.8,
      context: {
        action: failedAction,
        error: this.lastError.error.message,
        botStatus: this.lastError.context
      }
    };
    
    await this.learningManager.addLearning('standard', antiLearning);
    
    // Check if we should retry with fallback
    if (failedAction.fallbackAction) {
      this.logger.info(`Trying fallback action: ${failedAction.fallbackAction}`);
      
      // Replace current action with fallback
      this.currentActionQueue[this.currentActionIndex] = {
        actionName: failedAction.fallbackAction,
        parameters: {},
        successCriteria: 'Fallback action completed',
        timeoutMs: 30000,
        fallbackAction: null
      };
      
      this.stateMachineService.send('RETRY');
    } else {
      // Abort queue and request new plan
      this.logger.warn('No fallback available, aborting queue');
      this.stateMachineService.send('ABORT');
    }
  }
  
  /**
   * Gebot 7: Handle successful queue completion
   */
  async handleQueueComplete() {
    this.logger.info('Action queue completed');
    
    // Check if handlung was successful
    const success = this.actionResults.filter(r => r.success).length > 
                   this.actionResults.filter(r => !r.success).length;
    
    if (success) {
      // Generate positive learnings
      await this.generateSuccessLearnings();
    }
    
    // Clear current queue
    this.currentActionQueue = [];
    this.currentActionIndex = 0;
    
    // Update handlung progress
    if (this.currentHandlung) {
      this.botStateManager.setCurrentHandlung(
        this.currentHandlung,
        success ? 100 : 50
      );
    }
    
    // Request next plan
    if (this.isExecuting && !this.isPaused) {
      await this.requestNewPlan();
    }
  }
  
  /**
   * Generate learnings from successful execution
   */
  async generateSuccessLearnings() {
    try {
      const context = {
        completedActions: this.actionResults,
        result: 'success',
        initialGoal: this.currentGoal,
        finalState: this.getBotStatus(),
        executionTime: Date.now() - this.queueStartTime
      };
      
      const llmResponse = await this.ollamaInterface.extractLearning(context);
      const parsedLearnings = this.aiResponseParser.parseChatTipResponse(llmResponse);
      
      // Store learnings
      for (const learning of parsedLearnings.learnings) {
        await this.learningManager.addLearning('standard', learning);
      }
      
      this.logger.info(`Generated ${parsedLearnings.learnings.length} success learnings`);
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Failed to generate success learnings: ${error.message}`);
    }
  }
  
  /**
   * Record planning failure for learning
   */
  async recordPlanningFailure(error) {
    const learning = {
      category: 'survival',
      learningType: 'antiAction',
      content: `Planning failed: ${error.message}`,
      confidence: 0.7,
      context: {
        error: error.message,
        botStatus: this.getBotStatus()
      }
    };
    
    await this.learningManager.addLearning('standard', learning);
  }
  
  /**
   * Get current bot status for context
   */
  getBotStatus() {
    return {
      health: this.bot.health,
      food: this.bot.food,
      position: this.bot.entity.position,
      inventory: this.bot.inventory.items().map(item => ({
        name: item.name,
        count: item.count
      })),
      equippedItem: this.bot.heldItem ? {
        name: this.bot.heldItem.name,
        count: this.bot.heldItem.count
      } : null,
      nearbyEntities: Object.values(this.bot.entities)
        .filter(e => e.position && e.position.distanceTo(this.bot.entity.position) < 16)
        .map(e => ({
          type: e.type,
          name: e.name || e.type,
          distance: e.position.distanceTo(this.bot.entity.position)
        }))
        .slice(0, 5),
      timeOfDay: this.bot.time.timeOfDay,
      dimension: this.bot.game.dimension
    };
  }
  
  /**
   * Get available actions reference
   */
  getAvailableActions() {
    // This would be loaded from availableActions.json
    return Object.keys(this.botActions);
  }
  
  /**
   * Get recent failures for context
   */
  getRecentFailures() {
    return this.actionResults
      .filter(r => !r.success)
      .slice(-5)
      .map(r => ({
        action: r.action,
        error: r.error
      }));
  }
  
  /**
   * Determine action category
   */
  determineActionCategory(actionName) {
    const categoryMap = {
      goTo: 'moving',
      digBlock: 'blockinteraktion',
      placeBlock: 'blockinteraktion',
      craft: 'crafting',
      attack: 'fight',
      flee: 'fight',
      consumeItem: 'survival',
      equipItem: 'inventar'
    };
    
    return categoryMap[actionName] || 'survival';
  }
  
  /**
   * Get queue status
   */
  getStatus() {
    return {
      isExecuting: this.isExecuting,
      isPaused: this.isPaused,
      currentGoal: this.currentGoal,
      currentActionIndex: this.currentActionIndex,
      totalActions: this.currentActionQueue.length,
      completedActions: this.actionResults.length,
      successRate: this.actionResults.length > 0 ?
        this.actionResults.filter(r => r.success).length / this.actionResults.length : 0
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

export default StandardQueue;