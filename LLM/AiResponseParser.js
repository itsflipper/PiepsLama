/**
 * AiResponseParser.js - Unbestechlicher Orchestrator der Validierung
 * "Orchestrator, nicht Richter"
 * Wahrt die Plan-Integrität durch All-or-Nothing Validierung.
 */

import winston from 'winston';

// Custom Error Class for validation failures
class LLMPlanValidationError extends Error {
  constructor(message, failedAction, reason) {
    super(message);
    this.name = 'LLMPlanValidationError';
    this.failedAction = failedAction;
    this.reason = reason;
  }
}

class AiResponseParser {
  constructor(actionValidator) {
    // Gebot 5: Alleiniger Nutzer des ActionValidator
    this.actionValidator = actionValidator;
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [AiResponseParser] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });
  }
  
  /**
   * Gebot 7: Main synchronous parsing and validation method
   */
  parseAndValidate(llmResponse, bot, botStateManager) {
    this.logger.debug('Starting LLM response parsing and validation');
    
    // Gebot 6: Sanity check on response structure
    const structureCheck = this.performSanityCheck(llmResponse);
    if (!structureCheck.valid) {
      throw new Error(`Invalid LLM response structure: ${structureCheck.error}`);
    }
    
    // Extract components
    const { actionQueue, goalQueue, learningInsights } = llmResponse;
    
    // Validate all actions - Gebot 1: All or nothing
    const validatedActions = this.validateActionQueue(actionQueue, bot, botStateManager);
    
    // Process goals
    const processedGoals = this.processGoalQueue(goalQueue);
    
    // Process learnings
    const processedLearnings = this.processLearningInsights(learningInsights);
    
    // Extract analysis and priority
    const analysis = llmResponse.analysis || 'No analysis provided';
    const priority = this.validatePriority(llmResponse.priority);
    
    // Gebot 3: Return clean, structured output
    const result = {
      validatedActions: validatedActions,
      goals: processedGoals,
      learnings: processedLearnings,
      analysis: analysis,
      priority: priority,
      metadata: {
        timestamp: new Date().toISOString(),
        actionCount: validatedActions.length,
        goalCount: processedGoals.length,
        learningCount: processedLearnings.length
      }
    };
    
    this.logger.info(`Successfully parsed LLM response: ${validatedActions.length} actions, ${processedGoals.length} goals, ${processedLearnings.length} learnings`);
    
    return result;
  }
  
  /**
   * Gebot 6: Perform basic structure validation
   */
  performSanityCheck(llmResponse) {
    if (!llmResponse || typeof llmResponse !== 'object') {
      return { valid: false, error: 'Response is not an object' };
    }
    
    // Check for action queue
    if (!llmResponse.actionQueue) {
      return { valid: false, error: 'Missing actionQueue' };
    }
    
    if (!Array.isArray(llmResponse.actionQueue)) {
      return { valid: false, error: 'actionQueue is not an array' };
    }
    
    // Goal queue is optional but must be array if present
    if (llmResponse.goalQueue && !Array.isArray(llmResponse.goalQueue)) {
      return { valid: false, error: 'goalQueue is not an array' };
    }
    
    // Learning insights are optional but must be array if present
    if (llmResponse.learningInsights && !Array.isArray(llmResponse.learningInsights)) {
      return { valid: false, error: 'learningInsights is not an array' };
    }
    
    return { valid: true };
  }
  
  /**
   * Gebot 1 & 2: Validate entire action queue or reject all
   */
  validateActionQueue(actionQueue, bot, botStateManager) {
    const validatedActions = [];
    
    for (let i = 0; i < actionQueue.length; i++) {
      const action = actionQueue[i];
      
      // Ensure action has required structure
      if (!action.actionName || !action.parameters) {
        throw new LLMPlanValidationError(
          `Invalid action structure at index ${i}`,
          action,
          'Missing actionName or parameters'
        );
      }
      
      // Validate through ActionValidator
      const validationResult = this.actionValidator.validate(
        {
          actionName: action.actionName,
          parameters: action.parameters
        },
        bot,
        botStateManager
      );
      
      if (!validationResult.isValid) {
        // Gebot 2: Detailed error with exact reason
        throw new LLMPlanValidationError(
          `Plan rejected because action '${action.actionName}' at index ${i} failed validation: ${validationResult.reason}`,
          action,
          validationResult.reason
        );
      }
      
      // Gebot 4: Replace parameters with validated ones
      const enhancedAction = {
        actionName: action.actionName,
        parameters: validationResult.validatedParams,
        successCriteria: action.successCriteria || `${action.actionName} completed successfully`,
        timeoutMs: this.validateTimeout(action.timeoutMs),
        fallbackAction: action.fallbackAction || null,
        originalIndex: i
      };
      
      validatedActions.push(enhancedAction);
      
      this.logger.debug(`Validated action ${i}: ${action.actionName}`);
    }
    
    return validatedActions;
  }
  
  /**
   * Process goal queue with validation
   */
  processGoalQueue(goalQueue) {
    if (!goalQueue || goalQueue.length === 0) {
      return [];
    }
    
    const processedGoals = [];
    
    for (const goal of goalQueue) {
      // Validate goal structure
      if (!goal.goalId || !goal.goalDescription) {
        this.logger.warn('Skipping invalid goal: missing required fields');
        continue;
      }
      
      const processedGoal = {
        goalId: goal.goalId,
        goalDescription: goal.goalDescription,
        priority: this.validateGoalPriority(goal.priority),
        category: this.validateGoalCategory(goal.category),
        timestamp: new Date().toISOString()
      };
      
      processedGoals.push(processedGoal);
    }
    
    // Sort by priority (highest first)
    processedGoals.sort((a, b) => b.priority - a.priority);
    
    return processedGoals;
  }
  
  /**
   * Process learning insights with validation
   */
  processLearningInsights(learningInsights) {
    if (!learningInsights || learningInsights.length === 0) {
      return [];
    }
    
    const processedLearnings = [];
    
    for (const learning of learningInsights) {
      // Validate learning structure
      if (!learning.category || !learning.insight) {
        this.logger.warn('Skipping invalid learning: missing required fields');
        continue;
      }
      
      const processedLearning = {
        category: this.validateLearningCategory(learning.category),
        learningType: learning.learningType || 'actionLearning',
        content: learning.insight || learning.content,
        confidence: this.validateConfidence(learning.confidence),
        context: learning.context || 'No context provided',
        timestamp: new Date().toISOString()
      };
      
      processedLearnings.push(processedLearning);
    }
    
    return processedLearnings;
  }
  
  /**
   * Validate and normalize priority
   */
  validatePriority(priority) {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    
    if (!priority || !validPriorities.includes(priority)) {
      this.logger.warn(`Invalid priority '${priority}', defaulting to 'medium'`);
      return 'medium';
    }
    
    return priority;
  }
  
  /**
   * Validate and normalize timeout
   */
  validateTimeout(timeout) {
    // Default timeout if not specified
    if (!timeout || typeof timeout !== 'number') {
      return 30000; // 30 seconds default
    }
    
    // Minimum 1 second, maximum 5 minutes
    return Math.max(1000, Math.min(timeout, 300000));
  }
  
  /**
   * Validate goal priority (1-10)
   */
  validateGoalPriority(priority) {
    if (!priority || typeof priority !== 'number') {
      return 5; // Default medium priority
    }
    
    return Math.max(1, Math.min(priority, 10));
  }
  
  /**
   * Validate goal category
   */
  validateGoalCategory(category) {
    const validCategories = ['survival', 'crafting', 'building', 'exploration'];
    
    if (!category || !validCategories.includes(category)) {
      return 'survival'; // Default to survival
    }
    
    return category;
  }
  
  /**
   * Validate learning category
   */
  validateLearningCategory(category) {
    const validCategories = ['inventar', 'crafting', 'blockinteraktion', 'survival', 'fight', 'moving'];
    
    if (!category || !validCategories.includes(category)) {
      this.logger.warn(`Invalid learning category '${category}', defaulting to 'survival'`);
      return 'survival';
    }
    
    return category;
  }
  
  /**
   * Validate confidence (0-1)
   */
  validateConfidence(confidence) {
    if (!confidence || typeof confidence !== 'number') {
      return 0.5; // Default medium confidence
    }
    
    return Math.max(0, Math.min(confidence, 1));
  }
  
  /**
   * Parse emergency response (simplified structure)
   */
  parseEmergencyResponse(llmResponse, bot, botStateManager) {
    this.logger.debug('Parsing emergency response');
    
    // Emergency responses may have simpler structure
    if (!llmResponse.actionQueue || !Array.isArray(llmResponse.actionQueue)) {
      throw new Error('Emergency response missing actionQueue');
    }
    
    // Validate with same rigor
    const validatedActions = this.validateActionQueue(llmResponse.actionQueue, bot, botStateManager);
    
    return {
      validatedActions: validatedActions,
      analysis: llmResponse.analysis || 'Emergency response',
      priority: 'critical', // Always critical for emergencies
      goals: [], // No goals in emergency
      learnings: [] // No learnings during emergency
    };
  }
  
  /**
   * Parse respawn response
   */
  parseRespawnResponse(llmResponse, bot, botStateManager) {
    this.logger.debug('Parsing respawn response');
    
    // Respawn has additional strategy field
    const baseResult = this.parseAndValidate(llmResponse, bot, botStateManager);
    
    // Add respawn-specific fields
    baseResult.strategy = llmResponse.strategy || 'fresh_start';
    baseResult.riskAssessment = llmResponse.riskAssessment || {
      itemValue: 'unknown',
      retrievalRisk: 'high',
      recommendation: 'fresh_start'
    };
    
    return baseResult;
  }
  
  /**
   * Parse chat tip response
   */
  parseChatTipResponse(llmResponse) {
    this.logger.debug('Parsing chat tip response');
    
    // Chat tips don't need action validation
    if (!llmResponse.learnings || !Array.isArray(llmResponse.learnings)) {
      throw new Error('Chat tip response missing learnings');
    }
    
    const processedLearnings = this.processLearningInsights(llmResponse.learnings);
    
    return {
      interpretation: llmResponse.interpretation || 'Tip understood',
      learnings: processedLearnings,
      acknowledgment: llmResponse.acknowledgment || 'Thank you for the tip!'
    };
  }
}

export default AiResponseParser;