/**
* StandardQueue.js - Hierarchischer, LLM-gesteuerter Plan-Exekutor
* "Orchestrator, nicht Denker"
* Implementiert die Dreifaltigkeit: Ziel → Handlung → Aktion
*/

import mineflayerStatemachine from 'mineflayer-statemachine';
const { NestedStateMachine, StateTransition, BehaviorIdle } = mineflayerStatemachine;
import winston from 'winston';
import ErrorRecovery from '../Utils/ErrorRecovery.js';

/**
* Helper class for executing a single action as a behavior
*/
class BehaviorExecuteAction extends BehaviorIdle {
  constructor(parentQueue, action) {
      super();
      this.parentQueue = parentQueue;
      this.action = action;
      this.isFinished = false;
  }

  async onStateEntered() {
      try {
          await this.parentQueue.executeSingleAction(this.action);
      } catch (error) {
          // Der Fehler wird bereits in executeSingleAction behandelt.
      } finally {
          this.isFinished = true; // Signalisiert, dass dieser State beendet ist.
      }
  }
}

class StandardQueue {
constructor(bot, botStateManager, ollamaInterface, aiResponseParser, botActions, learningManager, logger) {
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
  
  // Performance tracking
  this.queueStartTime = null;
  this.actionResults = [];
  
  // Setup logger
  this.logger = logger || winston.createLogger({
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
 * REGEL 1: start() ist der Initiator
 * Start the queue processing - called once by QueueManager
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
  
  // Begin the first planning cycle
  await this.requestNewPlan();
  
  // After getting the plan, execute it
  if (this.currentActionQueue.length > 0 && !this.isPaused) {
    await this.executeActionQueue();
  }
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
  
  // Clear current state machine
  if (this.bot.stateMachine) {
    this.bot.stateMachine.states = [];
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
    // If no actions in queue, request new plan
    await this.requestNewPlan();
    if (this.currentActionQueue.length > 0) {
      await this.executeActionQueue();
    }
  }
}

/**
 * Stop the queue completely
 */
stop() {
  this.logger.info('Stopping StandardQueue');
  this.isExecuting = false;
  this.isPaused = false;
  
  // Clear state machine
  if (this.bot.stateMachine) {
    this.bot.stateMachine.states = [];
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
 * REGEL 2: requestNewPlan() ist der reine Planer
 * Request new plan from LLM - ONLY gets and validates plan, does NOT execute
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
    
  } catch (error) {
    await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
    this.logger.error(`Failed to get plan from LLM: ${error.message}`);
    
    // Gebot 4: Learn from planning failure
    await this.recordPlanningFailure(error);
    
    // REGEL: No recursive retry - just return control
    // The next status_update event will trigger a new attempt
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
 * REGEL 3: executeActionQueue() ist der reine Arbeiter
 * Execute action queue using state machine - ONLY executes, does NOT request new plans
 */
async executeActionQueue() {
  if (this.currentActionQueue.length === 0) {
    this.logger.warn('No actions to execute');
    return;
  }
  
  this.queueStartTime = Date.now();
  this.actionResults = [];
  
  // Create states for each action
  const states = [];
  for (let i = 0; i < this.currentActionQueue.length; i++) {
    const action = this.currentActionQueue[i];
    states.push(new BehaviorExecuteAction(this, action));
  }
  
  // Create transitions between states
  const transitions = [];
  for (let i = 0; i < states.length - 1; i++) {
    transitions.push(
      new StateTransition({
        parent: states[i],
        child: states[i + 1],
        shouldTransition: () => states[i].isFinished
      })
    );
  }
  
  // Final transition to complete
  if (states.length > 0) {
    const finalState = states[states.length - 1];
    const completeTransition = new StateTransition({
      parent: finalState,
      child: new BehaviorIdle(),
      shouldTransition: () => finalState.isFinished,
      onTransitionFinished: () => this.handleQueueComplete()
    });
    transitions.push(completeTransition);
  }
  
  // Create root machine
  const rootMachine = new NestedStateMachine(transitions, states[0]);
  
  // Activate the state machine
  this.bot.stateMachine.states = [rootMachine];
}

/**
 * Execute a single action
 */
async executeSingleAction(action) {
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
    
  } catch (error) {
    await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "action_execution" });
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
    
    // Handle failure
    await this.handleActionFailure(action);
    
    // Re-throw to signal BehaviorExecuteAction
    throw error;
  }
}

/**
 * Gebot 4: Handle action failure
 */
async handleActionFailure(failedAction) {
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
  
  // Check if we should try fallback
  if (failedAction.fallbackAction) {
    this.logger.info(`Fallback action available: ${failedAction.fallbackAction}`);
  }
}

/**
 * REGEL 4: handleQueueComplete() ist der Motor des Zyklus
 * Handle successful queue completion - ONLY place that starts new cycle
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
  
  // REGEL: This is the ONLY place that restarts the cycle
  if (this.isExecuting && !this.isPaused) {
    // Request next plan
    await this.requestNewPlan();
    
    // Execute the new plan if we got one
    if (this.currentActionQueue.length > 0) {
      await this.executeActionQueue();
    }
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
    await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "learning_generation" });
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