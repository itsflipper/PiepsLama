/**
 * OllamaInterface.js - Hochspezialisierter LLM-Kommunikator
 * "Spezialist, nicht Generalist"
 * Kennt nichts über Minecraft, nur über zuverlässige Kommunikation.
 */

import axios from 'axios';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import winston from 'winston';
import ErrorRecovery from '../Utils/ErrorRecovery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom Error Classes - Gebot 5
class OllamaConnectionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'OllamaConnectionError';
    this.cause = cause;
  }
}

class LLMResponseError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'LLMResponseError';
    this.response = response;
  }
}

class PromptTemplateError extends Error {
  constructor(message, promptName) {
    super(message);
    this.name = 'PromptTemplateError';
    this.promptName = promptName;
  }
}

class OllamaInterface {
  constructor(baseUrl, model, timeout = 15000) {
    this.baseUrl = baseUrl || 'http://localhost:11434';
    this.model = model || 'tinyllama';
    this.timeout = timeout;
    
    // Gebot 6: Template cache
    this.templateCache = new Map();
    
    // Retry configuration
    this.maxRetries = 3;
    this.retryDelay = 1000; // Start with 1 second

    this.metrics = {
      totalRequests: 0,
      totalResponseTime: 0,
      errors: 0,
      lastRequestTime: null
    };
    
    // Setup logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] [OllamaInterface] ${level}: ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          level: process.env.LOG_LEVEL || 'info'
        })
      ]
    });

    // Initialize error recovery helper
    this.errorRecovery = new ErrorRecovery(null, null, this.logger);
    
    // Initialize axios instance
    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    this.logger.info(`OllamaInterface initialized - Model: ${this.model}, URL: ${this.baseUrl}`);
  }
  
  /**
   * Gebot 1: Load and cache prompt templates
   */
  async loadPromptTemplate(promptName) {
    // Check cache first
    if (this.templateCache.has(promptName)) {
      return this.templateCache.get(promptName);
    }
    
    try {
      const promptPath = join(__dirname, 'prompts', `${promptName}.txt`);
      const template = readFileSync(promptPath, 'utf8');
      
      // Cache for future use
      this.templateCache.set(promptName, template);
      this.logger.debug(`Loaded and cached prompt template: ${promptName}`);
      
      return template;
    } catch (error) {

      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      
      throw new PromptTemplateError(
        `Failed to load prompt template: ${promptName}`,
        promptName
      );
    }
  }
  
  /**
   * Gebot 1: Replace placeholders in template
   */
  fillTemplate(template, contextData) {
    let filledPrompt = template;
    
    // Replace all {{placeholder}} occurrences
    Object.entries(contextData).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      const replacement = typeof value === 'object' ? 
        JSON.stringify(value, null, 2) : 
        String(value);
      
      filledPrompt = filledPrompt.replaceAll(placeholder, replacement);
    });
    
    // Check for unfilled placeholders
    const unfilled = filledPrompt.match(/{{[^}]+}}/g);
    if (unfilled) {
      this.logger.warn(`Unfilled placeholders found: ${unfilled.join(', ')}`);
    }
    
    return filledPrompt;
  }
  
  /**
   * Gebot 2: Send request with retry logic
   */
  async sendRequest(prompt) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.debug(`Sending request to Ollama (attempt ${attempt}/${this.maxRetries})`);
        
        const response = await this.axios.post('/api/generate', {
          model: this.model,
          prompt: prompt,
          stream: false,
          format: 'json',
          options: {
            temperature: 0.7,
            top_p: 0.9,
            seed: Date.now() // For reproducibility in testing
          }
        });
        
        if (response.data && response.data.response) {
          this.logger.debug('Received successful response from Ollama');
          return response.data.response;
        } else {
          throw new LLMResponseError(
            'Invalid response structure from Ollama',
            response.data
          );
        }
        
      } catch (error) {
        await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });

        lastError = error;
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
          this.logger.error(`Connection error (attempt ${attempt}): ${error.message}`);
          lastError = new OllamaConnectionError('Cannot connect to Ollama server', error);
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          this.logger.error(`Timeout error (attempt ${attempt}): Request took longer than ${this.timeout}ms`);
          lastError = new OllamaConnectionError('Request timeout', error);
        } else if (error.response) {
          this.logger.error(`API error (attempt ${attempt}): ${error.response.status} - ${error.response.statusText}`);
          lastError = new LLMResponseError(
            `Ollama API error: ${error.response.status}`,
            error.response.data
          );
        }
        
        // If not the last attempt, wait before retrying
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt; // Exponential backoff
          this.logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      const response = await this._makeRequest(prompt);
      this.metrics.totalResponseTime += (Date.now() - startTime);
      return response;
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.metrics.errors++;
      throw error;
    }

    // All retries exhausted
    this.logger.error('All retry attempts failed');
    throw lastError;
  }
  
  /**
   * Gebot 3: Parse JSON response safely
   */
  async parseResponse(responseText) {
    try {
      const parsed = JSON.parse(responseText);
      this.logger.debug('Successfully parsed JSON response');
      return parsed;
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      this.logger.error(`Failed to parse JSON response: ${error.message}`);
      this.logger.debug(`Raw response: ${responseText.substring(0, 200)}...`);
      throw new LLMResponseError(
        'Failed to parse JSON response from LLM',
        responseText
      );
    }
  }
  
  /**
   * Generic method to send any prompt
   */
  async sendPrompt(promptName, contextData) {
    try {
      // Load template
      const template = this.loadPromptTemplate(promptName);
      
      // Fill template with context
      const filledPrompt = this.fillTemplate(template, contextData);
      
      // Log prompt details in debug mode
      if (process.env.VERBOSE_LLM_LOGGING === 'true') {
        this.logger.debug(`Filled prompt for ${promptName}:\n${filledPrompt.substring(0, 500)}...`);
      }
      
      // Send request
      const responseText = await this.sendRequest(filledPrompt);
      
      // Parse response
      const parsedResponse = this.parseResponse(responseText);
      
      // Log response in debug mode
      if (process.env.VERBOSE_LLM_LOGGING === 'true') {
        this.logger.debug(`Parsed response:\n${JSON.stringify(parsedResponse, null, 2).substring(0, 500)}...`);
      }
      
      return parsedResponse;
      
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      // Re-throw with context
      if (error instanceof OllamaConnectionError || 
          error instanceof LLMResponseError || 
          error instanceof PromptTemplateError) {
        throw error;
      } else {
        throw new Error(`Unexpected error in sendPrompt: ${error.message}`);
      }
    }
  }
  
  /**
   * Gebot 7: Service interface methods for specific prompts
   */
  
  async initializeBot(contextData) {
    return this.sendPrompt('genesis_prompt', contextData);
  }
  
  async askForStatusUpdate(contextData) {
    // Ensure required context is present
    const requiredFields = ['botStatus', 'availableActions', 'gameTime', 'weather', 'dimension'];
    const missingFields = requiredFields.filter(field => !contextData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required context fields for status update: ${missingFields.join(', ')}`);
    }
    
    return this.sendPrompt('status_update_prompt', contextData);
  }
  
  async generateActionQueue(contextData) {
    // Ensure required context
    if (!contextData.currentGoal || !contextData.botStatus || !contextData.availableActions) {
      throw new Error('Missing required context for action queue generation');
    }
    
    return this.sendPrompt('action_queue_prompt', contextData);
  }
  
  async extractLearning(contextData) {
    // Ensure required context
    if (!contextData.completedActions || !contextData.result || !contextData.finalState) {
      throw new Error('Missing required context for learning extraction');
    }
    
    return this.sendPrompt('learning_prompt', contextData);
  }
  
  async handleEmergency(contextData) {
    // Ensure critical context
    if (contextData.health === undefined || !contextData.emergencyTrigger) {
      throw new Error('Missing critical context for emergency handling');
    }
    
    return this.sendPrompt('emergency_prompt', contextData);
  }
  
  async planRespawn(contextData) {
    // Ensure death context
    if (!contextData.deathLocation || !contextData.deathReason) {
      throw new Error('Missing death context for respawn planning');
    }
    
    return this.sendPrompt('respawn_prompt', contextData);
  }
  
  async parseChatTip(contextData) {
    // Ensure chat context
    if (!contextData.playerMessage || !contextData.playerName) {
      throw new Error('Missing chat context for tip parsing');
    }
    
    return this.sendPrompt('chat_tip_parser', contextData);
  }
  
  /**
   * Test connection to Ollama
   */
  async testConnection() {
    try {
      const response = await this.axios.get('/api/tags');
      const models = response.data.models || [];
      const modelAvailable = models.some(m => m.name === this.model);
      
      if (!modelAvailable) {
        this.logger.warn(`Model ${this.model} not found. Available models: ${models.map(m => m.name).join(', ')}`);
      }
      
      return {
        connected: true,
        modelAvailable: modelAvailable,
        availableModels: models.map(m => m.name)
      };
    } catch (error) {
      await this.errorRecovery.handleError(error, { module: "StandardQueue", phase: "plan_execution" });
      return {
        connected: false,
        error: error.message
      };
    }
  }
  
  /**
   * Get context window info
   */
  getContextLimits() {
    // TinyLlama context window
    return {
      maxTokens: 4096,
      recommendedMax: 3500, // Leave room for response
      warningThreshold: 3000
    };
  }
  
  /**
   * Estimate token count (rough approximation)
   */
  estimateTokenCount(text) {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  getMetrics() {
    return {
      avgResponseTime: this.metrics.totalRequests > 0 ?
        Math.round(this.metrics.totalResponseTime / this.metrics.totalRequests) : 0,
      requestCount: this.metrics.totalRequests,
      errorRate: this.metrics.totalRequests > 0 ?
        this.metrics.errors / this.metrics.totalRequests : 0,
      contextWindowUsage: this.estimateContextUsage()
    };
  }

  estimateContextUsage() {
    return 0.3; // Platzhalter – später verbessern
  }
}

export default OllamaInterface;