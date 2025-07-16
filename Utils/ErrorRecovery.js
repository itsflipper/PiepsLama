/**
 * ErrorRecovery.js - Automatische Fehlerbehandlung
 * "Aus Fehlern lernen, nicht an ihnen zerbrechen"
 * Zentrale Fehlerklassifikation, Recovery-Strategien und Learning-Integration
 */

import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

// Error Classification Enums
const ErrorCategories = {
  NETWORK: 'network',
  LOGIC: 'logic',
  RESOURCE: 'resource',
  TIMING: 'timing',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  UNKNOWN: 'unknown'
};

const RecoveryStrategies = {
  RETRY: 'retry',
  RETRY_WITH_BACKOFF: 'retry_with_backoff',
  FALLBACK: 'fallback',
  ABORT_ACTION: 'abort_action',
  ABORT_QUEUE: 'abort_queue',
  REQUEST_NEW_PLAN: 'request_new_plan',
  EMERGENCY_MODE: 'emergency_mode',
  RECONNECT: 'reconnect',
  RESTART_SYSTEM: 'restart_system',
  IGNORE: 'ignore'
};

// Error severity levels
const SeverityLevels = {
  LOW: 1,    // Ignorable, minor impact
  MEDIUM: 2, // Requires attention but not critical
  HIGH: 3,   // Significant impact, needs recovery
  CRITICAL: 4 // System-threatening, immediate action required
};

class ErrorRecovery {
  constructor(bot, learningManager, logger) {
    this.bot = bot;
    this.learningManager = learningManager;
    this.logger = logger || this._createDefaultLogger();
    
    // Error history for pattern detection
    this.errorHistory = [];
    this.maxHistorySize = 100;
    
    // Recovery attempt tracking
    this.recoveryAttempts = new Map(); // errorId -> attempt count
    this.maxRetryAttempts = 3;
    
    // Error patterns and their recovery strategies
    this.errorPatterns = this._initializeErrorPatterns();
    
    // Statistics
    this.stats = {
      totalErrors: 0,
      errorsByCategory: {},
      successfulRecoveries: 0,
      failedRecoveries: 0
    };
    
    this.logger.info('ErrorRecovery system initialized');
  }
  
  /**
   * Create default logger if none provided
   */
  _createDefaultLogger() {
    return winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [ErrorRecovery] ${level}: ${message}`;
        })
      ),
      transports: [new winston.transports.Console()]
    });
  }
  
  /**
   * Initialize known error patterns and their recovery strategies
   */
  _initializeErrorPatterns() {
    return {
      // Network errors
      'ECONNREFUSED': {
        category: ErrorCategories.NETWORK,
        severity: SeverityLevels.HIGH,
        strategy: RecoveryStrategies.RECONNECT,
        message: 'Connection refused - server may be down'
      },
      'ETIMEDOUT': {
        category: ErrorCategories.NETWORK,
        severity: SeverityLevels.HIGH,
        strategy: RecoveryStrategies.RETRY_WITH_BACKOFF,
        message: 'Connection timeout'
      },
      'ENOTFOUND': {
        category: ErrorCategories.NETWORK,
        severity: SeverityLevels.CRITICAL,
        strategy: RecoveryStrategies.ABORT_QUEUE,
        message: 'Server not found - check host configuration'
      },
      
      // Resource errors
      'RESOURCE_NOT_FOUND': {
        category: ErrorCategories.RESOURCE,
        severity: SeverityLevels.MEDIUM,
        strategy: RecoveryStrategies.REQUEST_NEW_PLAN,
        message: 'Required resource not available'
      },
      'TARGET_NOT_FOUND': {
        category: ErrorCategories.RESOURCE,
        severity: SeverityLevels.LOW,
        strategy: RecoveryStrategies.FALLBACK,
        message: 'Target entity or block not found'
      },
      
      // Pathfinding errors
      'PATHFINDING_ERROR': {
        category: ErrorCategories.LOGIC,
        severity: SeverityLevels.MEDIUM,
        strategy: RecoveryStrategies.FALLBACK,
        message: 'No path found to destination'
      },
      'noPath': {
        category: ErrorCategories.LOGIC,
        severity: SeverityLevels.MEDIUM,
        strategy: RecoveryStrategies.REQUEST_NEW_PLAN,
        message: 'Pathfinder could not find route'
      },
      
      // Validation errors
      'INVALID_PARAMETER': {
        category: ErrorCategories.VALIDATION,
        severity: SeverityLevels.HIGH,
        strategy: RecoveryStrategies.ABORT_ACTION,
        message: 'Invalid action parameters'
      },
      'UNKNOWN_ACTION': {
        category: ErrorCategories.VALIDATION,
        severity: SeverityLevels.CRITICAL,
        strategy: RecoveryStrategies.ABORT_QUEUE,
        message: 'LLM generated unknown action'
      },
      
      // Timing errors
      'TIMEOUT': {
        category: ErrorCategories.TIMING,
        severity: SeverityLevels.MEDIUM,
        strategy: RecoveryStrategies.RETRY,
        message: 'Action timeout exceeded'
      },
      'Action timeout': {
        category: ErrorCategories.TIMING,
        severity: SeverityLevels.MEDIUM,
        strategy: RecoveryStrategies.ABORT_ACTION,
        message: 'Action took too long to complete'
      },
      
      // Combat/survival errors
      'Bot is dead': {
        category: ErrorCategories.LOGIC,
        severity: SeverityLevels.CRITICAL,
        strategy: RecoveryStrategies.EMERGENCY_MODE,
        message: 'Bot died - need respawn'
      },
      'Low health': {
        category: ErrorCategories.LOGIC,
        severity: SeverityLevels.HIGH,
        strategy: RecoveryStrategies.EMERGENCY_MODE,
        message: 'Health critically low'
      }
    };
  }
  
  /**
   * Main error handling function
   * @param {Error} error - The error object
   * @param {Object} context - Additional context about where/how the error occurred
   * @returns {Object} Recovery result with strategy and success status
   */
  async handleError(error, context = {}) {
    const errorId = uuidv4();
    const timestamp = new Date().toISOString();
    
    // Classify the error
    const classification = this.classifyError(error);
    
    // Log the error
    this.logError(errorId, error, classification, context);
    
    // Add to history
    this.addToHistory(errorId, error, classification, context, timestamp);
    
    // Update statistics
    this.updateStatistics(classification);
    
    // Determine recovery strategy
    const strategy = await this.determineRecoveryStrategy(error, classification, context);
    
    // Execute recovery
    const recoveryResult = await this.executeRecovery(errorId, error, classification, strategy, context);
    
    // Generate learning if appropriate
    if (recoveryResult.shouldLearn) {
      await this.generateLearning(error, classification, context, recoveryResult);
    }
    
    return recoveryResult;
  }
  
  /**
   * Classify error into category and severity
   */
  classifyError(error) {
    // Check known patterns first
    for (const [pattern, info] of Object.entries(this.errorPatterns)) {
      if (error.code === pattern || error.message?.includes(pattern)) {
        return {
          category: info.category,
          severity: info.severity,
          knownPattern: pattern,
          patternInfo: info
        };
      }
    }
    
    // Fallback classification based on error properties
    if (error.code?.startsWith('E') && error.syscall) {
      return {
        category: ErrorCategories.NETWORK,
        severity: SeverityLevels.HIGH,
        knownPattern: null
      };
    }
    
    if (error.message?.includes('validation') || error.message?.includes('invalid')) {
      return {
        category: ErrorCategories.VALIDATION,
        severity: SeverityLevels.MEDIUM,
        knownPattern: null
      };
    }
    
    if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
      return {
        category: ErrorCategories.TIMING,
        severity: SeverityLevels.MEDIUM,
        knownPattern: null
      };
    }
    
    if (error.message?.includes('not found') || error.message?.includes('no such')) {
      return {
        category: ErrorCategories.RESOURCE,
        severity: SeverityLevels.LOW,
        knownPattern: null
      };
    }
    
    // Unknown error
    return {
      category: ErrorCategories.UNKNOWN,
      severity: SeverityLevels.MEDIUM,
      knownPattern: null
    };
  }
  
  /**
   * Log error with appropriate level
   */
  logError(errorId, error, classification, context) {
    const logMessage = `[${errorId}] ${classification.category} error: ${error.message}`;
    const logDetails = {
      errorId,
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack
      },
      classification,
      context
    };
    
    switch (classification.severity) {
      case SeverityLevels.CRITICAL:
        this.logger.error(logMessage, logDetails);
        break;
      case SeverityLevels.HIGH:
        this.logger.warn(logMessage, logDetails);
        break;
      default:
        this.logger.info(logMessage, logDetails);
    }
  }
  
  /**
   * Add error to history for pattern detection
   */
  addToHistory(errorId, error, classification, context, timestamp) {
    const historyEntry = {
      errorId,
      timestamp,
      category: classification.category,
      severity: classification.severity,
      message: error.message,
      code: error.code,
      context: {
        action: context.action,
        queue: context.queue,
        module: context.module
      }
    };
    
    this.errorHistory.push(historyEntry);
    
    // Maintain history size limit
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }
  
  /**
   * Update error statistics
   */
  updateStatistics(classification) {
    this.stats.totalErrors++;
    
    if (!this.stats.errorsByCategory[classification.category]) {
      this.stats.errorsByCategory[classification.category] = 0;
    }
    this.stats.errorsByCategory[classification.category]++;
  }
  
  /**
   * Determine best recovery strategy based on error and context
   */
  async determineRecoveryStrategy(error, classification, context) {
    // Use known pattern strategy if available
    if (classification.knownPattern && classification.patternInfo.strategy) {
      return classification.patternInfo.strategy;
    }
    
    // Check if we've seen this error repeatedly
    const recentSimilarErrors = this.getRecentSimilarErrors(error, 5);
    if (recentSimilarErrors.length >= 3) {
      // Escalate strategy if error is repeating
      this.logger.warn(`Repeated error pattern detected: ${error.message}`);
      return RecoveryStrategies.REQUEST_NEW_PLAN;
    }
    
    // Context-based strategy selection
    if (context.queue === 'emergency') {
      // More aggressive recovery in emergency mode
      return classification.severity >= SeverityLevels.HIGH ? 
        RecoveryStrategies.ABORT_QUEUE : 
        RecoveryStrategies.RETRY;
    }
    
    // Category-based default strategies
    switch (classification.category) {
      case ErrorCategories.NETWORK:
        return RecoveryStrategies.RETRY_WITH_BACKOFF;
      case ErrorCategories.VALIDATION:
        return RecoveryStrategies.ABORT_ACTION;
      case ErrorCategories.RESOURCE:
        return RecoveryStrategies.FALLBACK;
      case ErrorCategories.TIMING:
        return RecoveryStrategies.RETRY;
      case ErrorCategories.LOGIC:
        return RecoveryStrategies.REQUEST_NEW_PLAN;
      default:
        return RecoveryStrategies.ABORT_ACTION;
    }
  }
  
  /**
   * Execute the recovery strategy
   */
  async executeRecovery(errorId, error, classification, strategy, context) {
    this.logger.info(`Executing recovery strategy: ${strategy} for error ${errorId}`);
    
    const result = {
      strategy,
      success: false,
      shouldLearn: false,
      action: null,
      message: ''
    };
    
    // Track recovery attempts
    const attempts = this.recoveryAttempts.get(errorId) || 0;
    this.recoveryAttempts.set(errorId, attempts + 1);
    
    try {
      switch (strategy) {
        case RecoveryStrategies.RETRY:
          if (attempts < this.maxRetryAttempts) {
            result.action = 'retry_action';
            result.success = true;
            result.message = `Retrying action (attempt ${attempts + 1}/${this.maxRetryAttempts})`;
          } else {
            result.action = 'max_retries_exceeded';
            result.shouldLearn = true;
            result.message = 'Maximum retry attempts exceeded';
          }
          break;
          
        case RecoveryStrategies.RETRY_WITH_BACKOFF:
          if (attempts < this.maxRetryAttempts) {
            const delay = Math.min(1000 * Math.pow(2, attempts), 10000); // Exponential backoff
            result.action = 'retry_with_delay';
            result.success = true;
            result.message = `Retrying after ${delay}ms delay`;
            result.delay = delay;
          } else {
            result.action = 'abort_action';
            result.shouldLearn = true;
            result.message = 'Maximum backoff retries exceeded';
          }
          break;
          
        case RecoveryStrategies.FALLBACK:
          result.action = 'use_fallback';
          result.success = true;
          result.shouldLearn = true;
          result.message = 'Switching to fallback action';
          break;
          
        case RecoveryStrategies.ABORT_ACTION:
          result.action = 'skip_action';
          result.success = true;
          result.shouldLearn = true;
          result.message = 'Aborting current action';
          break;
          
        case RecoveryStrategies.ABORT_QUEUE:
          result.action = 'clear_queue';
          result.success = true;
          result.shouldLearn = true;
          result.message = 'Aborting entire action queue';
          break;
          
        case RecoveryStrategies.REQUEST_NEW_PLAN:
          result.action = 'new_plan';
          result.success = true;
          result.shouldLearn = true;
          result.message = 'Requesting new plan from LLM';
          break;
          
        case RecoveryStrategies.EMERGENCY_MODE:
          result.action = 'activate_emergency';
          result.success = true;
          result.shouldLearn = false; // Emergency handling has its own learning
          result.message = 'Activating emergency mode';
          break;
          
        case RecoveryStrategies.RECONNECT:
          result.action = 'reconnect';
          result.success = true;
          result.shouldLearn = false;
          result.message = 'Initiating reconnection';
          break;
          
        case RecoveryStrategies.RESTART_SYSTEM:
          result.action = 'system_restart';
          result.success = true;
          result.shouldLearn = true;
          result.message = 'System restart required';
          break;
          
        case RecoveryStrategies.IGNORE:
          result.action = 'ignore';
          result.success = true;
          result.shouldLearn = false;
          result.message = 'Error ignored';
          break;
          
        default:
          result.action = 'unknown_strategy';
          result.success = false;
          result.message = 'Unknown recovery strategy';
      }
      
      // Update statistics
      if (result.success) {
        this.stats.successfulRecoveries++;
      } else {
        this.stats.failedRecoveries++;
      }
      
    } catch (recoveryError) {
      this.logger.error(`Recovery execution failed: ${recoveryError.message}`);
      result.success = false;
      result.message = `Recovery failed: ${recoveryError.message}`;
      this.stats.failedRecoveries++;
    }
    
    // Clean up recovery attempts if successful or max attempts reached
    if (result.success || attempts >= this.maxRetryAttempts) {
      this.recoveryAttempts.delete(errorId);
    }
    
    return result;
  }
  
  /**
   * Generate learning from error
   */
  async generateLearning(error, classification, context, recoveryResult) {
    try {
      const learning = {
        category: this._mapErrorCategoryToLearningCategory(classification.category, context),
        learningType: 'antiAction',
        content: this._generateLearningContent(error, classification, context, recoveryResult),
        confidence: this._calculateLearningConfidence(classification, recoveryResult),
        context: {
          error: {
            message: error.message,
            code: error.code,
            category: classification.category
          },
          action: context.action,
          recovery: {
            strategy: recoveryResult.strategy,
            success: recoveryResult.success
          },
          timestamp: new Date().toISOString()
        }
      };
      
      await this.learningManager.addLearning(
        context.queue || 'standard',
        learning
      );
      
      this.logger.debug(`Generated learning: ${learning.content}`);
      
    } catch (learningError) {
      this.logger.error(`Failed to generate learning: ${learningError.message}`);
    }
  }
  
  /**
   * Map error category to learning category
   */
  _mapErrorCategoryToLearningCategory(errorCategory, context) {
    // If context provides action, try to determine category from action
    if (context.action) {
      const actionName = context.action.actionName || context.action;
      
      const actionCategoryMap = {
        goTo: 'moving',
        goToEntity: 'moving',
        digBlock: 'blockinteraktion',
        placeBlock: 'blockinteraktion',
        craft: 'crafting',
        smelt: 'crafting',
        attack: 'fight',
        flee: 'fight',
        consumeItem: 'survival',
        sleep: 'survival',
        equipItem: 'inventar',
        depositItem: 'inventar'
      };
      
      if (actionCategoryMap[actionName]) {
        return actionCategoryMap[actionName];
      }
    }
    
    // Fallback mapping based on error category
    const errorCategoryMap = {
      [ErrorCategories.NETWORK]: 'survival',
      [ErrorCategories.RESOURCE]: 'inventar',
      [ErrorCategories.VALIDATION]: 'survival',
      [ErrorCategories.LOGIC]: 'survival',
      [ErrorCategories.TIMING]: 'moving',
      [ErrorCategories.PERMISSION]: 'survival'
    };
    
    return errorCategoryMap[errorCategory] || 'survival';
  }
  
  /**
   * Generate learning content string
   */
  _generateLearningContent(error, classification, context, recoveryResult) {
    const actionName = context.action?.actionName || context.action || 'unknown action';
    
    let content = `Avoid ${actionName} when ${error.message}`;
    
    if (recoveryResult.strategy === RecoveryStrategies.FALLBACK && context.fallbackAction) {
      content += `. Use ${context.fallbackAction} instead`;
    }
    
    if (classification.knownPattern) {
      content += `. This is a ${classification.category} error`;
    }
    
    return content;
  }
  
  /**
   * Calculate confidence for the learning
   */
  _calculateLearningConfidence(classification, recoveryResult) {
    let confidence = 0.5;
    
    // Higher confidence for known patterns
    if (classification.knownPattern) {
      confidence += 0.2;
    }
    
    // Higher confidence for successful recoveries
    if (recoveryResult.success) {
      confidence += 0.2;
    }
    
    // Adjust based on severity
    if (classification.severity >= SeverityLevels.HIGH) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * Find recent similar errors
   */
  getRecentSimilarErrors(error, lookbackMinutes = 5) {
    const cutoffTime = Date.now() - (lookbackMinutes * 60 * 1000);
    
    return this.errorHistory.filter(entry => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime > cutoffTime && 
             (entry.message === error.message || entry.code === error.code);
    });
  }
  
  /**
   * Get error recovery statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      recentErrors: this.errorHistory.slice(-10),
      activeRecoveryAttempts: this.recoveryAttempts.size,
      successRate: this.stats.totalErrors > 0 ? 
        this.stats.successfulRecoveries / this.stats.totalErrors : 0
    };
  }
  
  /**
   * Check if system should enter panic mode
   */
  shouldPanic() {
    // Check for high frequency of critical errors
    const recentCriticalErrors = this.errorHistory.filter(entry => {
      const isRecent = Date.now() - new Date(entry.timestamp).getTime() < 60000; // Last minute
      return isRecent && entry.severity === SeverityLevels.CRITICAL;
    });
    
    return recentCriticalErrors.length >= 3;
  }
  
  /**
   * Clear error history (for reset)
   */
  clearHistory() {
    this.errorHistory = [];
    this.recoveryAttempts.clear();
    this.logger.info('Error history cleared');
  }
  
  /**
   * Export error handler function for use in try-catch blocks
   */
  async catch(error, context = {}) {
    return await this.handleError(error, context);
  }
}

export default ErrorRecovery;