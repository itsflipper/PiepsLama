/**
 * EmergencyQueue.js - Schneller, rücksichtsloser, temporärer Diktator
 * "Überleben um jeden Preis"
 * Minimale Latenz, maximale Autorität, temporäre Kontrolle.
 */

import { createMachine, interpret } from 'mineflayer-statemachine';
import winston from 'winston';

class EmergencyQueue {
  constructor(bot, botStateManager, ollamaInterface, aiResponseParser, botActions, learningManager, emergencyContext) {
    this.bot = bot;
    this.botStateManager = botStateManager;
    this.ollamaInterface = ollamaInterface;
    this.aiResponseParser = aiResponseParser;
    this.botActions = botActions;
    this.learningManager = learningManager;
    
    // Gebot 1: Spezifischer Notfall-Kontext
    this.emergencyContext = emergencyContext; // { type: 'damage'|'hunger', source: string, severity: number }
    
    // Simplified state (Gebot 5)
    this.currentActionQueue = [];
    this.currentActionIndex = 0;
    this.isExecuting = false;
    this.emergencyStartTime = null;
    
    // State machine
    this.stateMachine = null;
    this.stateMachineService = null;
    
    // Gebot 6: Lauter Alarm
    this.logger = winston.createLogger({
      level: 'warn',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [EMERGENCY] ${level.toUpperCase()}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: 'warn'
        })
      ]
    });
  }
  
  /**
   * Start emergency response
   */
  async start() {
    this.logger.error(`EMERGENCY ACTIVATED: Type=${this.emergencyContext.type}, Source=${this.emergencyContext.source}`);
    this.emergencyStartTime = Date.now();
    this.isExecuting = true;
    
    // Update bot state
    this.botStateManager.setCurrentQueue('emergency', 1);
    this.botStateManager.recordEmergencyTrigger();
    
    // Gebot 2: Immediate reflex action
    await this.executeImmediateReflex();
    
    // Then request plan from LLM if needed
    if (this.needsLLMPlan()) {
      await this.requestEmergencyPlan();
    }
    
    // Execute action queue
    await this.executeActionQueue();
  }
  
  /**
   * Gebot 2: Execute immediate hardcoded reflex
   */
  async executeImmediateReflex() {
    this.logger.warn(`Executing immediate reflex for ${this.emergencyContext.type}`);
    
    switch (this.emergencyContext.type) {
      case 'damage':
        await this.executeDamageReflex();
        break;
      
      case 'hunger':
        await this.executeHungerReflex();
        break;
      
      default:
        this.logger.error(`Unknown emergency type: ${this.emergencyContext.type}`);
    }
  }
  
  /**
   * Immediate damage reflex
   */
  async executeDamageReflex() {
    // If health critically low, prioritize healing
    if (this.bot.health <= 6) {
      // Check for healing items
      const healingItems = ['golden_apple', 'apple', 'bread', 'cooked_beef'];
      const availableHealing = healingItems.find(item => 
        this.bot.inventory.items().some(i => i.name === item)
      );
      
      if (availableHealing) {
        this.currentActionQueue.push({
          actionName: 'consumeItem',
          parameters: { itemName: availableHealing },
          successCriteria: 'Health restored',
          timeoutMs: 2000,
          fallbackAction: 'flee'
        });
      }
    }
    
    // Identify threat
    const hostileMobs = Object.values(this.bot.entities).filter(e => {
      if (!e.position || !e.name) return false;
      const distance = e.position.distanceTo(this.bot.entity.position);
      const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman'];
      return hostileTypes.includes(e.name) && distance < 16;
    });
    
    if (hostileMobs.length > 0) {
      const nearestThreat = hostileMobs.reduce((nearest, mob) => {
        const distance = mob.position.distanceTo(this.bot.entity.position);
        const nearestDistance = nearest.position.distanceTo(this.bot.entity.position);
        return distance < nearestDistance ? mob : nearest;
      });
      
      // Gebot 7: Use pvp plugin if available
      if (this.bot.pvp && this.bot.health > 10) {
        this.currentActionQueue.push({
          actionName: 'attack',
          parameters: { entityName: nearestThreat.name },
          successCriteria: 'Threat eliminated',
          timeoutMs: 5000,
          fallbackAction: 'flee'
        });
      } else {
        // Flee if low health or no pvp
        this.currentActionQueue.push({
          actionName: 'flee',
          parameters: { 
            entityName: nearestThreat.name,
            distance: 20
          },
          successCriteria: 'Safe distance achieved',
          timeoutMs: 10000,
          fallbackAction: null
        });
      }
    }
  }
  
  /**
   * Immediate hunger reflex
   */
  async executeHungerReflex() {
    // Gebot 7: Use auto-eat if available
    if (this.bot.autoEat) {
      this.bot.autoEat.enable();
      this.logger.warn('Auto-eat enabled for hunger emergency');
    }
    
    // Find any food
    const foodItems = this.bot.inventory.items().filter(item => 
      item.name.includes('apple') || 
      item.name.includes('bread') || 
      item.name.includes('cooked') ||
      item.name.includes('carrot') ||
      item.name.includes('potato')
    );
    
    if (foodItems.length > 0) {
      // Eat the best food available
      const foodToEat = foodItems.sort((a, b) => {
        const foodValues = {
          'golden_apple': 10,
          'cooked_beef': 8,
          'cooked_porkchop': 8,
          'bread': 5,
          'apple': 4,
          'carrot': 3,
          'potato': 1
        };
        return (foodValues[b.name] || 0) - (foodValues[a.name] || 0);
      })[0];
      
      this.currentActionQueue.push({
        actionName: 'consumeItem',
        parameters: { itemName: foodToEat.name },
        successCriteria: 'Food consumed',
        timeoutMs: 3000,
        fallbackAction: null
      });
    }
  }
  
  /**
   * Check if we need LLM plan
   */
  needsLLMPlan() {
    // If immediate reflex created actions, we might not need LLM
    if (this.currentActionQueue.length >= 3) {
      return false;
    }
    
    // Complex situations need LLM
    return true;
  }
  
  /**
   * Gebot 2 & 3: Request focused emergency plan
   */
  async requestEmergencyPlan() {
    try {
      this.logger.warn('Requesting emergency plan from LLM');
      
      // Gebot 3: Get death learnings
      const deathLearnings = await this.learningManager.getRelevantLearnings(
        'emergency',
        'survival',
        5
      );
      
      // Build minimal context
      const context = {
        emergencyTrigger: this.emergencyContext.type,
        health: this.bot.health,
        food: this.bot.food,
        threats: this.identifyThreats(),
        quickInventory: this.getQuickInventory()
      };
      
      // Add death learnings if available
      if (deathLearnings.length > 0) {
        context.deathLearnings = deathLearnings;
      }
      
      // Request emergency response
      const llmResponse = await this.ollamaInterface.handleEmergency(context);
      
      // Parse response
      const parsedResponse = this.aiResponseParser.parseEmergencyResponse(
        llmResponse,
        this.bot,
        this.botStateManager
      );
      
      // Add LLM actions to queue
      this.currentActionQueue.push(...parsedResponse.validatedActions);
      
    } catch (error) {
      await handleError(err, { module: "StandardQueue", phase: "plan_execution" }, this.learningManager, this.logger);
      this.logger.error(`Failed to get emergency plan: ${error.message}`);
      // Continue with reflex actions only
    }
  }
  
  /**
   * Identify immediate threats
   */
  identifyThreats() {
    const threats = [];
    const hostileTypes = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman', 'blaze', 'ghast'];
    
    Object.values(this.bot.entities).forEach(entity => {
      if (!entity.position || !entity.name) return;
      
      const distance = entity.position.distanceTo(this.bot.entity.position);
      if (hostileTypes.includes(entity.name) && distance < 20) {
        threats.push({
          type: entity.name,
          distance: Math.round(distance),
          position: entity.position
        });
      }
    });
    
    // Environmental threats
    const nearbyBlocks = this.bot.findBlocks({
      matching: (block) => block.name === 'lava' || block.name === 'fire',
      maxDistance: 5,
      count: 10
    });
    
    if (nearbyBlocks.length > 0) {
      threats.push({
        type: 'environmental',
        hazard: 'lava/fire',
        count: nearbyBlocks.length
      });
    }
    
    return threats;
  }
  
  /**
   * Get quick inventory summary
   */
  getQuickInventory() {
    const items = this.bot.inventory.items();
    return {
      weapons: items.filter(i => i.name.includes('sword') || i.name.includes('axe')),
      armor: items.filter(i => i.name.includes('helmet') || i.name.includes('chestplate')),
      food: items.filter(i => i.name.includes('apple') || i.name.includes('bread') || i.name.includes('cooked')),
      blocks: items.filter(i => i.name.includes('cobblestone') || i.name.includes('dirt'))
    };
  }
  
  /**
   * Gebot 5: Simplified execution using state machine
   */
  async executeActionQueue() {
    if (this.currentActionQueue.length === 0) {
      this.logger.warn('No emergency actions to execute');
      this.complete();
      return;
    }
    
    // Create simplified state machine
    this.createEmergencyStateMachine();
    
    // Start execution
    this.stateMachineService = interpret(this.stateMachine);
    
    this.stateMachineService.onTransition((state) => {
      this.logger.warn(`Emergency state: ${state.value}`);
    });
    
    this.stateMachineService.start();
  }
  
  /**
   * Create emergency state machine
   */
  createEmergencyStateMachine() {
    const states = {
      idle: {
        on: {
          START: 'checkCondition'
        }
      },
      checkCondition: {
        onEntry: () => this.checkEmergencyCondition(),
        on: {
          RESOLVED: 'complete',
          CONTINUE: 'executeAction',
          NO_MORE_ACTIONS: 'complete'
        }
      },
      executeAction: {
        onEntry: () => this.executeCurrentAction(),
        on: {
          SUCCESS: 'checkCondition',
          FAILURE: 'handleFailure'
        }
      },
      handleFailure: {
        onEntry: () => this.handleActionFailure(),
        on: {
          RETRY: 'executeAction',
          NEXT: 'checkCondition',
          ABORT: 'complete'
        }
      },
      complete: {
        onEntry: () => this.complete()
      }
    };
    
    this.stateMachine = createMachine({
      id: 'emergencyExecution',
      initial: 'idle',
      states: states
    });
  }
  
  /**
   * Gebot 4: Check if emergency is resolved
   */
  checkEmergencyCondition() {
    // Check deescalation conditions
    let resolved = false;
    
    switch (this.emergencyContext.type) {
      case 'damage':
        // Resolved if health restored and no nearby threats
        resolved = this.bot.health >= 15 && this.identifyThreats().length === 0;
        break;
      
      case 'hunger':
        // Resolved if food level acceptable
        resolved = this.bot.food >= 15;
        break;
    }
    
    if (resolved) {
      this.logger.warn('Emergency condition resolved');
      this.stateMachineService.send('RESOLVED');
      return;
    }
    
    // Check if more actions available
    if (this.currentActionIndex >= this.currentActionQueue.length) {
      this.logger.warn('No more emergency actions');
      this.stateMachineService.send('NO_MORE_ACTIONS');
      return;
    }
    
    this.stateMachineService.send('CONTINUE');
  }
  
  /**
   * Execute current emergency action
   */
  async executeCurrentAction() {
    const action = this.currentActionQueue[this.currentActionIndex];
    
    this.logger.error(`EMERGENCY ACTION: ${action.actionName}`);
    this.botStateManager.setExecutingAction(true, `EMERGENCY:${action.actionName}`);
    
    try {
      const actionFunction = this.botActions[action.actionName];
      if (!actionFunction) {
        throw new Error(`Unknown action: ${action.actionName}`);
      }
      
      // Execute with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Emergency action timeout')), action.timeoutMs);
      });
      
      const result = await Promise.race([
        actionFunction(this.bot, action.parameters),
        timeoutPromise
      ]);
      
      this.logger.warn(`Emergency action succeeded: ${action.actionName}`);
      this.botStateManager.setExecutingAction(false);
      
      this.currentActionIndex++;
      this.stateMachineService.send('SUCCESS');
      
    } catch (error) {
      await handleError(err, { module: "StandardQueue", phase: "plan_execution" }, this.learningManager, this.logger);
      this.logger.error(`Emergency action failed: ${error.message}`);
      this.botStateManager.setExecutingAction(false);
      
      this.lastError = error;
      this.stateMachineService.send('FAILURE');
    }
  }
  
  /**
   * Handle emergency action failure
   */
  async handleActionFailure() {
    const failedAction = this.currentActionQueue[this.currentActionIndex];
    
    // Try fallback if available
    if (failedAction.fallbackAction) {
      this.logger.warn(`Trying fallback: ${failedAction.fallbackAction}`);
      
      // Replace with fallback
      this.currentActionQueue[this.currentActionIndex] = {
        actionName: failedAction.fallbackAction,
        parameters: {},
        successCriteria: 'Fallback completed',
        timeoutMs: 5000,
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
   * Complete emergency handling
   */
  complete() {
    const duration = Date.now() - this.emergencyStartTime;
    this.logger.error(`EMERGENCY COMPLETE - Duration: ${duration}ms`);
    
    this.isExecuting = false;
    
    // Record learning about emergency resolution
    const survived = this.bot.health > 0;
    if (survived) {
      const learning = {
        category: 'survival',
        learningType: 'actionLearning',
        content: `Survived ${this.emergencyContext.type} emergency using ${this.currentActionQueue.map(a => a.actionName).join(', ')}`,
        confidence: 0.9,
        context: {
          emergencyType: this.emergencyContext.type,
          actions: this.currentActionQueue.map(a => a.actionName),
          finalHealth: this.bot.health,
          duration: duration
        }
      };
      
      this.learningManager.addLearning('emergency', learning);
    }
    
    // Signal completion to system
    this.onComplete();
  }
  
  /**
   * Callback for completion (set by QueueManager)
   */
  onComplete() {
    // This will be set by QueueManager to handle queue transition
    this.logger.warn('Emergency queue completed, awaiting system response');
  }
  
  /**
   * Stop emergency queue
   */
  stop() {
    this.logger.warn('Emergency queue stopped');
    this.isExecuting = false;
    
    if (this.stateMachineService) {
      this.stateMachineService.stop();
    }
    
    // Disable auto-eat if we enabled it
    if (this.bot.autoEat) {
      this.bot.autoEat.disable();
    }
  }
  
  /**
   * Get emergency status
   */
  getStatus() {
    return {
      isExecuting: this.isExecuting,
      emergencyType: this.emergencyContext.type,
      currentActionIndex: this.currentActionIndex,
      totalActions: this.currentActionQueue.length,
      duration: this.emergencyStartTime ? Date.now() - this.emergencyStartTime : 0
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

export default EmergencyQueue;
